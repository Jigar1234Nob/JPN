(() => {
  "use strict";
  const KEY = "jpn_cookie_consent_v1";
  function getCookie(name) {
    const prefix = name + "=";
    const item = document.cookie.split("; ").find(part => part.startsWith(prefix));
    return item ? decodeURIComponent(item.slice(prefix.length)) : "";
  }
  function readChoice() {
    try { return localStorage.getItem(KEY) || getCookie("jpn_cookie_consent"); }
    catch (_) { return getCookie("jpn_cookie_consent"); }
  }
  function saveChoice(value) {
    try { localStorage.setItem(KEY, value); } catch (_) {}
    document.cookie = "jpn_cookie_consent=" + encodeURIComponent(value) + "; Max-Age=31536000; Path=/JPN; SameSite=Lax; Secure";
    const banner = document.getElementById("jpn-cookie-banner");
    const settings = document.getElementById("jpn-cookie-settings");
    if (banner) banner.hidden = true;
    if (settings) settings.hidden = false;
  }
  function render() {
    if (document.getElementById("jpn-cookie-banner")) return;
    const chosen = readChoice();
    const banner = document.createElement("section");
    banner.id = "jpn-cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Cookie and browser storage preferences");
    banner.hidden = Boolean(chosen);
    banner.innerHTML = '<div class="jpn-cookie-top"><div class="jpn-cookie-icon" aria-hidden="true">☷</div><div class="jpn-cookie-copy"><h2>Cookies and privacy</h2><p>JPN uses essential browser storage and similar technologies to support account sign-in and remember this choice. Optional analytics and advertising cookies are not currently enabled. Read our <a href="/JPN/privacy/">Privacy Notice</a> for details.</p></div></div><div class="jpn-cookie-actions"><button type="button" class="jpn-cookie-primary" data-choice="accepted">Accept</button><button type="button" data-choice="essential">Essential only</button></div>';
    banner.addEventListener("click", event => {
      const button = event.target.closest("button[data-choice]");
      if (button) saveChoice(button.dataset.choice);
    });
    const settings = document.createElement("button");
    settings.id = "jpn-cookie-settings";
    settings.type = "button";
    settings.textContent = "Cookie settings";
    settings.setAttribute("aria-label", "Reopen cookie preferences");
    settings.hidden = !chosen;
    settings.addEventListener("click", () => {
      banner.hidden = false;
      settings.hidden = true;
      const first = banner.querySelector("button");
      if (first) first.focus();
    });
    document.body.append(banner, settings);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
  else render();
})();