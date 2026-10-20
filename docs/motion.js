/* Shared motion behavior for every JPN page. No dependencies. */
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealSelectors = [
    ".hero", ".intro", ".auth-card", ".section-head", ".card", ".plan",
    ".countdown-panel", ".panel", ".page-head", ".grid > *", ".note",
    ".feature", ".feature-list", ".form-tools", ".list-row", "footer"
  ];
  const elements = [...new Set(revealSelectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
  const eligible = elements.filter(el => !el.closest(".view:not(.active)") && !el.closest("[hidden]"));
  if (reduceMotion || !("IntersectionObserver" in window)) {
    eligible.forEach(el => el.classList.add("jpn-visible"));
    return;
  }
  eligible.forEach((el, index) => {
    el.classList.add("jpn-reveal");
    const siblings = el.parentElement ? eligible.filter(node => node.parentElement === el.parentElement) : [];
    const siblingIndex = siblings.indexOf(el);
    el.style.setProperty("--jpn-stagger", Math.min(siblingIndex, 5) * 65 + "ms");
    if (index === 0 && (el.matches(".hero, .intro, .page-head") || el.closest("header"))) el.classList.add("jpn-visible");
  });
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("jpn-visible");
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -36px 0px" });
  eligible.forEach(el => {
    if (!el.classList.contains("jpn-visible")) observer.observe(el);
    else el.classList.add("jpn-visible");
  });
  // When account tabs change, reveal the newly activated view's content too.
  document.querySelectorAll("[data-view], [data-go]").forEach(button => {
    button.addEventListener("click", () => {
      requestAnimationFrame(() => {
        const activeView = document.querySelector(".view.active");
        if (!activeView) return;
        activeView.querySelectorAll(".card, .page-head, .grid > *").forEach((el, index) => {
          el.classList.add("jpn-reveal");
          el.style.setProperty("--jpn-stagger", Math.min(index, 5) * 55 + "ms");
          requestAnimationFrame(() => el.classList.add("jpn-visible"));
        });
      });
    });
  });
  // Add a subtle scroll state without fighting each page's existing header styles.
  let ticking = false;
  const updateScrollState = () => {
    document.documentElement.classList.toggle("jpn-scrolled", window.scrollY > 8);
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) { window.requestAnimationFrame(updateScrollState); ticking = true; }
  }, { passive: true });
  updateScrollState();
})();
