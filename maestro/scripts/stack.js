// Maestro runScript helper for the gen local stack's test API (/api/test/*, fake workers only).
// Env (pass with runScript `env:`; STACK comes from `maestro test -e STACK=http://127.0.0.1:8010`):
//   ACTION   setup | code | config
//   setup:   NAME (flow name, used in the unique email), CREDITS (default 2),
//            USER_CONFIG (JSON, per-user fake-config knobs: fail_at, auto_approve, audio_duration_seconds,
//            youtube_url_enabled, step_delay_seconds), GLOBAL_CONFIG (JSON, merged over the defaults below;
//            search knobs are global because search runs before a job exists).
//            -> output.email
//   code:    EMAIL -> output.code (newest 6-digit sign-in code sent to EMAIL)
//   config:  GLOBAL_CONFIG (JSON) -> resets the global knobs (used at the end of flows that change them)
// Wrapped in a function: a flow can run this file more than once, and top-level `let`s must not collide.
(function () {
  const base = (typeof STACK !== 'undefined' && STACK && STACK !== 'undefined' && STACK) || 'http://127.0.0.1:8010';
  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  // Every flow starts from these global knobs, so a flow that changed them can't leak into the next one.
  const GLOBAL_DEFAULTS = { step_delay_seconds: 0.2, search_confidence: 'perfect', search_result_count: 3, auto_approve: true };

  function check(res, what) {
    if (res.status < 200 || res.status >= 300) throw new Error(what + ' failed: HTTP ' + res.status + ' ' + res.body);
    return json(res.body);
  }

  function merge(a, b) {
    const out = {};
    for (const k in a) out[k] = a[k];
    for (const j in b) out[j] = b[j];
    return out;
  }

  // An env var the calling flow didn't set reaches the script as undefined, '' or the string 'undefined'.
  function envValue(v) {
    return typeof v === 'undefined' || v === null || v === '' || v === 'undefined' || v === 'null' ? null : v;
  }

  function envJson(v) {
    return envValue(v) ? JSON.parse(v) : {};
  }

  function putConfig(body, email) {
    const url = base + '/api/test/fake-config' + (email ? '?email=' + encodeURIComponent(email) : '');
    return check(http.request(url, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) }), 'fake-config');
  }

  const action = typeof ACTION !== 'undefined' ? ACTION : 'setup';

  if (action === 'setup') {
    putConfig(merge(GLOBAL_DEFAULTS, envJson(typeof GLOBAL_CONFIG !== 'undefined' ? GLOBAL_CONFIG : undefined)));
    const name = envValue(typeof NAME !== 'undefined' ? NAME : undefined) || 'flow';
    const email = 'e2e-' + name + '-' + new Date().getTime() + '@example.com';
    const creditsEnv = envValue(typeof CREDITS !== 'undefined' ? CREDITS : undefined);
    const credits = creditsEnv === null ? 2 : Number(creditsEnv);
    check(
      http.post(base + '/api/test/scenario', {
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'user', email: email, credits: credits }),
      }),
      'scenario',
    );
    // Per-user knobs always start from the same base so the user's jobs are deterministic.
    const userConfig = merge(
      { step_delay_seconds: 0.2, auto_approve: true, fail_at: null, audio_duration_seconds: 30, youtube_url_enabled: true },
      envJson(typeof USER_CONFIG !== 'undefined' ? USER_CONFIG : undefined),
    );
    putConfig(userConfig, email);
    output.email = email;
  } else if (action === 'code') {
    const res = check(http.get(base + '/api/test/emails?limit=5&to=' + encodeURIComponent(EMAIL)), 'emails');
    let code = null;
    for (let i = 0; i < res.emails.length && !code; i++) {
      const codes = res.emails[i].codes || [];
      if (codes.length) code = codes[0];
    }
    if (!code) throw new Error('no sign-in code emailed to ' + EMAIL);
    output.code = code;
  } else if (action === 'config') {
    putConfig(merge(GLOBAL_DEFAULTS, envJson(typeof GLOBAL_CONFIG !== 'undefined' ? GLOBAL_CONFIG : undefined)));
  } else {
    throw new Error('unknown ACTION ' + action);
  }
})();
