/* Public JPN announcement banners. Content is fetched from the authenticated JPN backend API. */
import { JPN_API_BASE } from "./supabase-config.js";

(() => {
  const base = String(JPN_API_BASE || "").replace(/\/$/, "");
  if (!base || !document.body) return;

  const style = document.createElement("style");
  style.textContent = `
    #jpn-announcements{display:grid;gap:0;position:relative;z-index:1000}
    .jpn-announcement{--banner-bg:#12304b;--banner-border:#53d9f0;--banner-text:#effaff;position:relative;display:flex;align-items:center;justify-content:center;gap:14px;padding:12px 52px 12px 20px;background:var(--banner-bg);border-bottom:1px solid var(--banner-border);color:var(--banner-text);text-align:center;font:500 14px/1.5 system-ui,sans-serif}
    .jpn-announcement[data-style="success"]{--banner-bg:#12352c;--banner-border:#55d6a0;--banner-text:#edfff6}
    .jpn-announcement[data-style="warning"]{--banner-bg:#493018;--banner-border:#f2b85b;--banner-text:#fff7e8}
    .jpn-announcement[data-style="promo"]{--banner-bg:#30204c;--banner-border:#bd8cff;--banner-text:#f8efff}
    .jpn-announcement-copy{min-width:0}.jpn-announcement-title{font-weight:800;margin-right:7px}.jpn-announcement-message{overflow-wrap:anywhere}
    .jpn-announcement a{display:inline-flex;align-items:center;margin-left:9px;color:inherit;font-weight:800;text-decoration:underline;text-underline-offset:3px}
    .jpn-announcement-close{position:absolute;right:14px;top:50%;transform:translateY(-50%);width:30px;height:30px;border:1px solid currentColor;border-radius:50%;background:transparent;color:inherit;font-size:19px;line-height:1;cursor:pointer;opacity:.85}
    .jpn-announcement-close:hover{opacity:1}
    @media(max-width:640px){.jpn-announcement{padding:11px 44px 11px 14px;display:block;text-align:left}.jpn-announcement a{margin-left:0;margin-top:5px}.jpn-announcement-close{right:8px}}
    @media(prefers-reduced-motion:no-preference){.jpn-announcement{animation:jpn-banner-in .22s ease-out}@keyframes jpn-banner-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}}
  `;
  document.head.appendChild(style);

  const host = document.createElement("div");
  host.id = "jpn-announcements";
  host.setAttribute("aria-label", "Website announcements");
  document.body.insertBefore(host, document.body.firstChild);

  const dismissedKey = "jpn_dismissed_announcements_v1";
  const dismissed = new Set((() => {
    try { return JSON.parse(sessionStorage.getItem(dismissedKey) || "[]"); }
    catch { return []; }
  })());

  function makeBanner(item) {
    if (!item || dismissed.has(item.id)) return null;
    const banner = document.createElement("section");
    banner.className = "jpn-announcement";
    banner.dataset.style = ["info","success","warning","promo"].includes(item.style) ? item.style : "info";
    banner.setAttribute("role", item.style === "warning" ? "alert" : "region");
    banner.setAttribute("aria-label", "Announcement");

    const copy = document.createElement("div");
    copy.className = "jpn-announcement-copy";
    if (item.title) {
      const title = document.createElement("strong");
      title.className = "jpn-announcement-title";
      title.textContent = item.title;
      copy.appendChild(title);
    }
    const message = document.createElement("span");
    message.className = "jpn-announcement-message";
    message.textContent = item.message || "";
    copy.appendChild(message);

    if (item.link_url && item.link_label) {
      let safeUrl = null;
      try {
        const parsed = new URL(item.link_url, location.origin);
        if (parsed.protocol === "https:" || parsed.origin === location.origin) safeUrl = parsed.href;
      } catch {}
      if (safeUrl) {
        const link = document.createElement("a");
        link.href = safeUrl;
        link.textContent = item.link_label;
        if (new URL(safeUrl).origin !== location.origin) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        copy.appendChild(link);
      }
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "jpn-announcement-close";
    close.setAttribute("aria-label", "Dismiss announcement");
    close.textContent = "×";
    close.addEventListener("click", () => {
      dismissed.add(item.id);
      try { sessionStorage.setItem(dismissedKey, JSON.stringify([...dismissed])); } catch {}
      banner.remove();
      if (!host.children.length) host.remove();
    });
    banner.append(copy, close);
    return banner;
  }

  fetch(base + "/api/announcements", { headers: { "Accept": "application/json" } })
    .then(response => response.ok ? response.json() : Promise.reject(new Error("Announcements unavailable")))
    .then(payload => {
      (payload.announcements || []).forEach(item => {
        const banner = makeBanner(item);
        if (banner) host.appendChild(banner);
      });
      if (!host.children.length) host.remove();
    })
    .catch(() => host.remove());
})();
