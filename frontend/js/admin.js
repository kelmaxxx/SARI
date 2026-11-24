// Admin product management: list, add, edit, delete, and image selection.
(function (SARI) {
  "use strict";

  var state = {
    products: [],
    categories: [],
    editing: null,
    deleting: null,
    image: { file: null, url: "", key: "" },
  };
  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    els.rows = document.getElementById("product-rows");
    els.table = document.getElementById("product-table");
    els.empty = document.getElementById("admin-empty");
    els.count = document.getElementById("admin-count");
    els.search = document.getElementById("admin-search");
    els.addButton = document.getElementById("add-product");

    els.dialog = document.getElementById("product-dialog");
    els.form = document.getElementById("product-form");
    els.dialogTitle = document.getElementById("dialog-title");
    els.dialogKicker = document.getElementById("dialog-kicker");
    els.saveButton = document.getElementById("save-product");
    els.preview = document.getElementById("image-preview");
    els.file = document.getElementById("f-image");
    els.category = document.getElementById("f-category");

    els.confirm = document.getElementById("confirm-dialog");
    els.confirmText = document.getElementById("confirm-text");
    els.confirmButton = document.getElementById("confirm-delete");

    els.loading = document.getElementById("admin-loading");
    els.auth = document.getElementById("admin-auth");
    els.authMessage = document.getElementById("admin-auth-message");
    els.authAction = document.getElementById("admin-auth-action");
    els.content = document.getElementById("admin-content");

    if (!els.rows) return;

    var auth;
    try {
      auth = await SARI.auth.init();
    } catch (err) {
      auth = authFailure(err);
    }

    var gate = gateFor(auth);
    if (gate) {
      showGate(gate);
      return;
    }

    await startAdmin();
  }

  // Returns the gate state when the admin must not start, or null to proceed.
  function gateFor(auth) {
    if (auth.enabled && !auth.signedIn) return auth;

    // Real API mode must never open the admin without authentication.
    if ((window.SARI_CONFIG || {}).useMockData === false && !auth.enabled) {
      return {
        status: "config",
        error: "Sign-in is not configured for this site. Contact the site owner.",
      };
    }

    return null;
  }

  function authFailure(err) {
    return {
      enabled: true,
      status: "unavailable",
      signedIn: false,
      error: (err && err.message) || "Could not check your sign-in. Please try again.",
    };
  }

  function showGate(auth) {
    els.loading.hidden = true;
    els.content.hidden = true;
    els.addButton.hidden = true;
    els.auth.hidden = false;
    els.authMessage.textContent = auth.error || "";
    els.authAction.disabled = false;

    if (auth.status === "config") {
      els.authAction.textContent = "Reload";
      els.authAction.onclick = function () {
        window.location.reload();
      };
      return;
    }

    var retry = auth.status === "unavailable";
    els.authAction.textContent = retry ? "Try again" : "Sign in";

    els.authAction.onclick = async function () {
      if (!retry) {
        els.authAction.disabled = true;
        SARI.auth.signIn().catch(function (err) {
          els.authAction.disabled = false;
          els.authMessage.textContent =
            (err && err.message) || "Sign-in could not start. Please try again.";
        });
        return;
      }

      els.authAction.disabled = true;
      els.auth.hidden = true;
      els.loading.hidden = false;

      var next;
      try {
        next = await SARI.auth.init();
      } catch (err) {
        next = authFailure(err);
      }

      var gate = gateFor(next);
      if (gate) {
        showGate(gate);
      } else {
        await startAdmin();
      }
    };
  }

  async function startAdmin() {
    els.loading.hidden = true;
    els.auth.hidden = true;
    els.content.hidden = false;
    els.addButton.hidden = false;

    els.addButton.addEventListener("click", function () {
      openForm(null);
    });

    els.search.addEventListener(
      "input",
      SARI.debounce(function () {
        renderRows();
      }, 150)
    );

    els.rows.addEventListener("click", function (event) {
      var edit = event.target.closest("[data-edit]");
      var remove = event.target.closest("[data-delete]");
      if (edit) {
        var product = findProduct(edit.dataset.edit);
        if (product) openForm(product);
      } else if (remove) {
        var target = findProduct(remove.dataset.delete);
        if (target) openConfirm(target);
      }
    });

    els.empty.addEventListener("click", function (event) {
      if (event.target.closest("[data-empty-add]")) openForm(null);
    });

    bindForm();
    bindDialogs();

    await load();
  }

  async function load() {
    try {
      state.products = await SARI.api.getProducts({});
      state.categories = await SARI.api.getCategories();
      renderRows();
      fillCategories();
    } catch (err) {
      els.rows.innerHTML =
        '<tr><td colspan="5"><div class="table-message">' +
        SARI.escapeHtml(err.message) +
        "</div></td></tr>";
      els.count.textContent = "";
    }
  }

  function findProduct(id) {
    return state.products.find(function (product) {
      return product.id === id;
    });
  }

  function visibleProducts() {
    var term = els.search.value.trim().toLowerCase();
    if (!term) return state.products;
    return state.products.filter(function (product) {
      return (product.name + " " + product.category).toLowerCase().indexOf(term) !== -1;
    });
  }

  function renderRows() {
    var products = visibleProducts();
    var total = state.products.length;

    els.count.textContent =
      total + (total === 1 ? " product" : " products") +
      (products.length !== total ? " · " + products.length + " shown" : "");

    var hasProducts = total > 0;
    els.table.hidden = !hasProducts;
    els.empty.hidden = hasProducts;
    if (!hasProducts) return;

    if (!products.length) {
      els.rows.innerHTML =
        '<tr><td colspan="5"><div class="table-message">No products match that search.</div></td></tr>';
      return;
    }

    els.rows.innerHTML = products
      .map(function (product) {
        var name = SARI.escapeHtml(product.name);
        var category = SARI.escapeHtml(product.category);
        var description = SARI.escapeHtml(
          product.description.length > 64
            ? product.description.slice(0, 64).trimEnd() + "…"
            : product.description
        );

        return (
          "<tr>" +
          '<td><div class="cell-product">' +
          '<img src="' +
          SARI.escapeHtml(product.imageUrl) +
          '" alt="" width="46" height="46" loading="lazy">' +
          "<div><span class=\"cell-name\">" +
          name +
          '</span><span class="cell-desc">' +
          description +
          "</span></div></div></td>" +
          '<td><span class="tag">' +
          category +
          "</span></td>" +
          '<td class="cell-price">' +
          SARI.money(product.price) +
          "</td>" +
          '<td class="cell-date">' +
          SARI.formatDate(product.updatedAt) +
          "</td>" +
          '<td class="cell-actions">' +
          '<button type="button" class="icon-btn" data-edit="' +
          product.id +
          '" aria-label="Edit ' +
          name +
          '"><i data-lucide="pencil" aria-hidden="true"></i></button>' +
          '<button type="button" class="icon-btn icon-btn-danger" data-delete="' +
          product.id +
          '" aria-label="Delete ' +
          name +
          '"><i data-lucide="trash-2" aria-hidden="true"></i></button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    SARI.refreshIcons();
  }

  function fillCategories() {
    var options = state.categories.slice();
    if (state.editing && options.indexOf(state.editing.category) === -1) {
      options.push(state.editing.category);
    }
    els.category.innerHTML =
      '<option value="">Choose a category</option>' +
      options
        .map(function (category) {
          return (
            '<option value="' +
            SARI.escapeHtml(category) +
            '">' +
            SARI.escapeHtml(category) +
            "</option>"
          );
        })
        .join("");
  }

  function openForm(product) {
    state.editing = product;
    state.image = {
      file: null,
      url: product ? product.imageUrl : "",
      key: product ? product.imageKey : "",
    };

    els.form.reset();
    clearErrors();
    fillCategories();

    els.dialogKicker.textContent = product ? "Edit product" : "New product";
    els.dialogTitle.textContent = product ? "Edit product" : "Add a product";

    if (product) {
      els.form.elements.name.value = product.name;
      els.form.elements.category.value = product.category;
      els.form.elements.price.value = product.price;
      els.form.elements.description.value = product.description;
    }

    setPreview(state.image.url);
    els.dialog.showModal();
    els.form.elements.name.focus();
  }

  function setPreview(url) {
    els.preview.innerHTML = url
      ? '<img src="' + SARI.escapeHtml(url) + '" alt="Product image preview">'
      : '<i data-lucide="image" aria-hidden="true"></i><span>No image</span>';
    SARI.refreshIcons();
  }

  function bindForm() {
    document.getElementById("choose-image").addEventListener("click", function () {
      els.file.click();
    });

    els.file.addEventListener("change", function () {
      var file = els.file.files[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        els.file.value = "";
        showFieldError("image", "Choose an image under 2 MB.");
        return;
      }

      state.image.file = file;
      setPreview(URL.createObjectURL(file));
      clearFieldError("image");
    });

    els.form.addEventListener("submit", async function (event) {
      event.preventDefault();
      clearErrors();

      var input = {
        name: els.form.elements.name.value,
        category: els.form.elements.category.value,
        price: els.form.elements.price.value,
        description: els.form.elements.description.value,
        imageUrl: state.image.url,
        imageKey: state.image.key,
      };

      var hasImage = Boolean(state.image.key || state.image.file);
      var errors = SARI.api.validateProduct(
        Object.assign({}, input, {
          imageUrl: hasImage ? "pending" : "",
          imageKey: hasImage ? "pending" : "",
        })
      );

      if (Object.keys(errors).length) {
        showErrors(errors);
        return;
      }

      els.saveButton.disabled = true;
      els.saveButton.textContent = "Saving…";

      try {
        if (state.image.file) {
          var uploaded = await SARI.api.uploadImage(state.image.file);
          input.imageKey = uploaded.imageKey;
          // Mock mode returns a data URL; real mode keeps the existing preview.
          input.imageUrl = uploaded.imageUrl || input.imageUrl;
          state.image = { file: null, url: input.imageUrl, key: uploaded.imageKey };
        }

        if (state.editing) {
          await SARI.api.updateProduct(state.editing.id, input);
        } else {
          await SARI.api.createProduct(input);
        }

        els.dialog.close();
        SARI.toast(state.editing ? "Product updated." : "Product added.");
        await load();
      } catch (err) {
        SARI.toast(err.message, "error");
      } finally {
        els.saveButton.disabled = false;
        els.saveButton.textContent = "Save product";
      }
    });

    els.form.addEventListener("input", function (event) {
      if (event.target.name) clearFieldError(event.target.name);
    });
  }

  function clearErrors() {
    els.form.querySelectorAll("[data-error]").forEach(function (el) {
      el.textContent = "";
    });
    els.form.querySelectorAll("[aria-invalid]").forEach(function (el) {
      el.removeAttribute("aria-invalid");
    });
  }

  function clearFieldError(field) {
    var message = els.form.querySelector('[data-error="' + field + '"]');
    if (message) message.textContent = "";
    var input = els.form.elements[field];
    if (input) input.removeAttribute("aria-invalid");
  }

  function showErrors(errors) {
    Object.keys(errors).forEach(function (field) {
      showFieldError(field, errors[field]);
    });
    var first = Object.keys(errors)[0];
    var input = els.form.elements[first];
    if (input) input.focus();
  }

  function showFieldError(field, message) {
    var slot = els.form.querySelector('[data-error="' + field + '"]');
    if (slot) slot.textContent = message;
    var input = els.form.elements[field];
    if (input) input.setAttribute("aria-invalid", "true");
  }

  function bindDialogs() {
    document.querySelectorAll("[data-close]").forEach(function (button) {
      button.addEventListener("click", function () {
        button.closest("dialog").close();
      });
    });

    [els.dialog, els.confirm].forEach(function (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) dialog.close();
      });
    });

    els.confirmButton.addEventListener("click", async function () {
      if (!state.deleting) return;

      els.confirmButton.disabled = true;
      try {
        await SARI.api.deleteProduct(state.deleting.id);
        els.confirm.close();
        SARI.toast("Product deleted.");
        await load();
      } catch (err) {
        SARI.toast(err.message, "error");
      } finally {
        els.confirmButton.disabled = false;
        state.deleting = null;
      }
    });
  }

  function openConfirm(product) {
    state.deleting = product;
    els.confirmText.textContent =
      "“" + product.name + "” will be removed from the catalog. This cannot be undone.";
    els.confirm.showModal();
  }
})(window.SARI);
