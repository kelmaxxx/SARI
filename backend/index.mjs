// SARI backend — product-catalog-g4
// Runtime: Node.js 22.x (or the version agreed with the team lead)
// Handler: index.handler
// Trigger: API Gateway HTTP API (payload format 2.0)
//
// Environment variables (names only — no secrets):
//   TABLE_NAME   = catalog-g4-products
//   BUCKET_NAME  = <bucket name from the team lead>
//   URL_EXPIRES  = 300   (seconds presigned URLs stay valid)
//
// ASSUMPTIONS TO CONFIRM BEFORE USE:
//   - Partition key is "id" (String), no sort key  -> confirm with Bayabao
//   - Response shapes below are placeholders       -> match API_CONTRACT.md

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const TABLE = process.env.TABLE_NAME;
const BUCKET = process.env.BUCKET_NAME;
const URL_EXPIRES = Number(process.env.URL_EXPIRES || 300);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const EDITABLE_FIELDS = ["name", "description", "price", "category", "imageKey"];

// ---------- helpers ----------

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const error = (statusCode, code, message) => json(statusCode, { error: { code, message } });

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(raw); // throws on bad JSON; caught in handler
}

// Private bucket: give the frontend a short-lived URL to view each image.
async function withImageUrl(product) {
  if (!product?.imageKey || !BUCKET) return product;
  const imageUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: product.imageKey }),
    { expiresIn: URL_EXPIRES }
  );
  return { ...product, imageUrl };
}

function validateProduct(data, { partial = false } = {}) {
  const errors = [];
  if (!partial || "name" in data) {
    if (typeof data.name !== "string" || !data.name.trim()) errors.push("name is required");
  }
  if (!partial || "price" in data) {
    if (typeof data.price !== "number" || Number.isNaN(data.price) || data.price < 0)
      errors.push("price must be a non-negative number");
  }
  if ("category" in data && typeof data.category !== "string")
    errors.push("category must be a string");
  if ("description" in data && typeof data.description !== "string")
    errors.push("description must be a string");
  return errors;
}

// ---------- route handlers ----------

// GET /products?search=...&category=...
async function listProducts(event) {
  const q = event.queryStringParameters || {};
  const search = (q.search || "").trim().toLowerCase();
  const category = (q.category || "").trim().toLowerCase();

  // Scan the whole table (fine for a small class-project catalog).
  // If Bayabao adds a category GSI, switch the category filter to a Query.
  let items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (category) items = items.filter((p) => (p.category || "").toLowerCase() === category);
  if (search)
    items = items.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(search) ||
        (p.description || "").toLowerCase().includes(search)
    );

  items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const products = await Promise.all(items.map(withImageUrl));
  return json(200, { products, count: products.length });
}

// GET /products/{id}
async function getProduct(id) {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
  if (!res.Item) return error(404, "NOT_FOUND", `Product ${id} not found`);
  return json(200, await withImageUrl(res.Item));
}

// POST /products
async function createProduct(event) {
  const data = parseBody(event);
  const errors = validateProduct(data);
  if (errors.length) return error(400, "VALIDATION_ERROR", errors.join("; "));

  const now = new Date().toISOString();
  const product = {
    id: randomUUID(),
    name: data.name.trim(),
    description: data.description || "",
    price: data.price,
    category: data.category || "",
    imageKey: data.imageKey || null,
    createdAt: now,
    updatedAt: now,
  };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: product,
      ConditionExpression: "attribute_not_exists(id)",
    })
  );
  return json(201, await withImageUrl(product));
}

// PUT /products/{id}
async function updateProduct(id, event) {
  const data = parseBody(event);
  const fields = EDITABLE_FIELDS.filter((f) => f in data);
  if (!fields.length) return error(400, "VALIDATION_ERROR", "No updatable fields provided");
  const errors = validateProduct(data, { partial: true });
  if (errors.length) return error(400, "VALIDATION_ERROR", errors.join("; "));

  const names = { "#updatedAt": "updatedAt" };
  const values = { ":updatedAt": new Date().toISOString() };
  const sets = ["#updatedAt = :updatedAt"];
  for (const f of fields) {
    names[`#${f}`] = f;
    values[`:${f}`] = f === "name" ? data[f].trim() : data[f];
    sets.push(`#${f} = :${f}`);
  }

  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: "SET " + sets.join(", "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(id)",
        ReturnValues: "ALL_NEW",
      })
    );
    return json(200, await withImageUrl(res.Attributes));
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException")
      return error(404, "NOT_FOUND", `Product ${id} not found`);
    throw e;
  }
}

// DELETE /products/{id}
async function deleteProduct(id) {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { id },
        ConditionExpression: "attribute_exists(id)",
      })
    );
    return json(200, { message: `Product ${id} deleted`, id });
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException")
      return error(404, "NOT_FOUND", `Product ${id} not found`);
    throw e;
  }
}

// POST /images   body: { "fileName": "shoe.png", "contentType": "image/png" }
async function createUploadUrl(event) {
  const { contentType } = parseBody(event);
  const ext = ALLOWED_IMAGE_TYPES[contentType];
  if (!ext)
    return error(400, "VALIDATION_ERROR", "contentType must be image/jpeg, image/png or image/webp");

  const imageKey = `products/${randomUUID()}.${ext}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: imageKey, ContentType: contentType }),
    { expiresIn: URL_EXPIRES }
  );
  return json(200, { uploadUrl, imageKey, expiresIn: URL_EXPIRES });
}

// ---------- entry point ----------

export const handler = async (event) => {
  const route = event.routeKey; // e.g. "GET /products/{id}"
  const id = event.pathParameters?.id;
  console.log(JSON.stringify({ route, id, requestId: event.requestContext?.requestId }));

  try {
    switch (route) {
      case "GET /products":         return await listProducts(event);
      case "GET /products/{id}":    return await getProduct(id);
      case "POST /products":        return await createProduct(event);
      case "PUT /products/{id}":    return await updateProduct(id, event);
      case "DELETE /products/{id}": return await deleteProduct(id);
      case "POST /images":          return await createUploadUrl(event);
      default:                      return error(404, "ROUTE_NOT_FOUND", `No route for ${route}`);
    }
  } catch (e) {
    if (e instanceof SyntaxError) return error(400, "INVALID_JSON", "Request body is not valid JSON");
    console.error("Unhandled error", e);
    return error(500, "INTERNAL_ERROR", "Something went wrong");
  }
};
