// Product detail page. Reads the product id from the query string.
(function (SARI) {
  "use strict";

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    var view = document.getElementById("product-view");
    if (!view) return;

    var id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      renderMissing(view, "No product was selected.");
      return;
    }

    view.innerHTML =
      '<div class="page-loading"><i data-lucide="loader-2" class="spin" aria-hidden="true"></i><p>Loading product…</p></div>';
    SARI.refreshIcons();

    try {
      var product = await SARI.api.getProduct(id);
      if (!product) {
        renderMissing(view, "This product is no longer in the catalog.");
        return;
      }
      renderProduct(view, product);
    } catch (err) {
      renderMissing(view, err.message || "Please check your connection and try again.", true);
    }
  }

  function renderProduct(view, product) {
    var name = SARI.escapeHtml(product.name);
    var category = SARI.escapeHtml(product.category);
    var categoryUrl = "index.html?category=" + encodeURIComponent(product.category);

    document.title = name + " — SARI";

    view.innerHTML =
      '<nav class="breadcrumb" aria-label="Breadcrumb">' +
      '<a href="index.html">Catalog</a>' +
      '<span aria-hidden="true">/</span>' +
      '<a href="' +
      categoryUrl +
      '">' +
      category +
      "</a>" +
      '<span aria-hidden="true">/</span>' +
      '<span aria-current="page">' +
      name +
      "</span>" +
      "</nav>" +
      '<article class="detail">' +
      '<div class="detail-media">' +
      '<img src="' +
      SARI.escapeHtml(product.imageUrl) +
      '" alt="' +
      name +
      '" width="800" height="600">' +
      "</div>" +
      '<div class="detail-info">' +
      '<p class="eyebrow">' +
      category +
      "</p>" +
      "<h1>" +
      name +
      "</h1>" +
      '<p class="detail-price">' +
      SARI.money(product.price) +
      "</p>" +
      '<p class="detail-desc">' +
      SARI.escapeHtml(product.description) +
      "</p>" +
      '<dl class="detail-meta">' +
      '<div class="meta-row"><dt>Category</dt><dd><a href="' +
      categoryUrl +
      '">' +
      category +
      "</a></dd></div>" +
      '<div class="meta-row"><dt>Availability</dt><dd>In store</dd></div>' +
      "</dl>" +
      '<div class="note">' +
      '<i data-lucide="store" aria-hidden="true"></i>' +
      "<p><strong>In-store only.</strong> This catalog is for browsing — ask for this item at the SARI counter.</p>" +
      "</div>" +
      '<a class="btn btn-ghost detail-back" href="index.html"><i data-lucide="arrow-left" aria-hidden="true"></i> Back to catalog</a>' +
      "</div>" +
      "</article>";

    SARI.refreshIcons();
  }

  function renderMissing(view, message, isError) {
    view.innerHTML =
      '<div class="state state-wide">' +
      '<span class="state-icon"><i data-lucide="' +
      (isError ? "wifi-off" : "package-x") +
      '" aria-hidden="true"></i></span>' +
      "<h3>" +
      (isError ? "We couldn’t load this product" : "Product not found") +
      "</h3>" +
      "<p>" +
      SARI.escapeHtml(message) +
      "</p>" +
      '<a class="btn btn-ghost" href="index.html">Back to catalog</a>' +
      "</div>";
    SARI.refreshIcons();
  }
})(window.SARI);
