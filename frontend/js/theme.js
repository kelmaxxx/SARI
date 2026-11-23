// Light/dark theme. Loaded in <head> so the saved theme paints before first render.
(function () {
  "use strict";

  var KEY = "sari.theme";
  var root = document.documentElement;

  function apply(theme) {
    root.dataset.theme = theme;
  }

  function saved() {
    try {
      return localStorage.getItem(KEY);
    } catch (err) {
      return null;
    }
  }

  var choice = saved();
  if (choice !== "light" && choice !== "dark") {
    choice = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  apply(choice);

  function paint(button) {
    var next = root.dataset.theme === "dark" ? "light" : "dark";
    button.innerHTML =
      '<i data-lucide="' + (next === "light" ? "sun" : "moon") + '" aria-hidden="true"></i>';
    button.setAttribute("aria-label", "Switch to " + next + " mode");
    button.title = "Switch to " + next + " mode";
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function bind() {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      paint(button);
      button.addEventListener("click", function () {
        var next = root.dataset.theme === "dark" ? "light" : "dark";
        apply(next);
        try {
          localStorage.setItem(KEY, next);
        } catch (err) {
          // Private mode can refuse storage; the theme still applies for this page.
        }
        document.querySelectorAll("[data-theme-toggle]").forEach(paint);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
