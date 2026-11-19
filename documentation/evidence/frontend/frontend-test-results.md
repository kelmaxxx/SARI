# Frontend Test Results — SARI

| Item | Details |
| --- | --- |
| Date | November 20, 2026 |
| Scope | Customer catalog, product details, admin product management, image selection |
| Data source | Local sample data (`frontend/js/mock-data.js`) |
| Browser | Google Chrome, headless via the DevTools protocol |
| Server | `python -m http.server 8123 --directory frontend` |
| Viewports | 1440 × 900 desktop, 390 × 844 mobile |

All checks passed. The temporary test script was not committed.

## Automated checks (23/23 passed)

| Area | Check | Result |
| --- | --- | --- |
| Catalog | Renders 9 sample products | Pass |
| Catalog | Renders 4 category controls (All + 3 categories) | Pass |
| Catalog | Result count reads “9 products” | Pass |
| Catalog | “Pantry” filter shows 3 products | Pass |
| Catalog | Category filter updates the URL (`?category=Pantry`) | Pass |
| Catalog | Search “coffee” returns 2 matches (name and description) | Pass |
| Catalog | Unmatched search shows the empty state | Pass |
| Product detail | Loads name, price, and image for `p-barako` | Pass |
| Product detail | Unknown id shows “Product not found” | Pass |
| Admin | Product table lists 9 products | Pass |
| Admin | “Add product” opens the form dialog | Pass |
| Admin | Empty form submission shows 5 field errors | Pass |
| Admin | Saving without an image is blocked | Pass |
| Admin | Choosing a file fills the image preview | Pass |
| Admin | Saving with an image adds the product and closes the dialog | Pass |
| Admin | New product persists after a page reload | Pass |
| Admin | Delete opens a confirmation naming the product | Pass |
| Admin | Confirming delete returns the list to 9 products | Pass |
| Catalog | Deleted product no longer appears in search | Pass |
| Mobile | Catalog renders 9 products at 390 px width | Pass |
| Mobile | Admin table keeps edit and delete actions visible | Pass (visual) |
| Console | No uncaught errors during the flows | Pass |
| Direct open | `file:///.../frontend/index.html` loads and filters products | Pass |

## Screenshots

- [Catalog — desktop](catalog-desktop.png)
- [Catalog — mobile](catalog-mobile.png)
- [Catalog — empty state](catalog-empty-state.png)
- [Product detail](product-detail.png)
- [Admin — product list](admin-product-list.png)
- [Admin — mobile](admin-mobile.png)
- [Admin — add product](admin-add-product.png)
- [Admin — delete confirmation](admin-delete-confirm.png)

## Not covered yet

- **API integration.** The frontend uses `SARI.api` with mock data. API Gateway, Lambda, DynamoDB, and S3 are not connected.
- **Real image upload.** Selected images are stored as data URLs in `localStorage` (2 MB limit). The S3 upload flow will replace this in `js/api.js`.
- **Other browsers.** Only Chrome was used for this pass.
- **Repeatable test suite.** The checks were run with a temporary headless script; no test framework is included in the project.

## Reproduce manually

1. Run `python -m http.server 8123 --directory frontend` from the project root.
2. Open `http://localhost:8123/index.html`.
3. Search for “coffee”, filter by “Pantry”, then open a product.
4. Open `http://localhost:8123/admin.html`, add a product with an image, reload, edit it, and delete it.
5. Resize the browser to a phone width and repeat steps 3–4.

To reset the sample catalog, run `localStorage.removeItem("sari.products.v1")` in the browser console and reload.
