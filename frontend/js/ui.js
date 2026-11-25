// Shared helpers for every page.
window.SARI = window.SARI || {};

(function (SARI) {
  "use strict";

  var priceFormat = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  });

  var dateFormat = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  SARI.money = function (value) {
    return priceFormat.format(Number(value) || 0);
  };

  SARI.formatDate = function (iso) {
    var date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
  };

  SARI.escapeHtml = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char];
    });
  };

  SARI.refreshIcons = function () {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  };

  SARI.debounce = function (fn, wait) {
    var timer;
    return function () {
      var args = arguments;
      var context = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, wait);
    };
  };

  SARI.toast = function (message, kind) {
    kind = kind || "success";

    var host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      host.className = "toast-host";
      document.body.appendChild(host);
    }

    var toast = document.createElement("div");
    toast.className = "toast toast-" + kind;
    toast.setAttribute("role", kind === "error" ? "alert" : "status");
    toast.innerHTML =
      '<i data-lucide="' +
      (kind === "error" ? "alert-circle" : "check-circle-2") +
      '" aria-hidden="true"></i><span></span>';
    toast.querySelector("span").textContent = message;
    host.appendChild(toast);
    SARI.refreshIcons();

    setTimeout(function () {
      toast.classList.add("is-leaving");
    }, 3200);
    setTimeout(function () {
      toast.remove();
    }, 3600);
  };

  // Header border appears once the page scrolls; it hides on scroll down and
  // returns on scroll up.
  document.addEventListener("DOMContentLoaded", function () {
    var header = document.querySelector("[data-header]");
    if (header) {
      var lastY = window.scrollY;
      var onScroll = function () {
        var y = window.scrollY;
        header.classList.toggle("is-scrolled", y > 8);
        // Ignore tiny movements so the bar does not flicker.
        if (Math.abs(y - lastY) > 6) {
          header.classList.toggle("is-hidden", y > lastY && y > 120);
          lastY = y;
        }
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });

    SARI.refreshIcons();
  });
})(window.SARI);
