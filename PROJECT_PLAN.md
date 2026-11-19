# SARI — Project Plan

**A Cloud-Based Product Catalog and Media Repository**

| Item | Details |
| --- | --- |
| Main topic | NoSQL and Distributed Storage |
| Subtopic | Cloud Data Centers & Content Distribution (G1) |
| Development period | November 19–29, 2026 |
| Deadline | **November 29, 2026** |
| Current phase | Planning and documentation |

---

## 1. Project Objectives

SARI aims to demonstrate the practical use of NoSQL databases and distributed cloud storage in a small retail product catalog. By the end of the project, the team should be able to:

1. Store and retrieve structured product records using a NoSQL database (Amazon DynamoDB).
2. Store and serve website files and product images using cloud object storage (Amazon S3).
3. Expose backend operations through a serverless API (Amazon API Gateway and AWS Lambda).
4. Capture backend activity through logs and basic monitoring (Amazon CloudWatch).
5. Build a working frontend that lets customers browse the catalog and lets administrators manage products.
6. Explain how the components work together as a simple cloud-based, distributed system.
7. Document the design, implementation, testing, and evidence of the finished system.

The project is intentionally small. The goal is a clear, working demonstration, not a production marketplace.

---

## 2. Scope

### 2.1 In Scope

**Customer catalog**

- Browse all products
- Search products by name or keyword
- Filter products by category
- View product details
- View product images

**Admin product management**

- Add a product
- Edit a product
- Delete a product
- Upload a product image
- View and manage the product list

**Supporting scope**

- DynamoDB table and index design
- Sample product records
- S3 storage for website files and product images
- Lambda functions for product operations
- API Gateway endpoints
- CloudWatch logs and basic monitoring
- Local development with Docker
- Project documentation and testing evidence

### 2.2 Out of Scope

- Shopping cart
- Checkout and payment processing
- Shipping and delivery tracking
- Customer accounts, registration, or login
- Ratings, reviews, recommendations, or wishlists
- Multi-vendor or marketplace features
- Amazon CloudFront — **optional and not approved; do not implement**
- Production-grade security hardening, autoscaling, and cost optimization beyond what the course requires

Any feature outside this scope requires team agreement before work begins.

---

## 3. Planned Architecture

```
                        +----------------------------+
                        |  Browser                   |
                        |  HTML / CSS / JavaScript   |
                        +-------------+--------------+
                                      |
                                      | HTTPS
                                      v
                        +----------------------------+
                        |  Amazon API Gateway        |
                        +-------------+--------------+
                                      |
                                      v
                        +----------------------------+
                        |  AWS Lambda                |
                        |  Product + media logic     |
                        +------+--------------+------+
                               |              |
                               v              v
                  +------------------+   +------------------+
                  | Amazon DynamoDB  |   | Amazon S3        |
                  | Product records  |   | Images + website |
                  +------------------+   +------------------+
                               |
                               v
                  +----------------------------+
                  | Amazon CloudWatch         |
                  | Logs and monitoring       |
                  +----------------------------+
```

### 3.1 Component Responsibilities

| Component | Responsibility |
| --- | --- |
| Frontend (HTML/CSS/JS) | Customer catalog, search and filtering, product details, admin forms, calls to the API |
| Amazon S3 (website) | Hosts the static frontend files |
| Amazon S3 (media) | Stores uploaded product images |
| Amazon API Gateway | Provides REST endpoints for product operations |
| AWS Lambda | Validates requests and performs product CRUD and media operations |
| Amazon DynamoDB | Stores product records and supports category-based access |
| Amazon CloudWatch | Captures Lambda logs and basic operational metrics |
| IAM | Provides least-privilege permissions for the services above |

Each service is used only for its planned purpose. No additional services are introduced without approval.

### 3.2 Planned API Endpoints

These are tentative and will be finalized during integration.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/products` | List products, optionally filtered by category or search term |
| GET | `/products/{id}` | Get a single product |
| POST | `/products` | Create a product |
| PUT | `/products/{id}` | Update a product |
| DELETE | `/products/{id}` | Delete a product |
| POST | `/images` | Request an image upload or record image metadata |

Exact request and response formats will be agreed upon before frontend and backend integration.

### 3.3 Data Storage Approach

- Product records are stored in Amazon DynamoDB.
- A primary key and at least one access pattern for category filtering are planned.
- Product images are stored in Amazon S3, with a reference (such as an object key or URL) stored in the product record.
- The final table design, indexes, and sample records are owned by Bayabao and reviewed by the team before implementation.
- Binary image data is **not** stored directly in DynamoDB.

---

## 4. Feature Requirements

### 4.1 Customer Catalog

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| C1 | Browse products | The catalog page loads products from the API and displays name, price, category, and image |
| C2 | Search products | A search input filters products by name or keyword |
| C3 | Filter by category | A category control limits the displayed products to the selected category |
| C4 | View product details | Selecting a product shows its full description, price, category, and image |
| C5 | Handle empty and error states | The UI shows a clear message when no products match or the API fails |

### 4.2 Admin Product Management

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| A1 | Add a product | An admin form creates a product and the new record appears in the catalog |
| A2 | Edit a product | An admin can update product fields and see the changes reflected |
| A3 | Delete a product | An admin can remove a product after confirmation |
| A4 | Upload a product image | An admin can upload an image and associate it with a product |
| A5 | Validate input | Required fields are validated on the client and server |
| A6 | Report failures | Failed operations show a readable error message |

### 4.3 Backend and Operations

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| B1 | Product API | All planned CRUD endpoints respond correctly |
| B2 | NoSQL persistence | Products survive a backend restart and can be queried by category |
| B3 | Media storage | Uploaded images are stored in S3 and accessible from the frontend |
| B4 | Logging | Lambda invocations and errors appear in CloudWatch |
| B5 | Permissions | Each service has only the permissions it needs |
| B6 | Secret handling | No credentials or secrets are committed to the repository |

### 4.4 Non-Functional Requirements

- The interface works on common desktop and mobile screen sizes.
- Pages load in a reasonable time using sample data.
- User-facing errors are understandable to a non-technical user.
- The system remains within the free tier or a minimal budget where possible.
- Documentation is sufficient for another student to understand and run the project.

---

## 5. Team Responsibilities

| Member | Primary responsibilities | Deliverables |
| --- | --- | --- |
| **Team Leader** | Frontend development, S3, IAM, integration, coordination, final documentation | Frontend pages and styles, S3 setup, IAM permissions, integration, README and final report |
| **Bayabao** | DynamoDB database design, table/index setup, sample records, database testing | Table and index design, sample data, database test results |
| **Edres** | Lambda, API Gateway, backend integration, CloudWatch, backend testing | Lambda functions, API endpoints, logs and monitoring screenshots, backend test results |

### 5.1 Collaboration Rules

- Every member documents their own work as it is completed.
- API request and response formats are agreed upon before integration.
- The team leader reviews changes that affect other members.
- Blockers are raised in the team channel on the same day they are found.
- Evidence (screenshots, logs, test results) is saved under `documentation/evidence/`.

---

## 6. Development Timeline

| Date | Activities | Owner |
| --- | --- | --- |
| **Nov 19 (Thu)** | Finalize README and project plan; confirm scope; agree on API contract and data fields; prepare AWS account and IAM plan; set up local folder structure | All |
| **Nov 20 (Fri)** | DynamoDB table and index design; sample record format; frontend page structure and static layout; Lambda and API skeleton plan | Bayabao, Team Leader, Edres |
| **Nov 21 (Sat)** | Create DynamoDB table and sample records; build frontend catalog layout; implement first Lambda handler and API route | Bayabao, Team Leader, Edres |
| **Nov 22 (Sun)** | Database testing; connect catalog to API; complete product list and product details endpoints | Bayabao, Team Leader, Edres |
| **Nov 23 (Mon)** | Search and category filtering; add and edit product endpoints; admin form layout | All |
| **Nov 24 (Tue)** | Delete product flow; S3 bucket and image upload approach; admin image upload UI | Team Leader, Edres |
| **Nov 25 (Wed)** | Complete image upload and display; connect admin operations end to end; enable CloudWatch logging | All |
| **Nov 26 (Thu)** | Full integration; fix API/frontend mismatches; add loading, empty, and error states | All |
| **Nov 27 (Fri)** | End-to-end testing; database and backend test results; fix defects; review permissions | All |
| **Nov 28 (Sat)** | Final documentation; screenshots and evidence; cleanup; review scope compliance | Team Leader, All |
| **Nov 29 (Sun)** | Final review, submission, and deadline | All |

### 6.1 Milestones

| Milestone | Target date |
| --- | --- |
| Documentation and scope agreed | November 19, 2026 |
| Database design and sample data ready | November 21, 2026 |
| Catalog reads from the API | November 22, 2026 |
| Admin CRUD complete | November 25, 2026 |
| Image upload working end to end | November 25, 2026 |
| Integration complete | November 26, 2026 |
| Testing complete | November 27, 2026 |
| Final documentation complete | November 28, 2026 |
| Project submitted | November 29, 2026 |

The schedule is tight. If a milestone slips, the team reduces polish first and keeps the required catalog and admin flows working.

---

## 7. Development Rules

### 7.1 Scope and Planning

1. Build only what is listed in Section 2.1.
2. Do not add CloudFront or any unapproved service.
3. Discuss scope changes with the team before writing code.
4. Prefer the simplest solution that satisfies the requirement.
5. Keep the project understandable for a beginner audience.

### 7.2 Code and Repository

1. Keep frontend, backend, and documentation in their existing folders.
2. Use clear file and function names.
3. Keep configuration values out of source code where possible.
4. Do not commit secrets, access keys, tokens, or personal account details.
5. Do not commit generated build output, dependencies, or large binary files.
6. Update documentation when behavior or setup steps change.

### 7.3 AWS Usage

1. Do not create, modify, or delete AWS resources without the team's agreement.
2. Use only the services listed in the plan.
3. Follow least-privilege permissions for IAM.
4. Do not share AWS credentials in the repository or chat.
5. Record the resources created and their purpose for the final report.
6. Check the AWS console for unexpected charges after each work session.

### 7.4 Testing and Evidence

1. Test each feature before marking it complete.
2. Test both success and failure cases.
3. Save screenshots, logs, and test results under `documentation/evidence/`.
4. Report defects with steps to reproduce.
5. Do not claim a feature is complete until it has been tested by someone other than its author where possible.

### 7.5 Communication

1. Post progress and blockers daily.
2. Confirm API contracts in writing before integration.
3. Ask before overwriting another member's work.
4. Keep commits and messages focused on one change.

### 7.6 Documentation Standards

1. Write in clear, simple English.
2. Describe the current state accurately.
3. Clearly separate planned work from completed work.
4. Include setup steps, architecture notes, and testing evidence in the final documentation.

---

## 8. Risks and Mitigation

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Short timeline | Incomplete features | Prioritize required catalog and admin flows; reduce polish first |
| AWS setup delays | Backend blocked | Prepare accounts and permissions early; use local development in parallel |
| API contract mismatch | Integration rework | Agree on request/response formats before coding |
| Unclear DynamoDB access patterns | Redesign work | Finalize query patterns with sample data early |
| Accidental AWS charges | Budget issues | Use minimal resources; review the console after each session |
| Image upload complexity | Admin flow incomplete | Keep uploads simple; store images in S3 and save only references in DynamoDB |

---

## 9. Definition of Done

The project is complete when:

1. Customers can browse, search, filter, and view products and images.
2. Administrators can add, edit, and delete products and upload images.
3. Product data is stored in DynamoDB and images are stored in S3.
4. The frontend communicates with the backend through API Gateway.
5. Lambda activity and errors are visible in CloudWatch.
6. No secrets are committed to the repository.
7. Testing evidence is saved in `documentation/evidence/`.
8. README and final documentation describe the system accurately.

---

## 10. Current Status

**Planning and documentation stage.**

- Documentation is being prepared.
- The folder structure exists but is empty.
- No application code has been written.
- No AWS resources have been created.
- No packages have been installed.
- Git has not been initialized.

All items in this plan are planned work, not completed work.
