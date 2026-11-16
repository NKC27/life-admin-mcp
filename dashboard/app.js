// Text size, light/dark and print. The page works without this file; it only adds the buttons' actions.
(function () {
  var root = document.documentElement;
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode: still works for this visit */ }
  }

  var size = document.getElementById("text-size");
  function applySize(big) {
    root.setAttribute("data-size", big ? "large" : "normal");
    size.setAttribute("aria-pressed", big ? "true" : "false");
    size.textContent = big ? "Smaller text" : "Bigger text";
  }
  applySize(load("la-size") === "large");
  size.addEventListener("click", function () {
    var big = root.getAttribute("data-size") !== "large";
    applySize(big);
    save("la-size", big ? "large" : "normal");
  });

  var theme = document.getElementById("theme");
  function systemDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function applyTheme(mode) {
    if (mode) root.setAttribute("data-theme", mode); else root.removeAttribute("data-theme");
    var dark = mode ? mode === "dark" : systemDark();
    theme.textContent = dark ? "Light colours" : "Dark colours";
    theme.setAttribute("aria-label", dark ? "Switch to light colours" : "Switch to dark colours");
  }
  applyTheme(load("la-theme"));
  theme.addEventListener("click", function () {
    var dark = root.getAttribute("data-theme") ? root.getAttribute("data-theme") === "dark" : systemDark();
    var next = dark ? "light" : "dark";
    applyTheme(next);
    save("la-theme", next);
  });

  document.getElementById("print").addEventListener("click", function () { window.print(); });
})();
