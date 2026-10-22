// Maestro runScript: keeps the last copyTextFrom text as output[NAME], escaped for use as a text regex (Maestro's
// text matchers are regexes; song titles hold ( ) . ? ! and the like). Env: NAME.
(function () {
  const text = typeof maestro !== 'undefined' && maestro.copiedText ? String(maestro.copiedText) : '';
  if (!text) throw new Error('remember-text: nothing was copied (copyTextFrom first)');
  output[NAME] = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
})();
