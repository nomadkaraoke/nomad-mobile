// Maestro runScript helper for the gen local stack's test API (/api/test/*, fake workers only).
// Env (pass with runScript `env:`; STACK comes from `maestro test -e STACK=http://127.0.0.1:8010`):
//   ACTION   setup | code | config | judge | job | scenario | review
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
//   scenario: SCENARIO (default job_awaiting_review) for the setup user (output.email), after merging USER_CONFIG
//            (JSON, optional) into that user's knobs: the review knobs review_fixture, backing_vocals,
//            stems_delay_seconds, review_mode, auto_approval, review_complete_fail_once (gen docs/TESTING.md
//            § Local stack). Setup already applied its own USER_CONFIG, so pass USER_CONFIG here only to change
//            the knobs for a second job. SNAPSHOT_LINE (optional): also reads the job's correction data and keeps
//            that line's word start times (opening it moves the job to in_review, as the app's own load does).
//            -> output.jobId, output.token (the scenario's session for the same user),
//               output.lineStarts (JSON array, with SNAPSHOT_LINE)
//   review:  JOB_ID -> asserts what the review submitted (GET /api/test/jobs/{id}/review-result); every EXPECT_* is
//            optional: EXPECT_LEFT_REVIEW ("true": the job is past awaiting_review / in_review and a review was saved),
//            EXPECT_SELECTION (instrumental_selection), EXPECT_DUET ("true" | "false"), EXPECT_TEXT_CONTAINS (in the
//            lines' text, joined by newlines), EXPECT_LINE + EXPECT_LINE_TEXT (that line's exact text),
//            EXPECT_SINGER_LINE + EXPECT_SINGER (that line's singer), EXPECT_TIMED ("all" or a line index: every word
//            timed, end >= start, words in order without overlapping), EXPECT_RETIMED_LINE + ORIGINAL_STARTS (JSON,
//            from scenario's output.lineStarts: that line's word starts are no longer those), RETIMED_WINDOW
//            ("from,to" seconds: with EXPECT_RETIMED_LINE, every word of that line lies inside it)
//            -> output.reviewStatus
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

  // The review knobs a user starts with (gen's defaults), so a review flow's job is the plain 6-line one unless
  // the flow says otherwise.
  const REVIEW_DEFAULTS = {
    review_fixture: 'default',
    backing_vocals: 'silent',
    stems_delay_seconds: 0,
    review_mode: 'always_review',
    auto_approval: 'none',
    review_complete_fail_once: false,
  };

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
        merge(
          { step_delay_seconds: 0.2, auto_approve: true, fail_at: null, audio_duration_seconds: 30, youtube_url_enabled: true },
          REVIEW_DEFAULTS,
        ),
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
  } else if (action === 'scenario') {
    const email = output.email;
    if (!email) throw new Error('ACTION scenario needs ACTION setup first (output.email)');
    const extra = envJson(typeof USER_CONFIG !== 'undefined' ? USER_CONFIG : undefined);
    if (Object.keys(extra).length) putConfig(extra, email);
    const name = envValue(typeof SCENARIO !== 'undefined' ? SCENARIO : undefined) || 'job_awaiting_review';
    const res = check(
      http.post(base + '/api/test/scenario', {
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: name, email: email }),
      }),
      'scenario ' + name,
    );
    if (!res.job_id) throw new Error('scenario ' + name + ' made no job');
    output.jobId = res.job_id;
    output.token = res.session_token;
    const snap = envValue(typeof SNAPSHOT_LINE !== 'undefined' ? SNAPSHOT_LINE : undefined);
    if (snap !== null) {
      const data = check(
        http.get(base + '/api/review/' + res.job_id + '/correction-data', {
          headers: { Authorization: 'Bearer ' + res.session_token },
        }),
        'correction-data',
      );
      const seg = (data.corrected_segments || [])[Number(snap)];
      if (!seg) throw new Error('job ' + res.job_id + ' has no line ' + snap);
      output.lineStarts = JSON.stringify(seg.words.map((w) => w.start_time));
    }
  } else if (action === 'review') {
    const jobId = envValue(typeof JOB_ID !== 'undefined' ? JOB_ID : undefined);
    if (!jobId) throw new Error('ACTION review needs JOB_ID');
    const r = check(http.get(base + '/api/test/jobs/' + jobId + '/review-result'), 'review-result');
    output.reviewStatus = r.status;
    const fail = (msg) => {
      throw new Error('review of ' + jobId + ': ' + msg);
    };
    // Env vars are bindings, not properties of the global object, so each one is read by name.
    const env = {
      EXPECT_LEFT_REVIEW: typeof EXPECT_LEFT_REVIEW !== 'undefined' ? EXPECT_LEFT_REVIEW : undefined,
      EXPECT_SELECTION: typeof EXPECT_SELECTION !== 'undefined' ? EXPECT_SELECTION : undefined,
      EXPECT_DUET: typeof EXPECT_DUET !== 'undefined' ? EXPECT_DUET : undefined,
      EXPECT_TEXT_CONTAINS: typeof EXPECT_TEXT_CONTAINS !== 'undefined' ? EXPECT_TEXT_CONTAINS : undefined,
      EXPECT_LINE: typeof EXPECT_LINE !== 'undefined' ? EXPECT_LINE : undefined,
      EXPECT_LINE_TEXT: typeof EXPECT_LINE_TEXT !== 'undefined' ? EXPECT_LINE_TEXT : undefined,
      EXPECT_SINGER_LINE: typeof EXPECT_SINGER_LINE !== 'undefined' ? EXPECT_SINGER_LINE : undefined,
      EXPECT_SINGER: typeof EXPECT_SINGER !== 'undefined' ? EXPECT_SINGER : undefined,
      EXPECT_TIMED: typeof EXPECT_TIMED !== 'undefined' ? EXPECT_TIMED : undefined,
      EXPECT_RETIMED_LINE: typeof EXPECT_RETIMED_LINE !== 'undefined' ? EXPECT_RETIMED_LINE : undefined,
      ORIGINAL_STARTS: typeof ORIGINAL_STARTS !== 'undefined' ? ORIGINAL_STARTS : undefined,
      RETIMED_WINDOW: typeof RETIMED_WINDOW !== 'undefined' ? RETIMED_WINDOW : undefined,
    };
    const want = (name) => envValue(env[name]);
    const lines = r.lines || [];
    const lineAt = (i) => lines[Number(i)] || fail('no line ' + i + ' (' + lines.length + ' lines)');

    if (want('EXPECT_LEFT_REVIEW') === 'true') {
      if (r.status === 'awaiting_review' || r.status === 'in_review') fail('still in review (' + r.status + ')');
      if (!lines.length) fail('no review was saved');
    }
    const selection = want('EXPECT_SELECTION');
    if (selection !== null && r.instrumental_selection !== selection) {
      fail('instrumental_selection is ' + r.instrumental_selection + ', expected ' + selection);
    }
    const duet = want('EXPECT_DUET');
    if (duet !== null && String(r.is_duet) !== duet) fail('is_duet is ' + r.is_duet + ', expected ' + duet);
    const contains = want('EXPECT_TEXT_CONTAINS');
    if (contains !== null) {
      const all = lines.map((l) => l.text).join('\n');
      if (all.indexOf(contains) < 0) fail('the lyrics have no "' + contains + '":\n' + all);
    }
    const line = want('EXPECT_LINE');
    if (line !== null) {
      const text = want('EXPECT_LINE_TEXT');
      if (lineAt(line).text !== text) fail('line ' + line + ' is "' + lineAt(line).text + '", expected "' + text + '"');
    }
    const singerLine = want('EXPECT_SINGER_LINE');
    if (singerLine !== null) {
      const singer = want('EXPECT_SINGER');
      if (String(lineAt(singerLine).singer) !== singer) {
        fail('line ' + singerLine + ' singer is ' + lineAt(singerLine).singer + ', expected ' + singer);
      }
    }
    const timed = want('EXPECT_TIMED');
    if (timed !== null) {
      const which = timed === 'all' ? lines.map((_, i) => i) : [Number(timed)];
      if (!lines.length) fail('no review was saved');
      which.forEach((i) => {
        let prevEnd = -Infinity;
        lineAt(i).words.forEach((w, j) => {
          const at = 'line ' + i + ' word ' + j + ' "' + w.text + '" (' + w.start_time + '-' + w.end_time + ')';
          if (typeof w.start_time !== 'number' || typeof w.end_time !== 'number') fail(at + ' is untimed');
          if (w.end_time < w.start_time) fail(at + ' ends before it starts');
          // 1 ms of slack for float rounding.
          if (w.start_time < prevEnd - 0.001) fail(at + ' overlaps the word before');
          prevEnd = w.end_time;
        });
      });
    }
    const retimed = want('EXPECT_RETIMED_LINE');
    if (retimed !== null) {
      const before = JSON.parse(want('ORIGINAL_STARTS') || '[]');
      const after = lineAt(retimed).words.map((w) => w.start_time);
      if (JSON.stringify(before) === JSON.stringify(after)) fail('line ' + retimed + ' kept its timings ' + JSON.stringify(after));
      const win = want('RETIMED_WINDOW');
      if (win !== null) {
        const [from, to] = win.split(',').map(Number);
        lineAt(retimed).words.forEach((w, j) => {
          if (!(w.start_time >= from && w.end_time <= to)) {
            fail('line ' + retimed + ' word ' + j + ' (' + w.start_time + '-' + w.end_time + ') is outside ' + from + '-' + to);
          }
        });
      }
    }
  } else {
    throw new Error('unknown ACTION ' + action);
  }
})();
