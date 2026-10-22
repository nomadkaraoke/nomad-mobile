// Waits MS milliseconds (Maestro has no sleep). Only for waits that model the singer, not to paper over a race:
// Tap To Sync's lead-in is a fixed 3 s of audio before the line, and taps then belong to the line. Also: letting the
// keyboard or a closing sheet go before opening another (common/tonight-rename.yaml).
(function () {
  const ms = Number(typeof MS !== 'undefined' ? MS : 0) || 0;
  const end = new Date().getTime() + ms;
  while (new Date().getTime() < end) {
    // busy-wait: the script engine has no timers
  }
})();
