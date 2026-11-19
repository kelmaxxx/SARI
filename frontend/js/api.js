// Data access for the SARI catalog.
// Every page calls SARI.api only, so connecting the AWS backend means
// changing this file and config.js — not the page scripts.
window.SARI = window.SARI || {};

(function (SARI) {
  "use strict";

  var STORE_KEY = "sari.products.v1";
  var memoryProducts = null;

  function config() {
    return window.SARI_CONFIG || {};
  }

  function isMock() {
    return config().useMockData !== false;
  }

  function seedProducts() {
    return JSON.parse(JSON.stringify(window.SARI_MOCK.products));
  }

  // The sample catalog is kept in localStorage so admin edits survive a reload.
  function readProducts() {
    if (memoryProducts) return memoryProducts;

    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        memoryProducts = JSON.parse(raw);
        return memoryProducts;
      }
    } catch (err) {
      // Storage can be unavailable; fall back to an in-memory copy.
    }

    memoryProducts = seedProducts();
    return memoryProducts;
  }

  function saveProducts(products) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(products));
    } catch (err) {
      throw new Error(
        "This change could not be saved in your browser. The product image may be too large."
      );
    }
    memoryProducts = products;
  }

  function matches(product, query, category) {
    if (category && category !== "all" && product.category !== category) {
      return false;
    }
    if (!query) return true;

    var haystack = [product.name, product.description, product.category]
      .join(" ")
      .toLowerCase();
    return haystack.indexOf(query.toLowerCase()) !== -1;
  }

  function validateProduct(input) {
    var errors = {};
    var name = String(input.name || "").trim();
    var description = String(input.description || "").trim();
    var category = String(input.category || "").trim();
    var price = Number(input.price);

    if (name.length < 2) errors.name = "Enter a product name (at least 2 characters).";
    if (!category) errors.category = "Choose a category.";
    if (!Number.isFinite(price) || price <= 0) {
      errors.price = "Enter a price greater than 0.";
    } else if (price > 1000000) {
      errors.price = "Keep the price under ₱1,000,000.";
    }
    if (description.length < 20) {
      errors.description = "Add a description of at least 20 characters.";
    }
    if (!input.imageUrl) errors.image = "Add a product image.";

    return errors;
  }

  function cleanInput(input) {
    return {
      name: String(input.name || "").trim(),
      description: String(input.description || "").trim(),
      price: Number(input.price),
      category: String(input.category || "").trim(),
      imageUrl: String(input.imageUrl || "").trim(),
      imageKey: String(input.imageKey || "").trim(),
    };
  }

  function newId() {
    return "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // --- Real API helpers -------------------------------------------------

  function apiUrl(path) {
    return String(config().apiBaseUrl || "").replace(/\/$/, "") + path;
  }

  function request(path, options) {
    options = options || {};

    return fetch(apiUrl(path), {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body,
    }).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            var err = new Error(body.message || "The server could not complete the request.");
            err.status = res.status;
            throw err;
          });
      }
      return res.status === 204 ? null : res.json();
    });
  }

  // --- Public API -------------------------------------------------------

  SARI.api = {
    validateProduct: validateProduct,

    getProducts: async function (filters) {
      filters = filters || {};
      var query = String(filters.q || "").trim();
      var category = filters.category || "all";

      if (isMock()) {
        return JSON.parse(JSON.stringify(readProducts())).filter(function (product) {
          return matches(product, query, category);
        });
      }

      var params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category !== "all") params.set("category", category);

      var qs = params.toString();
      var data = await request("/products" + (qs ? "?" + qs : ""));
      // shortcut: assumes the list endpoint returns an array; adjust here if the contract returns { items }.
      return Array.isArray(data) ? data : data.items || [];
    },

    getProduct: async function (id) {
      if (isMock()) {
        var found = readProducts().find(function (product) {
          return product.id === id;
        });
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }

      try {
        return await request("/products/" + encodeURIComponent(id));
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },

    getCategories: async function () {
      var products = isMock()
        ? readProducts()
        : await this.getProducts({});

      return products
        .map(function (product) {
          return product.category;
        })
        .filter(function (category, index, list) {
          return category && list.indexOf(category) === index;
        })
        .sort();
    },

    createProduct: async function (input) {
      var errors = validateProduct(input);
      if (Object.keys(errors).length) {
        throw new Error("Please check the highlighted fields.");
      }

      var product = Object.assign(cleanInput(input), {
        id: newId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      if (isMock()) {
        var products = readProducts().slice();
        products.unshift(product);
        saveProducts(products);
        return JSON.parse(JSON.stringify(product));
      }

      return request("/products", {
        method: "POST",
        body: JSON.stringify(cleanInput(input)),
      });
    },

    updateProduct: async function (id, input) {
      var errors = validateProduct(input);
      if (Object.keys(errors).length) {
        throw new Error("Please check the highlighted fields.");
      }

      if (isMock()) {
        var products = readProducts().slice();
        var index = products.findIndex(function (product) {
          return product.id === id;
        });
        if (index === -1) throw new Error("That product could not be found.");

        products[index] = Object.assign({}, products[index], cleanInput(input), {
          updatedAt: new Date().toISOString(),
        });
        saveProducts(products);
        return JSON.parse(JSON.stringify(products[index]));
      }

      return request("/products/" + encodeURIComponent(id), {
        method: "PUT",
        body: JSON.stringify(cleanInput(input)),
      });
    },

    deleteProduct: async function (id) {
      if (isMock()) {
        var products = readProducts().slice();
        var next = products.filter(function (product) {
          return product.id !== id;
        });
        if (next.length === products.length) {
          throw new Error("That product could not be found.");
        }
        saveProducts(next);
        return;
      }

      await request("/products/" + encodeURIComponent(id), { method: "DELETE" });
    },

    uploadImage: function (file) {
      if (!file) return Promise.reject(new Error("Choose an image first."));
      if (!/^image\//.test(file.type)) {
        return Promise.reject(new Error("Choose an image file (JPG, PNG, or WebP)."));
      }
      if (file.size > 2 * 1024 * 1024) {
        return Promise.reject(new Error("Choose an image under 2 MB."));
      }

      // shortcut: the mock stores the image as a data URL in localStorage;
      // the S3 upload (POST /images) will replace this at integration.
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve({ imageUrl: reader.result, imageKey: "local/" + file.name });
        };
        reader.onerror = function () {
          reject(new Error("The image could not be read."));
        };
        reader.readAsDataURL(file);
      });
    },
  };
})(window.SARI);
