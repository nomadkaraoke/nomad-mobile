import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { randomUUID } from "expo-crypto";
import { create } from "zustand";

import { useAuth } from "../auth/store";
import { appStorage } from "../storage";

export type NomadNight = {
  kind: "nomad";
  code: string;
  nightId: string;
  kjName: string;
  joinedAt: number;
};
export type OtherNight = {
  kind: "other";
  /** uuid */
  nightId: string;
  venueName?: string;
  startedAt: number;
  lastActivityAt: number;
};
export type ActiveNight = NomadNight | OtherNight;

/** An "other" night with no activity for this long has ended. */
export const OTHER_NIGHT_IDLE_MS = 12 * 60 * 60 * 1000;

const keyFor = (userKey: string) => `tonight.night.v1.${userKey}`;

/** Hex sha256 of the lowercased, trimmed email: names the per-user storage key. */
export const userKeyFor = (email: string): string =>
  bytesToHex(sha256(utf8ToBytes(email.trim().toLowerCase())));

let clock: () => number = () => Date.now();
/** Test hook: replaces the clock (pass nothing to restore Date.now). */
export const setNightClock = (fn?: () => number): void => {
  clock = fn ?? (() => Date.now());
};

/** A v4 uuid (expo-crypto, with a Math.random fallback where it returns nothing, e.g. jest). */
export const newUuid = (): string => {
  try {
    const id: unknown = randomUUID();
    if (typeof id === "string" && id) return id;
  } catch {
    // fall through
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
};

const isStale = (n: ActiveNight, now: number) =>
  n.kind === "other" && now - n.lastActivityAt > OTHER_NIGHT_IDLE_MS;

function parse(raw: string | undefined): ActiveNight | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== "object" || typeof v.nightId !== "string")
      return null;
    if (
      v.kind === "nomad" &&
      typeof v.code === "string" &&
      typeof v.kjName === "string" &&
      typeof v.joinedAt === "number"
    ) {
      return {
        kind: "nomad",
        code: v.code,
        nightId: v.nightId,
        kjName: v.kjName,
        joinedAt: v.joinedAt,
      };
    }
    if (
      v.kind === "other" &&
      typeof v.startedAt === "number" &&
      typeof v.lastActivityAt === "number"
    ) {
      return {
        kind: "other",
        nightId: v.nightId,
        ...(typeof v.venueName === "string" ? { venueName: v.venueName } : {}),
        startedAt: v.startedAt,
        lastActivityAt: v.lastActivityAt,
      };
    }
  } catch {
    // corrupt: no night
  }
  return null;
}

/** The stored night for a user (null: none, corrupt, or an expired "other" night, which is removed). */
function load(userKey: string | null): ActiveNight | null {
  if (!userKey) return null;
  const night = parse(appStorage.getString(keyFor(userKey)));
  if (night && !isStale(night, clock())) return night;
  appStorage.remove(keyFor(userKey));
  return null;
}

type NightStore = {
  /** Who the night belongs to (hash of the signed-in email); null while signed out. */
  userKey: string | null;
  active: ActiveNight | null;
  joinNomad(code: string, nightId: string, kjName: string): void;
  startOther(venueName?: string): void;
  end(): void;
  /** Records activity (keeps an "other" night alive); ends it instead if it is already 12 h idle. */
  touch(): void;
  /** The active night, or null once an "other" night has gone 12 h idle (ending it). Call from handlers/effects. */
  current(): ActiveNight | null;
  /** Swaps to this user's stored night (or none). Called automatically when the signed-in user changes. */
  rehydrate(email: string | null): void;
};

const emailOf = (): string | null => {
  const s = useAuth.getState().state;
  return s.status === "signedIn" ? s.session.email : null;
};

export const useNightStore = create<NightStore>((set, get) => {
  const persist = (night: ActiveNight | null) => {
    const { userKey } = get();
    if (userKey) {
      if (night) appStorage.set(keyFor(userKey), JSON.stringify(night));
      else appStorage.remove(keyFor(userKey));
    }
    set({ active: userKey ? night : null });
  };
  const initialKey = emailOf() ? userKeyFor(emailOf()!) : null;
  return {
    userKey: initialKey,
    active: load(initialKey),

    joinNomad(code, nightId, kjName) {
      persist({ kind: "nomad", code, nightId, kjName, joinedAt: clock() });
    },

    startOther(venueName) {
      const now = clock();
      const name = venueName?.trim();
      persist({
        kind: "other",
        nightId: newUuid(),
        ...(name ? { venueName: name } : {}),
        startedAt: now,
        lastActivityAt: now,
      });
    },

    end() {
      persist(null);
    },

    touch() {
      const a = get().current();
      if (a?.kind === "other") persist({ ...a, lastActivityAt: clock() });
    },

    current() {
      const { active } = get();
      if (active && isStale(active, clock())) {
        persist(null);
        return null;
      }
      return active;
    },

    rehydrate(email) {
      const userKey = email ? userKeyFor(email) : null;
      set({ userKey, active: load(userKey) });
    },
  };
});

// Account switch (sign-out, or a different email): show the new user's night or none, never the previous one's.
useAuth.subscribe((s) => {
  const email = s.state.status === "signedIn" ? s.state.session.email : null;
  const want = email ? userKeyFor(email) : null;
  if (want !== useNightStore.getState().userKey)
    useNightStore.getState().rehydrate(email);
});
