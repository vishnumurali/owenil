// Runs before first paint (kept external so the CSP can forbid inline scripts).
(function () {
  // Refuse to be framed (clickjacking). Static hosting can't send X-Frame-Options.
  if (window.top !== window.self) {
    try {
      window.top.location = window.self.location.href;
    } catch (e) {
      document.documentElement.style.display = 'none';
    }
  }
  // Apply the saved theme.
  try {
    var t = localStorage.getItem('owenil.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
