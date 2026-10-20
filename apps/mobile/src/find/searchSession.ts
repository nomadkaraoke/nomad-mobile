// The search-session id decide's search log groups events by (spec §5.6, kjbox search_log): one per
// "looking for a song" session, renewed after the user picks a result.
import { logSearchEvent } from '@nomad/api-decide';

/** 32 hex chars, like decide's uuid4().hex. Anonymous: it identifies a search session, not a person. */
function newSid(): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

let sid = newSid();

/** The current search-session id (sent with every search, resolve and event). */
export function currentSid(): string {
  return sid;
}

/** Starts a new search session: call after the user picks a result (a song, a candidate, a make offer). */
export function renewSid(): string {
  sid = newSid();
  return sid;
}

/** Logs a search event under the current session. Fire and forget: never throws, never blocks. */
export function logEvent(type: string, data?: Record<string, unknown>): void {
  void logSearchEvent({ sid, type, data });
}
