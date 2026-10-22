// Maestro runScript: keeps the last copyTextFrom text as output[NAME], escaped for use as a text regex (Maestro's
// text matchers are regexes; song titles hold ( ) . ? ! and the like). Env: NAME; FIRST_PART=1 keeps only the text
// before the first comma or line break (a tile's accessibility text is "name, detail, badge": this keeps the name).
(function () {
  let text = typeof maestro !== 'undefined' && maestro.copiedText ? String(maestro.copiedText) : '';
  if (typeof FIRST_PART !== 'undefined' && FIRST_PART) text = text.split(/,|\n/)[0].trim();
  if (!text) throw new Error('remember-text: nothing was copied (copyTextFrom first)');
  output[NAME] = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
})();
