// Maestro runScript helper for the gen local stack's test API (/api/test/*, fake workers only).
// Env (pass with runScript `env:`; STACK comes from `maestro test -e STACK=http://127.0.0.1:8010`):
//   ACTION   setup | code | config | judge | job
//   setup:   NAME (flow name, used in the unique email), CREDITS (default 2),
//            USER_CONFIG (JSON, per-user fake-config knobs: fail_at, auto_approve, audio_duration_seconds,
//            youtube_url_enabled, step_delay_seconds, judge_*), GLOBAL_CONFIG (JSON, merged over the defaults
//            below; search knobs are global because search runs before a job exists, and so is the judge verdict
//            decide's /resolve gets from gen).
//            -> output.email, output.token (the user's gen session token, for ACTION job)
//   code:    EMAIL -> output.code (newest 6-digit sign-in code sent to EMAIL)
//   config:  GLOBAL_CONFIG (JSON) -> resets the global knobs (used at the end of flows that change them)
//   judge:   EMAIL, JUDGE_KIND (none | cosmetic | content | ambiguous), JUDGE_ARTIST, JUDGE_TITLE (the canonical
//            values the fake match judge answers with; gen's defaults when empty) -> that user's match judge.
//            The make screen's Make it waits for the judge (up to its timeout); `none` settles at once.
//   job:     TOKEN (output.token from setup), EXPECT_ARTIST, EXPECT_TITLE -> fails unless the user's newest job
//            has exactly that artist and title; output.jobArtist / output.jobTitle
// Wrapped in a function: a flow can run this file more than once, and top-level `let`s must not collide.
(function () {
  const base = (typeof STACK !== 'undefined' && STACK && STACK !== 'undefined' && STACK) || 'http://127.0.0.1:8010';
  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  // Every flow starts from these global knobs, so a flow that changed them can't leak into the next one.
  const NO_JUDGE = { judge_kind: 'none', judge_canonical_artist: '', judge_canonical_title: '' };
  const GLOBAL_DEFAULTS = merge(
    { step_delay_seconds: 0.2, search_confidence: 'perfect', search_result_count: 3, auto_approve: true },
    NO_JUDGE,
  );

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
    const user = check(
      http.post(base + '/api/test/scenario', {
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'user', email: email, credits: credits }),
      }),
      'scenario',
    );
    // Per-user knobs always start from the same base so the user's jobs are deterministic.
    const userConfig = merge(
      merge(
        { step_delay_seconds: 0.2, auto_approve: true, fail_at: null, audio_duration_seconds: 30, youtube_url_enabled: true },
        NO_JUDGE,
      ),
      envJson(typeof USER_CONFIG !== 'undefined' ? USER_CONFIG : undefined),
    );
    putConfig(userConfig, email);
    output.email = email;
    output.token = user.session_token;
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
  } else if (action === 'judge') {
    putConfig(
      {
        judge_kind: envValue(typeof JUDGE_KIND !== 'undefined' ? JUDGE_KIND : undefined) || 'none',
        judge_canonical_artist: envValue(typeof JUDGE_ARTIST !== 'undefined' ? JUDGE_ARTIST : undefined) || '',
        judge_canonical_title: envValue(typeof JUDGE_TITLE !== 'undefined' ? JUDGE_TITLE : undefined) || '',
      },
      EMAIL,
    );
  } else if (action === 'job') {
    const jobs = check(
      http.get(base + '/api/jobs?limit=5', { headers: { Authorization: 'Bearer ' + TOKEN } }),
      'jobs',
    );
    if (!jobs.length) throw new Error('the user has no job');
    // Newest first.
    const job = jobs[0];
    output.jobArtist = job.artist;
    output.jobTitle = job.title;
    const wantArtist = envValue(typeof EXPECT_ARTIST !== 'undefined' ? EXPECT_ARTIST : undefined);
    const wantTitle = envValue(typeof EXPECT_TITLE !== 'undefined' ? EXPECT_TITLE : undefined);
    if ((wantArtist !== null && job.artist !== wantArtist) || (wantTitle !== null && job.title !== wantTitle)) {
      throw new Error(
        'job ' + job.job_id + ' is "' + job.artist + '" / "' + job.title + '", expected "' + wantArtist + '" / "' + wantTitle + '"',
      );
    }
  } else {
    throw new Error('unknown ACTION ' + action);
  }
})();
