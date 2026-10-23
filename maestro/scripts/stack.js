// Maestro runScript helper for the gen local stack's test API (/api/test/*, fake workers only).
// Env (pass with runScript `env:`; STACK comes from `maestro test -e STACK=http://127.0.0.1:8010`):
//   ACTION   setup | code | config | judge | job | scenario | review | decide-seed | decide-reset | voice-seed |
//            voice-assert | kjbox | decide | log | fake-externals | fake-lb-user | fake-lastfm-user | lb-poll | source-counts
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
//   decide-seed:  EMAIL (default output.email), PROFILE (JSON: quiz_completed, genres, decades, energy
//            chill|medium|high, artists [{name, affinity occasionally|like|love}], loved / hidden ["artist|title"
//            song keys]) -> replaces that user's decide profile (POST ${DECIDE_STACK}/api/test/profile/seed, decide
//            docs/TESTING.md § Local stack). DECIDE_STACK defaults to http://127.0.0.1:8030 (decide's main API).
//            -> output.decideUserId
//   decide-reset: EMAIL (default output.email) -> deletes that user's decide profile, loved and hidden songs.
//   voice-seed:   EMAIL (default output.email), PROFILE (JSON, decide's VoiceProfileIn: low_midi, high_midi,
//            comfort_low, comfort_high, voice_type or register, confidence, method; measured_at defaults to now,
//            voice_type_between / register to null) -> sets that user's voice profile (POST ${DECIDE_STACK}/api/test/voice/seed).
//   voice-assert: EMAIL (default output.email), EXPECT_TYPE (voice_type, or "none"), EXPECT_METHOD (mic | self),
//            polled for WAIT_MS (default 10000) -> fails unless decide's voice_profile (GET /api/test/profile) matches
//            -> output.voiceProfile (JSON)
//   kjbox:   OP, one of kjbox's local-stack test API calls (KJBOX_STACK, default http://127.0.0.1:8040; kjbox
//            docs/TESTING.md § Local stack). BODY (JSON, optional) is sent as is; the shortcuts below build it.
//            reset       FIXTURE (default|empty) -> a new night (new night_id), event code 2121, fixture flags
//                        -> output.nightId
//            seed        SINGER (name), SONGS (JSON [{artist, title}]), EMAIL (an app user: linked to that gen account;
//                        "me" = output.email), DEVICE_ID (a web phone); neither = host-typed -> output.entryIds (JSON)
//            advance     TIMES (default 1): the singer on stage → Done, the next one on stage -> output.nowSinging
//            done        ENTRY_ID (default: whoever is on stage)        undone  ENTRY_ID
//            flags       BODY {make, simple_mode, ask_photo_consent, open, auto_approve, auto_reorder}
//            host-add    SINGER, ARTIST, TITLE -> output.entryId       host-remove  ENTRY_ID, DELETE ("true")
//            rate-limits BODY {per_device, per_ip}                     drain  -> output.sent
//            state       -> output.kjState (JSON); EXPECT_ENTRY_TITLE (+ EXPECT_ENTRY_STATUS, EXPECT_ENTRY_SINGER):
//                        fails unless a rotation entry whose song text contains the title has that status / singer
//            stop | start  stops / starts the kjbox stack itself through scripts/stack-control.py (CONTROL, default
//                        http://127.0.0.1:8049, started by e2e-local.sh): the "box unreachable" case
//            Entry ids of the user's own songs: `state` and the app's testIDs (tonight-song-<request id>).
//   decide:  OP stop | start -> stops / starts decide's local stack (stack-control.py, as kjbox stop/start)
//   log:     EMAIL (default output.email) -> decide's karaoke log for that user (GET ${DECIDE_STACK}/api/test/karaoke-log),
//            polled until the expectations hold or WAIT_MS (default 20000) passes (kjbox's outbox sends every 5 s):
//            EXPECT_COUNT (live, non-deleted records), EXPECT_TITLE (+ EXPECT_STATE sung|requested|planned|…,
//            EXPECT_SUNG_AT "set", EXPECT_FEEL great|ok|bad, EXPECT_KEY, EXPECT_SOURCE kjbox|app) on the record
//            with that title -> output.logEntries (JSON)
//   Phase 3b connect (decide's local stack with DECIDE_FAKE_EXTERNALS, decide docs/TESTING.md § Local stack: fakes):
//   fake-externals:   KNOBS (JSON, optional: metabrainz deny, spotify_embed changed, screenshot fail, …) -> resets every
//            fake (seeded users, codes, imports) and sets those knobs (PUT ${DECIDE_STACK}/api/test/fake-externals)
//   fake-lb-user:     USERNAME (default e2e-lb-<ms>), LISTENS (JSON [{artist, title, listened_at}], default: fixture
//            catalog songs listened to in the last few hours) -> a fake ListenBrainz user; output.lbUsername,
//            output.lbListens (JSON). ADD (JSON [{artist, title}]): instead, the same user (output.lbUsername unless
//            USERNAME) keeps output.lbListens and gets these listened to just now (the fake only replaces a user).
//   fake-lastfm-user: USERNAME (default e2e-lastfm-<ms>), TOP_TRACKS / TOP_ARTISTS (JSON, default fixture catalog
//            songs / artists) -> a fake Last.fm user; output.lastfmUsername
//   lb-poll:  runs decide's daily ListenBrainz poller once (POST ${DECIDE_STACK}/api/test/listenbrainz/poll)
//            -> output.lbListensAdded; EXPECT_ADDED: fails unless it added at least that many listens
//   source-counts: SOURCE (decide source id: screenshot, spotify_playlist, spotify_export, listenbrainz, lastfm, …),
//            MIN_SONGS / MIN_ARTISTS (default 1 / 0) or MIN_SONGS_ADDED (at least that many more songs than the previous
//            source-counts call's output.sourceSongs), TOKEN (default output.token from setup; decide takes the gen
//            session) -> polls GET ${DECIDE_STACK}/api/services/summary until that source's row has at least those
//            counts or WAIT_MS (default 20000) passes; output.sourceSongs / output.sourceArtists
// Wrapped in a function: a flow can run this file more than once, and top-level `let`s must not collide.
(function () {
  const base = (typeof STACK !== 'undefined' && STACK && STACK !== 'undefined' && STACK) || 'http://127.0.0.1:8010';
  const JSON_HEADERS = { 'Content-Type': 'application/json' };
  const decideBase =
    (typeof DECIDE_STACK !== 'undefined' && DECIDE_STACK && DECIDE_STACK !== 'undefined' && DECIDE_STACK) ||
    'http://127.0.0.1:8030';
  const kjboxBase =
    (typeof KJBOX_STACK !== 'undefined' && KJBOX_STACK && KJBOX_STACK !== 'undefined' && KJBOX_STACK) ||
    'http://127.0.0.1:8040';
  const controlBase =
    (typeof CONTROL !== 'undefined' && CONTROL && CONTROL !== 'undefined' && CONTROL) || 'http://127.0.0.1:8049';

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
  } else if (action === 'decide-seed' || action === 'decide-reset') {
    const email = envValue(typeof EMAIL !== 'undefined' ? EMAIL : undefined) || output.email;
    if (!email) throw new Error('ACTION ' + action + ' needs EMAIL (or ACTION setup first)');
    if (action === 'decide-reset') {
      // 204, no body to parse.
      const res = http.post(decideBase + '/api/test/profile/reset', {
        headers: JSON_HEADERS,
        body: JSON.stringify({ email: email }),
      });
      if (res.status < 200 || res.status >= 300) throw new Error('decide profile reset failed: HTTP ' + res.status + ' ' + res.body);
    } else {
      const profile = merge(envJson(typeof PROFILE !== 'undefined' ? PROFILE : undefined), { email: email });
      const res = check(
        http.post(decideBase + '/api/test/profile/seed', { headers: JSON_HEADERS, body: JSON.stringify(profile) }),
        'decide profile seed',
      );
      output.decideUserId = res.user_id;
    }
  } else if (action === 'voice-seed') {
    const email = envValue(typeof EMAIL !== 'undefined' ? EMAIL : undefined) || output.email;
    if (!email) throw new Error('ACTION voice-seed needs EMAIL (or ACTION setup first)');
    const profile = merge(
      { voice_type: null, voice_type_between: null, register: null, measured_at: new Date().toISOString() },
      envJson(typeof PROFILE !== 'undefined' ? PROFILE : undefined),
    );
    const res = http.post(decideBase + '/api/test/voice/seed', {
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: email, profile: profile }),
    });
    if (res.status < 200 || res.status >= 300) throw new Error('decide voice seed failed: HTTP ' + res.status + ' ' + res.body);
  } else if (action === 'voice-assert') {
    const email = envValue(typeof EMAIL !== 'undefined' ? EMAIL : undefined) || output.email;
    if (!email) throw new Error('ACTION voice-assert needs EMAIL (or ACTION setup first)');
    const wantType = envValue(typeof EXPECT_TYPE !== 'undefined' ? EXPECT_TYPE : undefined);
    const wantMethod = envValue(typeof EXPECT_METHOD !== 'undefined' ? EXPECT_METHOD : undefined);
    const waitMs = Number(envValue(typeof WAIT_MS !== 'undefined' ? WAIT_MS : undefined) || 10000);
    const problem = (vp) => {
      if (wantType === 'none') return vp ? 'a voice profile exists' : null;
      if (!vp) return 'no voice profile';
      if (wantType !== null && vp.voice_type !== wantType) return 'voice_type ' + vp.voice_type + ', expected ' + wantType;
      if (wantMethod !== null && vp.method !== wantMethod) return 'method ' + vp.method + ', expected ' + wantMethod;
      return null;
    };
    // The app's PUT can land a moment after the saved screen shows.
    const deadline = new Date().getTime() + waitMs;
    let vp = null;
    let why = null;
    do {
      vp = check(http.get(decideBase + '/api/test/profile?email=' + encodeURIComponent(email)), 'decide profile').voice_profile;
      why = problem(vp);
      if (why === null) break;
      const pause = new Date().getTime() + 1000;
      while (new Date().getTime() < pause) {
        // busy-wait: the script engine has no timers
      }
    } while (new Date().getTime() < deadline);
    output.voiceProfile = JSON.stringify(vp);
    if (why !== null) throw new Error('voice profile of ' + email + ': ' + why + ' ' + JSON.stringify(vp));
  } else if (action === 'kjbox') {
    const op = envValue(typeof OP !== 'undefined' ? OP : undefined);
    if (!op) throw new Error('ACTION kjbox needs OP');
    const env = (v) => envValue(v);
    const body = envJson(typeof BODY !== 'undefined' ? BODY : undefined);
    const entryId = env(typeof ENTRY_ID !== 'undefined' ? ENTRY_ID : undefined);
    if (entryId !== null) body.entry_id = Number(entryId);
    const post = (path, b) =>
      check(
        http.post(kjboxBase + '/sing/api/test/' + path, { headers: JSON_HEADERS, body: JSON.stringify(b || {}) }),
        'kjbox ' + path,
      );
    const singer = env(typeof SINGER !== 'undefined' ? SINGER : undefined);
    if (op === 'stop' || op === 'start') {
      check(http.post(controlBase + '/kjbox/' + op, { headers: JSON_HEADERS, body: '{}' }), 'kjbox ' + op);
    } else if (op === 'reset') {
      const fixture = env(typeof FIXTURE !== 'undefined' ? FIXTURE : undefined);
      if (fixture) body.fixture = fixture;
      const r = post('reset', body);
      output.nightId = r.state.night_id;
    } else if (op === 'seed') {
      let email = env(typeof EMAIL !== 'undefined' ? EMAIL : undefined);
      if (email === 'me') email = output.email;
      const deviceId = env(typeof DEVICE_ID !== 'undefined' ? DEVICE_ID : undefined);
      const songs = JSON.parse(env(typeof SONGS !== 'undefined' ? SONGS : undefined) || '[]');
      const one = { name: singer || 'Sam', songs: songs };
      if (email) one.email = email;
      if (deviceId) one.device_id = deviceId;
      const r = post('seed', body.singers ? body : { singers: [one] });
      output.entryIds = JSON.stringify(r.singers[0].entries.map((e) => e.entry_id));
    } else if (op === 'advance') {
      const times = Number(env(typeof TIMES !== 'undefined' ? TIMES : undefined) || 1);
      let r = null;
      for (let i = 0; i < times; i++) r = post('advance', {});
      output.nowSinging = r && r.now_singing ? r.now_singing.song_artist : '';
    } else if (op === 'host-add') {
      const r = post('host-add', {
        name: singer || 'Sam',
        artist: env(typeof ARTIST !== 'undefined' ? ARTIST : undefined) || undefined,
        title: env(typeof TITLE !== 'undefined' ? TITLE : undefined),
      });
      output.entryId = String(r.entry.id);
    } else if (op === 'host-remove') {
      if (env(typeof DELETE !== 'undefined' ? DELETE : undefined) === 'true') body.delete = true;
      post('host-remove', body);
    } else if (op === 'drain') {
      output.sent = String(post('outbox/drain', {}).sent);
    } else if (op === 'state') {
      const st = check(http.get(kjboxBase + '/sing/api/test/state'), 'kjbox state');
      output.kjState = JSON.stringify(st);
      const title = env(typeof EXPECT_ENTRY_TITLE !== 'undefined' ? EXPECT_ENTRY_TITLE : undefined);
      if (title !== null) {
        const status = env(typeof EXPECT_ENTRY_STATUS !== 'undefined' ? EXPECT_ENTRY_STATUS : undefined);
        const who = env(typeof EXPECT_ENTRY_SINGER !== 'undefined' ? EXPECT_ENTRY_SINGER : undefined);
        const hits = st.rotation.filter((e) => String(e.song_artist).indexOf(title) >= 0);
        const ok = hits.filter((e) => (status === null || e.status === status) && (who === null || e.singer === who));
        if (!ok.length) {
          throw new Error(
            'no rotation entry "' + title + '"' + (status ? ' with status ' + status : '') + (who ? ' sung by ' + who : '') +
              ': ' + JSON.stringify(hits.map((e) => [e.id, e.singer, e.song_artist, e.status])),
          );
        }
        output.entryId = String(ok[0].id);
      }
    } else {
      const paths = { done: 'done', undone: 'undone', flags: 'flags', 'rate-limits': 'rate-limits' };
      if (!paths[op]) throw new Error('unknown kjbox OP ' + op);
      post(paths[op], body);
    }
  } else if (action === 'decide') {
    // OP stop | start: decide's local stack itself (stack-control.py), for the karaoke log's offline case.
    const op = envValue(typeof OP !== 'undefined' ? OP : undefined);
    if (op !== 'stop' && op !== 'start') throw new Error('ACTION decide needs OP stop|start');
    check(http.post(controlBase + '/decide/' + op, { headers: JSON_HEADERS, body: '{}' }), 'decide ' + op);
  } else if (action === 'log') {
    const email = envValue(typeof EMAIL !== 'undefined' ? EMAIL : undefined) || output.email;
    if (!email) throw new Error('ACTION log needs EMAIL (or ACTION setup first)');
    const want = {
      count: envValue(typeof EXPECT_COUNT !== 'undefined' ? EXPECT_COUNT : undefined),
      title: envValue(typeof EXPECT_TITLE !== 'undefined' ? EXPECT_TITLE : undefined),
      state: envValue(typeof EXPECT_STATE !== 'undefined' ? EXPECT_STATE : undefined),
      sungAt: envValue(typeof EXPECT_SUNG_AT !== 'undefined' ? EXPECT_SUNG_AT : undefined),
      feel: envValue(typeof EXPECT_FEEL !== 'undefined' ? EXPECT_FEEL : undefined),
      key: envValue(typeof EXPECT_KEY !== 'undefined' ? EXPECT_KEY : undefined),
      source: envValue(typeof EXPECT_SOURCE !== 'undefined' ? EXPECT_SOURCE : undefined),
    };
    const waitMs = Number(envValue(typeof WAIT_MS !== 'undefined' ? WAIT_MS : undefined) || 20000);
    const problem = (log) => {
      const live = log.entries.filter((e) => !e.deleted);
      if (want.count !== null && live.length !== Number(want.count)) return live.length + ' live records, expected ' + want.count;
      if (want.title === null) return null;
      const rec = live.filter((e) => e.title === want.title)[0];
      if (!rec) return 'no live record titled "' + want.title + '"';
      if (want.state !== null && rec.state !== want.state) return 'state ' + rec.state + ', expected ' + want.state;
      if (want.sungAt === 'set' && !rec.sung_at) return 'no sung_at';
      const survey = rec.survey || {};
      if (want.feel !== null && survey.feel !== want.feel) return 'survey feel ' + survey.feel + ', expected ' + want.feel;
      if (want.key !== null && survey.key !== want.key) return 'survey key ' + survey.key + ', expected ' + want.key;
      if (want.source !== null && rec.source !== want.source) return 'source ' + rec.source + ', expected ' + want.source;
      return null;
    };
    const deadline = new Date().getTime() + waitMs;
    let log = null;
    let why = null;
    do {
      log = check(http.get(decideBase + '/api/test/karaoke-log?email=' + encodeURIComponent(email)), 'karaoke-log');
      why = problem(log);
      if (why === null) break;
      const pause = new Date().getTime() + 1000;
      while (new Date().getTime() < pause) {
        // busy-wait: the script engine has no timers
      }
    } while (new Date().getTime() < deadline);
    output.logEntries = JSON.stringify(log.entries);
    if (why !== null) {
      throw new Error('karaoke log of ' + email + ': ' + why + '\n' + JSON.stringify(log.entries.map((e) => [e.id, e.title, e.state, e.deleted, e.sung_at, e.survey])));
    }
  } else if (action === 'fake-externals') {
    const knobs = envJson(typeof KNOBS !== 'undefined' ? KNOBS : undefined);
    check(
      http.request(decideBase + '/api/test/fake-externals', {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ knobs: knobs }),
      }),
      'decide fake-externals',
    );
  } else if (action === 'fake-lb-user') {
    const nowS = Math.floor(new Date().getTime() / 1000);
    const addEnv = envValue(typeof ADD !== 'undefined' ? ADD : undefined);
    const username =
      envValue(typeof USERNAME !== 'undefined' ? USERNAME : undefined) ||
      (addEnv ? output.lbUsername : null) ||
      'e2e-lb-' + new Date().getTime();
    if (addEnv && !username) throw new Error('ACTION fake-lb-user ADD needs USERNAME (or a fake-lb-user first)');
    const listensEnv = envValue(typeof LISTENS !== 'undefined' ? LISTENS : undefined);
    const listens = addEnv
      ? JSON.parse(output.lbListens || '[]').concat(
          JSON.parse(addEnv).map((x) => ({ artist: x.artist, title: x.title, listened_at: nowS })),
        )
      : listensEnv
        ? JSON.parse(listensEnv)
        : [
          { artist: 'Muse', title: 'Starlight', listened_at: nowS - 3600 },
          { artist: 'Muse', title: 'Starlight', listened_at: nowS - 7200 },
          { artist: 'Elton John', title: 'Rocket Man', listened_at: nowS - 10800 },
        ];
    check(
      http.post(decideBase + '/api/test/fake-listenbrainz/users', {
        headers: JSON_HEADERS,
        body: JSON.stringify({ username: username, listens: listens }),
      }),
      'decide fake ListenBrainz user',
    );
    output.lbUsername = username;
    output.lbListens = JSON.stringify(listens);
  } else if (action === 'fake-lastfm-user') {
    const username = envValue(typeof USERNAME !== 'undefined' ? USERNAME : undefined) || 'e2e-lastfm-' + new Date().getTime();
    const tracksEnv = envValue(typeof TOP_TRACKS !== 'undefined' ? TOP_TRACKS : undefined);
    const artistsEnv = envValue(typeof TOP_ARTISTS !== 'undefined' ? TOP_ARTISTS : undefined);
    const body = {
      username: username,
      top_tracks: tracksEnv
        ? JSON.parse(tracksEnv)
        : [
            { artist: 'Adele', title: 'Hello', playcount: 40 },
            { artist: 'Muse', title: 'Starlight', playcount: 25 },
          ],
      top_artists: artistsEnv
        ? JSON.parse(artistsEnv)
        : [
            { name: 'Adele', playcount: 120 },
            { name: 'Muse', playcount: 90 },
          ],
    };
    check(
      http.post(decideBase + '/api/test/fake-lastfm/users', { headers: JSON_HEADERS, body: JSON.stringify(body) }),
      'decide fake Last.fm user',
    );
    output.lastfmUsername = username;
  } else if (action === 'lb-poll') {
    const r = check(
      http.post(decideBase + '/api/test/listenbrainz/poll', { headers: JSON_HEADERS, body: '{}' }),
      'decide ListenBrainz poll',
    );
    output.lbListensAdded = String(r.listens_added);
    const wantAdded = envValue(typeof EXPECT_ADDED !== 'undefined' ? EXPECT_ADDED : undefined);
    if (wantAdded !== null && r.listens_added < Number(wantAdded)) {
      throw new Error('lb-poll added ' + r.listens_added + ' listens, expected at least ' + wantAdded + ': ' + JSON.stringify(r));
    }
  } else if (action === 'source-counts') {
    const source = envValue(typeof SOURCE !== 'undefined' ? SOURCE : undefined);
    if (!source) throw new Error('ACTION source-counts needs SOURCE');
    const token = envValue(typeof TOKEN !== 'undefined' ? TOKEN : undefined) || output.token;
    if (!token) throw new Error('ACTION source-counts needs TOKEN (or ACTION setup first)');
    const added = envValue(typeof MIN_SONGS_ADDED !== 'undefined' ? MIN_SONGS_ADDED : undefined);
    if (added !== null && !output.sourceSongs) throw new Error('MIN_SONGS_ADDED needs an earlier source-counts (output.sourceSongs)');
    const minSongs =
      added !== null
        ? Number(output.sourceSongs) + Number(added)
        : Number(envValue(typeof MIN_SONGS !== 'undefined' ? MIN_SONGS : undefined) || 1);
    if (!Number.isFinite(minSongs)) throw new Error('source-counts: bad MIN_SONGS / MIN_SONGS_ADDED');
    const minArtists = Number(envValue(typeof MIN_ARTISTS !== 'undefined' ? MIN_ARTISTS : undefined) || 0);
    const waitMs = Number(envValue(typeof WAIT_MS !== 'undefined' ? WAIT_MS : undefined) || 20000);
    const deadline = new Date().getTime() + waitMs;
    let row = null;
    let rows = [];
    do {
      rows = check(
        http.get(decideBase + '/api/services/summary', { headers: { Authorization: 'Bearer ' + token } }),
        'decide services summary',
      ).sources;
      row = rows.filter((r) => r.source === source)[0] || null;
      if (row && (row.songs || 0) >= minSongs && (row.artists || 0) >= minArtists) break;
      const pause = new Date().getTime() + 1000;
      while (new Date().getTime() < pause) {
        // busy-wait: the script engine has no timers
      }
    } while (new Date().getTime() < deadline);
    if (!row || (row.songs || 0) < minSongs || (row.artists || 0) < minArtists) {
      throw new Error(
        'source ' + source + ': expected at least ' + minSongs + ' songs and ' + minArtists + ' artists; summary ' +
          JSON.stringify(rows.map((r) => [r.source, r.songs, r.artists, r.status])),
      );
    }
    output.sourceSongs = String(row.songs);
    output.sourceArtists = String(row.artists);
  } else {
    throw new Error('unknown ACTION ' + action);
  }
})();
