# SARI

**A Cloud-Based Product Catalog and Media Repository**

SARI is an academic cloud computing project for small retail businesses. It provides a simple web catalog where customers can browse, search, and filter products, view product details and images, and where administrators can add, update, and delete products and upload product images.

The project demonstrates how **NoSQL databases and distributed storage** can be used to manage product information and digital media in the cloud.

---

## Project Information

| Item | Details |
| --- | --- |
| Project name | SARI |
| Main topic | NoSQL and Distributed Storage |
| Subtopic | Cloud Data Centers & Content Distribution (G1) |
| Type | Academic project |
| Project deadline | **November 29, 2026** |
| Current status | **Planning and documentation stage** — no application code or AWS resources have been created yet |

---

## Features

### Customer Catalog

- Browse all products
- Search products by name or keyword
- Filter products by category
- View product details, including price, description, and image

### Admin Product Management

- Add a new product
- Edit an existing product
- Delete a product
- Upload and replace product images
- View the product list as an administrator

### Planned Supporting Features

- Product records stored in a NoSQL database
- Product images and website files stored in cloud object storage
- Serverless backend API for catalog and admin operations
- Backend logs and basic monitoring

---

## Technologies

| Technology | Planned use |
| --- | --- |
| HTML, CSS, JavaScript | Frontend catalog and admin interface |
| Amazon DynamoDB | NoSQL storage for product records |
| Amazon S3 | Storage for website files and product images |
| AWS Lambda | Backend business logic |
| Amazon API Gateway | HTTP API endpoints for the frontend |
| Amazon CloudWatch | Backend logs and monitoring |
| Docker | Local development and containerization learning |
| Amazon CloudFront | **Optional — not approved, not implemented** |

> CloudFront is out of scope unless the team explicitly approves it. It must not be added to the implementation without approval.

---

## Team Assignments

| Member | Responsibilities |
| --- | --- |
| **Team Leader** | Frontend development, S3, IAM, integration, coordination, final documentation |
| **Bayabao** | DynamoDB database design, table/index setup, sample records, database testing |
| **Edres** | Lambda, API Gateway, backend integration, CloudWatch, backend testing |

Responsibilities overlap at integration points. The team leader coordinates handoffs and final integration.

---

## Scope

### In Scope

1. **Customer catalog** — browse, search, category filtering, product details, and product images.
2. **Admin product management** — add, edit, and delete products, and upload product images.

### Out of Scope

The following are explicitly excluded:

- Shopping cart
- Checkout
- Payment processing
- Shipping and delivery tracking
- Customer accounts or login
- Ratings, reviews, recommendations, and other marketplace features

---

## Planned Architecture (High Level)

```
Browser (HTML / CSS / JavaScript)
        |
        v
Amazon API Gateway
        |
        v
AWS Lambda  --->  Amazon DynamoDB (product records)
        |
        +------->  Amazon S3 (product images)
        |
        +------->  Amazon CloudWatch (logs and monitoring)
```

- The frontend is served from Amazon S3.
- API Gateway exposes the backend endpoints.
- Lambda handles product CRUD logic and image-related operations.
- DynamoDB stores product records.
- S3 stores product images.
- CloudWatch receives backend logs.

This is a **planned architecture**. Nothing has been deployed yet.

---

## Repository Structure (Current)

```
SARI/
├── backend/
│   └── local-development/
├── documentation/
│   └── evidence/
├── frontend/
│   ├── assets/
│   │   ├── icons/
│   │   └── images/
│   ├── css/
│   └── js/
├── .gitignore
├── PROJECT_PLAN.md
└── README.md
```

The folders are placeholders for upcoming work. Project documentation is the only completed deliverable at this stage.

---

## Project Status

| Area | Status |
| --- | --- |
| Project documentation | In progress |
| Repository structure | Initial scaffold created |
| Frontend | Not started |
| DynamoDB design | Not started |
| Lambda and API Gateway | Not started |
| S3 and IAM setup | Not started |
| CloudWatch monitoring | Not started |
| Integration and testing | Not started |
| CloudFront | Not approved, not planned for implementation |

---

## Getting Started

There is no runnable application yet. Once development begins, setup and run instructions will be added here.

Planned local development approach:

1. Open the frontend files directly in a browser or use a simple local static server.
2. Use Docker for local backend development and containerization practice.
3. Use AWS services only after the team has reviewed and approved the planned resources.

---

## Documentation

- [PROJECT_PLAN.md](PROJECT_PLAN.md) — objectives, architecture, requirements, responsibilities, timeline, and development rules.

---

## Deadline

**November 29, 2026**

All planned features, integration, testing, and final documentation must be completed by this date.
