// Customer catalog: browse, search, and category filtering.
(function (SARI) {
  "use strict";

  var state = { q: "", category: "all", categories: [] };
  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    els.grid = document.getElementById("product-grid");
    els.chips = document.getElementById("category-chips");
    els.search = document.getElementById("search");
    els.clear = document.getElementById("search-clear");
    els.count = document.getElementById("results-count");
    if (!els.grid) return;

    var params = new URLSearchParams(window.location.search);
    state.q = params.get("q") || "";
    state.category = params.get("category") || "all";
    els.search.value = state.q;
    els.clear.hidden = !state.q;

    bindEvents();

    try {
      state.categories = await SARI.api.getCategories();
    } catch (err) {
      state.categories = [];
    }
    renderChips();
    loadProducts();
  }

  function bindEvents() {
    var runSearch = SARI.debounce(function () {
      state.q = els.search.value.trim();
      syncUrl();
      loadProducts();
    }, 220);

    els.search.addEventListener("input", function () {
      els.clear.hidden = !els.search.value;
      runSearch();
    });

    els.search.addEventListener("keydown", function (event) {
      if (event.key === "Escape") clearSearch();
    });

    els.clear.addEventListener("click", clearSearch);

    els.chips.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-category]");
      if (!chip) return;
      state.category = chip.dataset.category;
      renderChips();
      syncUrl();
      loadProducts();
    });

    els.grid.addEventListener("click", function (event) {
      if (event.target.closest("[data-clear-filters]")) {
        state.q = "";
        state.category = "all";
        els.search.value = "";
        els.clear.hidden = true;
        renderChips();
        syncUrl();
        loadProducts();
      } else if (event.target.closest("[data-retry]")) {
        loadProducts();
      }
    });
  }

  function clearSearch() {
    els.search.value = "";
    els.clear.hidden = true;
    state.q = "";
    syncUrl();
    loadProducts();
    els.search.focus();
  }

  function syncUrl() {
    var params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.category !== "all") params.set("category", state.category);
    var qs = params.toString();
    try {
      history.replaceState(null, "", qs ? "?" + qs : window.location.pathname);
    } catch (err) {
      // Some browsers block history changes on file:// pages.
    }
  }

  function renderChips() {
    var chips = ['<button type="button" data-category="all">All products</button>'];

    state.categories.forEach(function (category) {
      var value = SARI.escapeHtml(category);
      chips.push(
        '<button type="button" data-category="' + value + '">' + value + "</button>"
      );
    });

    els.chips.innerHTML = chips.join("");
    els.chips.querySelectorAll("[data-category]").forEach(function (chip) {
      var selected = chip.dataset.category === state.category;
      chip.classList.toggle("is-active", selected);
      chip.setAttribute("aria-pressed", String(selected));
    });
  }

  async function loadProducts() {
    els.grid.setAttribute("aria-busy", "true");
    els.grid.classList.add("is-loading");

    try {
      var products = await SARI.api.getProducts({
        q: state.q,
        category: state.category,
      });
      renderProducts(products);
      renderCount(products.length);
    } catch (err) {
      els.count.textContent = "";
      renderError(err.message);
    } finally {
      els.grid.setAttribute("aria-busy", "false");
      els.grid.classList.remove("is-loading");
    }
  }

  function renderCount(count) {
    if (state.q) {
      els.count.textContent =
        count + (count === 1 ? " result for “" : " results for “") + state.q + "”";
    } else {
      els.count.textContent = count + (count === 1 ? " product" : " products");
    }
  }

  function renderProducts(products) {
    if (!products.length) {
      var filtered = state.q || state.category !== "all";
      els.grid.innerHTML =
        '<li class="state">' +
        '<span class="state-icon"><i data-lucide="search-x" aria-hidden="true"></i></span>' +
        "<h3>" +
        (filtered ? "Nothing matches yet" : "The catalog is empty") +
        "</h3>" +
        "<p>" +
        (filtered
          ? "Try a different word, or clear the filters to see everything."
          : "Products will appear here once they are added.") +
        "</p>" +
        (filtered
          ? '<button type="button" class="btn btn-ghost" data-clear-filters>Clear filters</button>'
          : "") +
        "</li>";
      SARI.refreshIcons();
      return;
    }

    els.grid.innerHTML = products
      .map(function (product) {
        var name = SARI.escapeHtml(product.name);
        var category = SARI.escapeHtml(product.category);

        return (
          "<li>" +
          '<a class="product-card" href="product.html?id=' +
          encodeURIComponent(product.id) +
          '">' +
          '<span class="card-media">' +
          '<img src="' +
          SARI.escapeHtml(product.imageUrl) +
          '" alt="' +
          name +
          '" width="800" height="600" loading="lazy">' +
          "</span>" +
          '<span class="card-body">' +
          '<span class="card-category">' +
          category +
          "</span>" +
          '<span class="card-name">' +
          name +
          "</span>" +
          '<span class="card-foot">' +
          '<span class="card-price">' +
          SARI.money(product.price) +
          "</span>" +
          '<span class="card-link" aria-hidden="true"><i data-lucide="arrow-up-right"></i></span>' +
          "</span>" +
          "</span>" +
          "</a>" +
          "</li>"
        );
      })
      .join("");

    SARI.refreshIcons();
  }

  function renderError(message) {
    els.grid.innerHTML =
      '<li class="state">' +
      '<span class="state-icon"><i data-lucide="wifi-off" aria-hidden="true"></i></span>' +
      "<h3>We couldn’t load the catalog</h3>" +
      "<p>" +
      SARI.escapeHtml(message || "Please check your connection and try again.") +
      "</p>" +
      '<button type="button" class="btn btn-ghost" data-retry>Try again</button>' +
      "</li>";
    SARI.refreshIcons();
  }
})(window.SARI);
