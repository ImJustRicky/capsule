/* Capsule-side navigation shim (browser runtime only).
 *
 * A capsule rendered from `srcdoc` has no URL of its own, so a plain relative
 * link like <a href="about.html"> would go nowhere. This shim intercepts clicks
 * on local links and asks the host to render that page from the archive.
 * External links and fragments are left to the browser (the sandbox already
 * blocks popups and top-level navigation).
 */
(function () {
  "use strict";
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var target = event.target;
    var anchor = target && target.closest ? target.closest("a[href]") : null;
    if (!anchor) return;
    var href = anchor.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#" || href.indexOf("//") === 0) return;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return;
    event.preventDefault();
    window.parent.postMessage({ kind: "capsule-navigate", href: href }, "*");
  });
})();
