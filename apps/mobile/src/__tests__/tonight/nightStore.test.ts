import { useAuth } from "../../auth/store";
import { appStorage } from "../../storage";
import {
  OTHER_NIGHT_IDLE_MS,
  setNightClock,
  useNightStore,
  userKeyFor,
} from "../../tonight/nightStore";

const signIn = (email: string) =>
  useAuth.setState({
    state: { status: "signedIn", session: { token: "t", email, createdAt: 0 } },
  });
const signOut = () => useAuth.setState({ state: { status: "signedOut" } });

let now = 100_000_000;
beforeEach(() => {
  appStorage.clearAll();
  now = 100_000_000;
  setNightClock(() => now);
  signOut();
  useNightStore.getState().rehydrate(null);
});
afterAll(() => setNightClock());

describe("nightStore", () => {
  it("userKey is the sha256 of the lowercased email", () => {
    expect(userKeyFor(" A@B.com ")).toBe(userKeyFor("a@b.com"));
    expect(userKeyFor("a@b.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("joins a Nomad night and persists under the per-user key", () => {
    signIn("a@b.com");
    useNightStore.getState().joinNomad("2121", "n1", "DJ Sam");
    expect(useNightStore.getState().active).toEqual({
      kind: "nomad",
      code: "2121",
      nightId: "n1",
      kjName: "DJ Sam",
      joinedAt: now,
    });
    expect(
      appStorage.getString(`tonight.night.v1.${userKeyFor("a@b.com")}`),
    ).toContain('"2121"');
    useNightStore.getState().end();
    expect(useNightStore.getState().active).toBeNull();
    expect(
      appStorage.getString(`tonight.night.v1.${userKeyFor("a@b.com")}`),
    ).toBeUndefined();
  });

  it("other night auto-ends after 12h idle", () => {
    signIn("a@b.com");
    useNightStore.getState().startOther(" The Pub ");
    const a = useNightStore.getState().active;
    expect(a).toMatchObject({
      kind: "other",
      venueName: "The Pub",
      startedAt: now,
      lastActivityAt: now,
    });
    now += OTHER_NIGHT_IDLE_MS - 1000;
    useNightStore.getState().touch();
    expect(useNightStore.getState().current()).toMatchObject({
      lastActivityAt: now,
    });
    now += OTHER_NIGHT_IDLE_MS + 1;
    expect(useNightStore.getState().current()).toBeNull();
    expect(useNightStore.getState().active).toBeNull();
  });

  it("touch on a stale other night ends it; a Nomad night never expires", () => {
    signIn("a@b.com");
    useNightStore.getState().startOther();
    now += OTHER_NIGHT_IDLE_MS + 1;
    useNightStore.getState().touch();
    expect(useNightStore.getState().active).toBeNull();
    useNightStore.getState().joinNomad("2121", "n1", "x");
    now += 10 * OTHER_NIGHT_IDLE_MS;
    expect(useNightStore.getState().current()).not.toBeNull();
  });

  it("nightStore resets on account change", () => {
    signIn("a@b.com");
    useNightStore.getState().joinNomad("2121", "n1", "DJ Sam");
    signIn("c@d.com");
    expect(useNightStore.getState().active).toBeNull();
    useNightStore.getState().startOther("Bar");
    signIn("a@b.com");
    expect(useNightStore.getState().active).toMatchObject({
      kind: "nomad",
      nightId: "n1",
    });
    signOut();
    expect(useNightStore.getState().active).toBeNull();
    useNightStore.getState().joinNomad("9999", "n2", "x"); // signed out: nothing is kept
    expect(useNightStore.getState().active).toBeNull();
    signIn("c@d.com");
    expect(useNightStore.getState().active).toMatchObject({
      kind: "other",
      venueName: "Bar",
    });
  });

  it("drops a corrupt or expired stored night on rehydrate", () => {
    appStorage.set(`tonight.night.v1.${userKeyFor("a@b.com")}`, "{nope");
    signIn("a@b.com");
    expect(useNightStore.getState().active).toBeNull();
    appStorage.set(
      `tonight.night.v1.${userKeyFor("c@d.com")}`,
      JSON.stringify({
        kind: "other",
        nightId: "u",
        startedAt: 0,
        lastActivityAt: 0,
      }),
    );
    signIn("c@d.com");
    expect(useNightStore.getState().active).toBeNull();
  });
});
