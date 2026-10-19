// Applies the saved theme and language before first paint to avoid a flash.
(function () {
  try {
    var t = localStorage.getItem('so.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var l = localStorage.getItem('so.lang');
    if (l === 'en' || l === 'sq') document.documentElement.lang = l;
  } catch (e) { /* storage unavailable: keep the defaults */ }
})();
