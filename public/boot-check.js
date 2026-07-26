/* IDGuard boot watchdog
 *
 * index.html shows a "LOADING..." placeholder that app.js hides on its last
 * line. If anything upstream fails — a missing /vendor bundle, app.js not
 * served, a throw during init — that placeholder stays on screen forever and
 * tells nobody what broke.
 *
 * This file runs before everything else and provides two things:
 *   1. idguardBootError(detail) — renders a real failure message in place of
 *      the placeholder. app.js calls this when a vendor global is missing.
 *   2. A watchdog for the one case no in-app guard can catch: app.js itself
 *      never running.
 *
 * Lives in its own file rather than inline in the HTML because helmet's CSP
 * (scriptSrc 'self') blocks inline scripts.
 */
(function () {
  "use strict";

  var GRACE_MS = 6000;

  window.idguardBootError = function (detail) {
    var boot = document.getElementById("boot");
    if (!boot) return;
    boot.className = "booterr";
    boot.style.display = "flex";
    boot.textContent = "";

    var box = document.createElement("div");
    box.className = "booterr-box";

    var title = document.createElement("div");
    title.className = "booterr-title";
    title.textContent = "IDGuard failed to start";

    var why = document.createElement("div");
    why.className = "booterr-detail";
    why.textContent = detail;

    var fix = document.createElement("div");
    fix.className = "booterr-fix";
    fix.textContent = "If this is a fresh deploy, rebuild without cache:";
    var cmd = document.createElement("code");
    cmd.textContent = "docker compose build --no-cache && docker compose up -d";
    fix.appendChild(document.createElement("br"));
    fix.appendChild(cmd);

    box.appendChild(title);
    box.appendChild(why);
    box.appendChild(fix);
    boot.appendChild(box);
  };

  // Catches app.js being absent or dying before it can report anything.
  setTimeout(function () {
    if (window.__IDGUARD_BOOTED__) return;
    var boot = document.getElementById("boot");
    if (!boot || boot.style.display === "none") return;
    window.idguardBootError(
      "The app did not finish starting within " + (GRACE_MS / 1000) +
      " seconds. /app.js may be missing, blocked, or failing to run. " +
      "Check the browser console and the server logs."
    );
  }, GRACE_MS);
})();
