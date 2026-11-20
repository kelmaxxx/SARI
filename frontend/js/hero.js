// Scroll-scrubbed hero: writes the hero's scroll progress (0–1) to --p.
// CSS owns the per-letter vectors, so the four S A R I letters stay declarative.
(function () {
  "use strict";

  var stage = document.querySelector("[data-hero]");
  if (!stage) return;

  // Reduced motion: leave the hero assembled and skip the scroll work entirely.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var frame = 0;

  function measure() {
    frame = 0;
    var travel = stage.offsetHeight - window.innerHeight;
    if (travel <= 0) return;

    var progress = -stage.getBoundingClientRect().top / travel;
    progress = Math.min(1, Math.max(0, progress));
    stage.style.setProperty("--p", progress.toFixed(4));
  }

  function requestMeasure() {
    if (!frame) frame = requestAnimationFrame(measure);
  }

  measure();
  window.addEventListener("scroll", requestMeasure, { passive: true });
  window.addEventListener("resize", requestMeasure);
})();
