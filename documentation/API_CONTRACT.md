# SARI — Frontend / Backend API Contract

**Status:** Proposal for team review — not yet agreed or implemented
**Version:** 0.1 (draft)
**Created:** November 20, 2026
**Prepared by:** Abdul Malik (frontend)
**Reviewers:** Edres (Lambda, API Gateway, backend), Bayabao (DynamoDB), team leader

> This document describes what the current SARI frontend needs from the backend.
> Nothing in the backend, DynamoDB, or S3 exists yet. Every endpoint below is a
> **proposal** until the team reviews it.

**How to read the labels:**

| Label | Meaning |
| --- | --- |
| **Confirmed** | True in the current frontend code today. |
| **Proposed** | Our recommendation. Needs agreement from Edres and Bayabao. |
| **Open** | Not decided. Listed in Section 8 for the team meeting. |

---

## 1. Current frontend data flow (Confirmed)

Every page calls one object: `SARI.api` in `frontend/js/api.js`. No page calls
`fetch()` directly.

```
index.html   ──> catalog.js  ──┐
product.html ──> product.js  ──┼──> SARI.api ──> mock data (localStorage)
admin.html   ──> admin.js    ──┘                or, later, API Gateway
```

| File | Role |
| --- | --- |
| `js/config.js` | Holds `useMockData: true` and an empty `apiBaseUrl`. |
| `js/api.js` | The only data-access layer. Chooses mock or `fetch()`. |
| `js/mock-data.js` | Nine sample products stored in `localStorage`. |

When `useMockData` is set to `false` and `apiBaseUrl` is filled in, the same
page code will call the real API. Only `api.js`, `config.js`, and the image
upload step should need changes.

Current calls made by the frontend:

| Frontend function | Used by | Current behaviour |
| --- | --- | --- |
| `getProducts({ q, category })` | Catalog | Returns the filtered list. Sends `q` and `category` only when set. Expects a JSON **array**; also tolerates `{ items: [...] }`. |
| `getProduct(id)` | Detail page | Returns one product, or `null` when the API answers `404`. |
| `getCategories()` | Catalog, admin | Derived from the product list today. No categories endpoint is called. |
| `createProduct(input)` | Admin | Sends name, description, price, category, imageUrl, imageKey. |
| `updateProduct(id, input)` | Admin | Same fields as create. |
| `deleteProduct(id)` | Admin | No response body is used. |
| `uploadImage(file)` | Admin | **Mock only.** Converts the file to a data URL with `FileReader`; no network call. |

**Confirmed request details:** `Content-Type: application/json`; IDs are
URL-encoded in the path; no authentication header is sent today.

---

## 2. Product data schema

These are the fields the frontend reads and writes. They extend the schema
already listed in `PROJECT_PLAN.md`.

| Field | Type | Required | Set by | Purpose |
| --- | --- | --- | --- | --- |
| `id` | string | Yes | Backend | Stable product identifier. Used in URLs (`product.html?id=…`) and in `PUT` / `DELETE` paths. URL-safe, never reused. |
| `name` | string | Yes | Client | Product name. Trimmed. 2–80 characters. |
| `description` | string | Yes | Client | Full description. Trimmed. 20–600 characters. |
| `price` | number | Yes | Client | Price in Philippine pesos. Greater than 0, at most 1,000,000. Whole pesos for now (see Section 8). |
| `category` | string | Yes | Client | One agreed category from the list in Section 8. Case-sensitive. |
| `imageUrl` | string | Yes in every response | Backend | A URL the browser can load in `<img src>`. The frontend treats it as opaque. |
| `imageKey` | string | Required after S3 is connected | Backend | The S3 object key. Stable; used by Lambda for delete and for generating `imageUrl`. Never a full URL. |
| `createdAt` | string (ISO 8601, UTC) | Yes in responses | Backend | Creation time. Example: `2026-11-20T09:15:00.000Z`. |
| `updatedAt` | string (ISO 8601, UTC) | Yes in responses | Backend | Last edit time. Shown in the admin table. |

### Rules

- The frontend **never generates real IDs or timestamps** once the API is live.
  For mock data it does, using `p-` plus a timestamp; the API may use its own
  format (for example a UUID) as long as it is URL-safe.
- `imageUrl` and `imageKey` are two different things:
  `imageKey` is the permanent location; `imageUrl` is how the browser displays
  it. With a private bucket, `imageUrl` may be a temporary presigned URL.
- DynamoDB attribute names, partition keys, sort keys, and GSI keys are
  **internal to the backend** and are not part of this contract. For example,
  a DynamoDB item may also contain `PK`/`SK` attributes; the API should not
  expose them.
- Extra fields in responses are ignored by the frontend. Removing fields from
  this list is a breaking change and needs a contract update.

### Example product (response)

```json
{
  "id": "p-barako",
  "name": "Barako Coffee Beans",
  "description": "Bold liberica beans grown in the highlands of Batangas, roasted in small batches for a deep, chocolatey cup. Sold as whole beans in a resealable 250 g bag.",
  "price": 380,
  "category": "Pantry",
  "imageUrl": "https://sari-media.s3.ap-southeast-1.amazonaws.com/products/p-barako/barako.jpg?X-Amz-Algorithm=...&X-Amz-Expires=3600&X-Amz-Signature=...",
  "imageKey": "products/p-barako/barako.jpg",
  "createdAt": "2026-11-10T08:00:00.000Z",
  "updatedAt": "2026-11-18T09:30:00.000Z"
}
```

---

## 3. API conventions (Proposed)

| Item | Proposal |
| --- | --- |
| Base URL | `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}` — stored in `config.js` as `apiBaseUrl`. |
| Format | JSON only, UTF-8. Request header `Content-Type: application/json` (except the direct S3 upload, which sends raw file bytes). |
| Success | Any `2xx`. The frontend checks `response.ok`. |
| Empty list | `200` with `[]`. **Not** `404`. |
| Missing product | `404` with a JSON `message`. The detail page shows “Product not found”. |
| Delete success | `204` with no body, or `200` with a small JSON body. The frontend reads neither. |
| Create success | `201` with the created product. The frontend reloads the list, so the body is optional but useful. |
| Errors | Status `4xx`/`5xx` with a JSON body: `message` (required) and optional `errors` (field map). |
| Prices | JSON numbers, not strings. |
| Dates | ISO 8601 strings in UTC. |
| CORS | API Gateway must allow the frontend origin(s) and the methods `GET, POST, PUT, DELETE, OPTIONS`, plus the `Content-Type` header. |

### Error body

```json
{
  "message": "Please check the highlighted fields.",
  "errors": {
    "price": "Enter a price greater than 0.",
    "description": "Add a description of at least 20 characters."
  }
}
```

- The current frontend shows `message` in a toast. `errors` is **proposed** so
  field-level messages can be displayed later; until then it is ignored.
- Errors must never include stack traces, AWS account IDs, ARNs, or secrets.

### Status codes the frontend expects

| Operation | Status | Frontend result |
| --- | --- | --- |
| List products | `200` | Grid renders; empty array shows the empty state. |
| Get one product | `200` / `404` | Detail page renders / “Product not found”. |
| Create product | `201` (any `2xx` accepted) | Dialog closes, success toast, list refreshes. |
| Update product | `200` | Same as create. |
| Delete product | `204` or `200` | Confirmation closes, success toast, list refreshes. |
| Validation error | `400` | Error toast (field-level later). |
| Unknown product on update/delete | `404` | Error toast. |
| Image too large | `413` | Error toast. |
| Server failure | `500` | Error toast: “The server could not complete the request.” |

Any other `2xx` or `3xx` is not handled specially. `401`/`403` would currently
appear as a generic toast (see Section 8 about admin access).

---

## 4. Proposed endpoints

All of these are proposals pending agreement with Edres. They match the
“Planned API Endpoints” table in `PROJECT_PLAN.md`.

| # | Method | Path | Purpose | Auth today |
| --- | --- | --- | --- | --- |
| 1 | `GET` | `/products` | List products; optional search and category filter | None |
| 2 | `GET` | `/products/{id}` | Get one product | None |
| 3 | `POST` | `/products` | Create a product | None |
| 4 | `PUT` | `/products/{id}` | Replace a product's editable fields | None |
| 5 | `DELETE` | `/products/{id}` | Delete a product | None |
| 6 | `POST` | `/images` | Request a presigned S3 upload URL | None |

**No categories endpoint is proposed for now** (see Section 8). The frontend
currently derives categories from products, which breaks on an empty catalog.

### 4.1 `GET /products`

Query parameters:

| Name | Type | Required | Behaviour |
| --- | --- | --- | --- |
| `q` | string | No | Case-insensitive search. Current frontend mock matches `name`, `description`, and `category`. |
| `category` | string | No | Exact category match. Omitted or `all` means no filter. |

Example request:

```
GET /products?q=coffee&category=Pantry
```

Example response — `200`:

```json
[
  {
    "id": "p-barako",
    "name": "Barako Coffee Beans",
    "description": "Bold liberica beans grown in the highlands of Batangas, roasted in small batches for a deep, chocolatey cup. Sold as whole beans in a resealable 250 g bag.",
    "price": 380,
    "category": "Pantry",
    "imageUrl": "https://sari-media.s3.ap-southeast-1.amazonaws.com/...",
    "imageKey": "products/p-barako/barako.jpg",
    "createdAt": "2026-11-10T08:00:00.000Z",
    "updatedAt": "2026-11-18T09:30:00.000Z"
  }
]
```

Empty result — `200`:

```json
[]
```

Failure — `500`:

```json
{ "message": "The server could not complete the request." }
```

**Proposed list order:** newest first (`createdAt` descending). This differs
from the current mock order, which is hand-curated. See Section 8.

**Pagination:** not proposed for this project. The catalog is small and the
frontend renders every item. The backend should still return at most 100 items
to avoid accidental load.

### 4.2 `GET /products/{id}`

Example: `GET /products/p-barako`

Success — `200`: a single product object (same shape as above).

Not found — `404`:

```json
{ "message": "Product not found." }
```

The frontend converts `404` into `null` and shows its “Product not found” state.

### 4.3 `POST /products`

Request body — only the editable fields:

```json
{
  "name": "Calamansi Marmalade",
  "description": "Slow-cooked calamansi marmalade with raw honey and a little sea salt. Bright, tart, and excellent on warm bread. 220 g glass jar.",
  "price": 260,
  "category": "Pantry",
  "imageKey": "uploads/2f1c9a7e-....jpg"
}
```

- `id`, `createdAt`, and `updatedAt` are generated by the backend.
- The frontend currently also sends `imageUrl`. During real S3 integration it
  will send `imageKey` and may send a temporary preview URL; the backend should
  treat `imageKey` as the source of truth and ignore client-supplied
  `imageUrl` (see Section 8).
- Validation failures — `400`:

```json
{
  "message": "Please check the highlighted fields.",
  "errors": {
    "name": "Enter a product name (at least 2 characters).",
    "price": "Enter a price greater than 0.",
    "category": "Choose a category.",
    "description": "Add a description of at least 20 characters."
  }
}
```

Success — `201`:

```json
{
  "id": "p-8c3f1e20",
  "name": "Calamansi Marmalade",
  "description": "Slow-cooked calamansi marmalade with raw honey and a little sea salt. Bright, tart, and excellent on warm bread. 220 g glass jar.",
  "price": 260,
  "category": "Pantry",
  "imageUrl": "https://sari-media.s3.ap-southeast-1.amazonaws.com/...",
  "imageKey": "uploads/2f1c9a7e-....jpg",
  "createdAt": "2026-11-20T10:02:11.000Z",
  "updatedAt": "2026-11-20T10:02:11.000Z"
}
```

### 4.4 `PUT /products/{id}`

Example: `PUT /products/p-barako`

Request body: same fields as create. `PUT` is used as a full replacement of the
editable fields; the current admin form always sends all of them.

Success — `200`: the updated product (with a new `updatedAt`).

Not found — `404`:

```json
{ "message": "Product not found." }
```

### 4.5 `DELETE /products/{id}`

Example: `DELETE /products/p-barako`

Success — `204` with no body.

Not found — `404`:

```json
{ "message": "Product not found." }
```

Image cleanup is described in Section 5.4.

### 4.6 `POST /images`

Requests a presigned upload URL. Details and examples are in Section 5.

---

## 5. Image upload workflow

### 5.1 Current mock behaviour (Confirmed)

1. Admin selects a file in the dialog.
2. `admin.js` checks the size is at most 2 MB.
3. `SARI.api.uploadImage(file)` reads the file as a base64 data URL.
4. The data URL is stored in `imageUrl`, and `imageKey` becomes `local/<filename>`.
5. The product is saved to `localStorage`, which is why this cannot be used for
   the real system: it is not S3, it is not shared, and the browser storage
   limit is quickly reached.

The mock never contacts AWS and never uses credentials.

### 5.2 Target flow with S3 (Proposed)

The bucket stays **private**. The browser receives a short-lived permission
slip instead of credentials.

```
Admin selects image
        │
        ▼
POST /images  { contentType, fileSize }
        │
        ▼
Lambda validates type/size, creates an object key,
returns { uploadUrl, imageKey, expiresIn, headers }
        │
        ▼
Browser PUTs the file bytes directly to uploadUrl
        │
        ▼
Browser sends imageKey with POST /products or PUT /products/{id}
        │
        ▼
Lambda stores imageKey and returns a displayable imageUrl
```

Why this is safe:

- The frontend never sees AWS access keys.
- The presigned URL grants permission to upload **one object** for a few
  minutes. It cannot list, read, or delete anything else.
- The bucket itself remains private for uploads and writes.

Example request:

```json
POST /images

{
  "contentType": "image/jpeg",
  "fileSize": 184320
}
```

Example response — `200`:

```json
{
  "uploadUrl": "https://sari-media.s3.ap-southeast-1.amazonaws.com/uploads/2f1c9a7e-9a3f-4c1e-a55e-01d9a2f4b77c.jpg?X-Amz-Algorithm=...&X-Amz-Signature=...",
  "imageKey": "uploads/2f1c9a7e-9a3f-4c1e-a55e-01d9a2f4b77c.jpg",
  "method": "PUT",
  "headers": { "Content-Type": "image/jpeg" },
  "expiresIn": 300
}
```

The frontend then sends the raw file, **not JSON**:

```
PUT <uploadUrl>
Content-Type: image/jpeg
<binary image bytes>
```

Possible errors:

| Status | Body | Meaning |
| --- | --- | --- |
| `400` | `{ "message": "Only JPG, PNG, or WebP images are allowed." }` | Unsupported type. |
| `413` | `{ "message": "Choose an image under 2 MB." }` | File too large. |
| `500` | `{ "message": "The upload could not be prepared." }` | Signing failure. |

### 5.3 Producing `imageUrl` with a private bucket (Open — team decision)

Storing `imageKey` is not enough for `<img src>`. The team must pick one:

**Option A — presigned GET URLs (recommended for the demo)**

- Lambda generates a fresh presigned `GET` URL for `imageUrl` on every read.
- Bucket stays fully private.
- Expiry proposed at **1 hour** (`X-Amz-Expires=3600`).
- Never store the presigned URL in DynamoDB. Store only `imageKey` and generate
  `imageUrl` in the response.
- Cost: a URL stops working after it expires. Reloading the catalog gets new
  URLs; an old tab may show broken images until it reloads.

**Option B — a public-read prefix for product images**

- The bucket stays private except `products/*` and `uploads/*`, which are
  readable by anyone.
- `imageUrl` is a normal, permanent S3 object URL. The frontend needs no
  changes and images never expire.
- Cost: anyone with the URL can view the image. Acceptable for a shop catalog,
  but weaker than Option A and not a fully private bucket.

**Not available:** CloudFront is explicitly out of scope in `PROJECT_PLAN.md`
and must not be added without approval.

**Recommendation:** use Option A to honour the “private bucket” requirement.
Whichever option is chosen, the **frontend contract stays the same**: it only
needs a working `imageUrl` string.

### 5.4 Upload and delete behaviour

- **Replacing an image:** upload the new file, save the product with the new
  `imageKey`. Lambda may delete the old object after the update succeeds, or
  leave it for a cleanup task. This must be decided (Section 8).
- **Deleting a product:** `DELETE /products/{id}` should delete the product
  record and then attempt to delete its S3 object using the stored `imageKey`.
  If the S3 delete fails, the product deletion should still succeed; log the
  failure to CloudWatch. A missing image must not block deleting a record.
- **Abandoned uploads:** an admin can upload an image and then cancel the form.
  That object becomes orphaned. For the demo this is acceptable. A future
  cleanup could use an S3 lifecycle rule on `uploads/`; that is not part of
  this phase.
- **Limits:** 2 MB, JPG/PNG/WebP. The frontend checks this today, but the
  backend must check it too. A presigned `PUT` alone cannot reliably enforce a
  size limit; use a presigned `POST` policy with `content-length-range`, or
  verify the object with `HeadObject` after upload. Edres and the team leader
  should choose the approach.

### 5.5 Security rules

- No AWS keys, session tokens, or bucket credentials in `frontend/`.
- The upload URL must expire quickly and be limited to one object key.
- The backend must validate `contentType` and `fileSize` **before** signing.
- The S3 bucket must not allow public writes.
- CORS on the bucket must allow `PUT` from the frontend origin if the browser
  uploads directly to S3.

---

## 6. Frontend integration requirements

### 6.1 What the backend must return

1. **Valid JSON** for every response, including errors. The only exception is
   `204`, which has no body.
2. **JSON numbers for prices** — `380`, not `"380"`.
3. **ISO 8601 UTC dates** for `createdAt` and `updatedAt`.
4. **The full product object** on list, get, create, and update. The admin page
   reloads the list after saving, so a partial create response is not fatal,
   but a full object keeps the contract simple.
5. **`message`** in every error body. This is the text shown to the user.
6. **CORS** for the frontend origin(s), including the preflight `OPTIONS`
   request, and the `Content-Type` header.

### 6.2 How the frontend handles each case

| Situation | Backend response | Frontend behaviour |
| --- | --- | --- |
| Empty catalog | `200 []` | Catalog shows “The catalog is empty”; admin shows “No products yet”. |
| No search matches | `200 []` | “Nothing matches yet” with Clear filters. |
| Missing product | `404` + message | Detail page: “Product not found”. |
| Validation failure | `400` + `message` (+ `errors`) | Toast with `message`. Field-level display is a future improvement. |
| Not found on update/delete | `404` + message | Error toast; list does not change. |
| Network/CORS failure | No response | Catalog error state with Try again; admin shows a toast. |
| Server error | `500` + message | Error toast. |
| Slow response | — | The existing catalog grid dims while loading (`aria-busy`); there is no spinner or skeleton. Admin disables Save while waiting. |

### 6.3 Known frontend limitations

- Mock mode stores images as data URLs in `localStorage`; real mode needs the
  S3 flow.
- `api.js` currently requires `imageUrl` to validate a form submission. With a
  presigned upload it must validate on `imageKey` (or the upload response)
  instead. This is a **planned frontend change during integration**, not part
  of this preparation phase.
- Only `message` is shown for server errors today; the `errors` map is not
  rendered.
- No retry logic and no request timeout are implemented.
- Admin write endpoints have no authentication today (Section 8).

---

## 7. Confirmed vs proposed — summary

| Item | Status |
| --- | --- |
| Pages call only `SARI.api` | Confirmed |
| Mock data via `localStorage` | Confirmed |
| Product fields in Section 2 | Confirmed for the frontend; DynamoDB representation is Bayabao's design |
| Client validation rules (name 2–80, description 20–600, price ≤ 1,000,000, 2 MB image) | Confirmed in the frontend |
| `GET/POST/PUT/DELETE /products`, `POST /images` | Proposed |
| JSON array for `GET /products` | Confirmed frontend expectation, with a `{ items }` fallback |
| Error envelope `{ message, errors }` | Proposed (only `message` is read today) |
| Presigned upload to S3 | Proposed |
| Presigned GET for `imageUrl` | Proposed; not agreed |
| Authentication for admin writes | Open |
| Pagination | Not proposed |
| CloudFront | Out of scope — do not add |

---

## 8. Open decisions and conflicts

These need a team decision before implementation. They are the places where the
current frontend and a straightforward backend can disagree.

1. **Category list (blocking for an empty database).**
   The frontend derives categories from products. If the table is empty, the
   admin category dropdown is empty and the first product cannot be added.
   Options: a fixed list in the frontend, a fixed list in Lambda, or a
   `GET /categories` endpoint. Proposal: agree on the fixed list
   **Pantry, Home & Living, Wellness** and keep it in one place.

2. **Image delivery with a private bucket.** Choose Option A (presigned GET) or
   Option B (public-read prefix) from Section 5.3. This changes Lambda, not the
   frontend contract.

3. **Search behaviour.** The mock searches name, description, and category with
   a case-insensitive substring match. DynamoDB cannot do this efficiently with
   a key lookup; a `Scan` with `FilterExpression` is acceptable for a small
   catalog but should be a conscious decision. If search is narrowed to name
   only, the frontend behaviour changes and the contract must say so.

4. **List order.** The mock uses a curated order; new mock products are added at
   the top. Proposal: `createdAt` descending. Confirm so the catalog does not
   reorder unexpectedly.

5. **Pagination.** The frontend expects all products in one response. Proposal:
   no pagination, maximum 100 products.

6. **Price precision.** The UI treats prices as whole pesos (`step="1"`, no
   decimals in the formatter). Confirm that centavos are not required. If they
   are, both the API and the formatter must change.

7. **`imageUrl` from the client.** The frontend currently sends both `imageUrl`
   and `imageKey` on create/update. Proposal: the backend ignores client
   `imageUrl`, stores `imageKey`, and always computes `imageUrl`.

8. **Admin authentication.** Admin write endpoints are proposed with no auth,
   and the frontend has no login (customer accounts are out of scope). For a
   real deployment this means anyone with the API URL can add or delete
   products. Options: accept this risk for the academic demo and document it,
   or add a minimal authorizer. **Do not put a secret in the static frontend**;
   it cannot be kept secret.

9. **Old image cleanup.** Decide whether replacing or deleting a product also
   deletes the previous S3 object, and whether failures block the operation.
   Proposal: delete best-effort, log failures, never block the product change.

10. **Image type enforcement.** The file input accepts any `image/*` while the
    hint says JPG, PNG, WebP. Proposal: allow exactly `image/jpeg`,
    `image/png`, `image/webp` in Lambda and in the upload form.

11. **CORS origins.** Confirm the final frontend origin (S3 website endpoint)
    and keep `http://localhost:8123` for local development. Avoid `*` for
    origins if an authorizer or credentials are added later.

12. **Timestamps.** Confirm that Lambda sets `createdAt`/`updatedAt`, not the
    client. The frontend ignores them on write.

---

## 9. Team integration checklist

**The contract must be reviewed and agreed by all three members before
implementation starts.** Record the agreement in the table at the end.

### Shared (all)

- [ ] Review this document section by section.
- [ ] Resolve every item in Section 8 and record the decision in this file.
- [ ] Freeze version 1.0 of this contract before Lambda work begins.
- [ ] Agree on the API base URL format and stage name (`prod` or `dev`).
- [ ] Run one end-to-end test together before the deadline.

### Abdul Malik — frontend, S3, IAM, integration

- [ ] Implement the real `uploadImage` flow: request a presigned URL, upload,
      return `imageKey`.
- [ ] Change form validation to require `imageKey` instead of `imageUrl`.
- [ ] Set `useMockData: false` and `apiBaseUrl` in `config.js` for integration
      (keep mock mode available for local work).
- [ ] Confirm the admin UI handles `400`, `404`, `413`, `500`, and network
      failures.
- [ ] Create the S3 media bucket and IAM permissions only after team approval;
      no public write access, no credentials in the repository.
- [ ] Configure bucket CORS for the final frontend origin.
- [ ] Re-run the frontend tests against the real API and save evidence under
      `documentation/evidence/`.

### Bayabao — DynamoDB schema, indexes, sample data

- [ ] Confirm the item attributes match Section 2 (`productId`, name,
      description, price as Number, category, imageKey, timestamps).
- [ ] Define the partition key and the category access pattern (GSI or scan).
- [ ] Decide how search is supported and tell Edres and Abdul Malik.
- [ ] Load sample records whose fields match Section 2 exactly.
- [ ] Confirm behaviour with an empty table and with a missing product.
- [ ] Test a create/update/delete cycle and record the results.
- [ ] Report whether `createdAt` ordering needs a sort key or GSI.

### Edres — Lambda, API Gateway, backend integration

- [ ] Review and agree the endpoints in Section 4, or propose changes.
- [ ] Implement validation that matches Section 2 and Section 6 (lengths,
      price range, required image, allowed types, 2 MB).
- [ ] Return the error envelope `{ message, errors }` with the status codes in
      Section 3.
- [ ] Return `[]` for an empty catalog and `404` for a missing product.
- [ ] Provide `POST /images` with a short-lived presigned upload URL and key.
- [ ] Return a displayable `imageUrl` according to the team's Section 5.3 choice.
- [ ] Enable CORS for the agreed origins, including `OPTIONS`.
- [ ] Confirm that Lambda sets timestamps and generates IDs.
- [ ] Log errors to CloudWatch without exposing secrets.
- [ ] Test every endpoint with curl or Postman and save evidence under
      `documentation/evidence/`.
- [ ] Provide the final base URL to Abdul Malik.

### Joint integration tests

- [ ] Catalog loads with an empty table.
- [ ] Add a product with an uploaded image; it appears in the catalog.
- [ ] Edit a product; the change appears after reload.
- [ ] Delete a product; it disappears and the image is handled as agreed.
- [ ] Invalid form data returns `400` and a readable message.
- [ ] A missing ID returns `404` on get, update, and delete.
- [ ] An oversized or wrong-type image is rejected by the server.
- [ ] CORS works from the deployed frontend origin and from localhost.

### Agreement

| Member | Role | Agreed on version | Signature / date |
| --- | --- | --- | --- |
| Abdul Malik | Frontend, S3, IAM, integration | | |
| Bayabao | DynamoDB | | |
| Edres | Lambda, API Gateway, API | | |

---

## 10. Next implementation step

After this contract is reviewed and version 1.0 is agreed:

1. Edres implements the endpoints against sample data and confirms the exact
   JSON shapes.
2. Abdul Malik connects `api.js` to the API with `useMockData: false` and runs
   the five product operations **before** image upload.
3. The team adds the S3 upload flow once the JSON contract is proven.
4. Images and CORS are tested last, because they add the most failure points.

Until then, the frontend stays on mock data and continues to work without AWS.
