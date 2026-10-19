import { appStorage } from '../storage';
import {
  EMPTY_DRAFT,
  editMake,
  identifiedIntent,
  INTENT_TTL_MS,
  isFreshIntent,
  prefillMake,
  typedIntent,
  useMakeIntent,
  type MakeIntent,
} from '../make/intentStore';

const intent = (over: Partial<MakeIntent> = {}): MakeIntent => ({
  artist: 'Lionel Richie',
  title: 'Hello',
  canonicalArtist: 'Lionel Richie',
  canonicalTitle: 'Hello',
  songKey: 'lionel richie|hello',
  source: 'identified',
  editedFields: [],
  createdAt: Date.now(),
  ...over,
});

// The store reads MMKV once at import: a fresh copy of the module simulates an app relaunch.
const relaunch = () => {
  let mod!: typeof import('../make/intentStore');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../make/intentStore');
  });
  return mod.useMakeIntent;
};

beforeEach(() => useMakeIntent.getState().clear());

it('set / get / clear', () => {
  const i = intent();
  useMakeIntent.getState().set(i);
  expect(useMakeIntent.getState().intent).toEqual(i);
  expect(useMakeIntent.getState().get()).toEqual(i);
  useMakeIntent.getState().clear();
  expect(useMakeIntent.getState().get()).toBeNull();
});

it('survives an app kill (persisted to MMKV)', () => {
  const i = intent();
  useMakeIntent.getState().set(i);
  expect(relaunch().getState().get()).toEqual(i);
});

it('expires after 30 minutes, and an expired intent is cleared from storage', () => {
  useMakeIntent.getState().set(intent({ createdAt: Date.now() - INTENT_TTL_MS - 1000 }));
  expect(useMakeIntent.getState().get()).toBeNull();
  expect(useMakeIntent.getState().intent).toBeNull();
  expect(relaunch().getState().intent).toBeNull();
});

it('a 29-minute-old intent is still fresh', () => {
  const i = intent({ createdAt: Date.now() - 29 * 60 * 1000 });
  useMakeIntent.getState().set(i);
  expect(useMakeIntent.getState().get()).toEqual(i);
  expect(isFreshIntent(i)).toBe(true);
  expect(isFreshIntent(null)).toBe(false);
});

it('ignores a corrupt or foreign stored value on launch', () => {
  appStorage.set('make.intent.v1', '{nope');
  expect(relaunch().getState().intent).toBeNull();
  appStorage.set('make.intent.v1', JSON.stringify({ title: 3 }));
  expect(relaunch().getState().intent).toBeNull();
});

it('keeps a typed intent without canonical values (free-text "make any song")', () => {
  const i: MakeIntent = { artist: 'Muse', title: 'Uprising', source: 'typed', editedFields: ['artist', 'title'], createdAt: Date.now() };
  useMakeIntent.getState().set(i);
  expect(relaunch().getState().get()).toEqual(i);
});

it('an intent stored by the previous app version (no source / editedFields) loads as typed', () => {
  appStorage.set('make.intent.v1', JSON.stringify({ artist: 'Muse', title: 'Starlight', decideSongId: 7, createdAt: Date.now() }));
  expect(relaunch().getState().intent).toEqual({ artist: 'Muse', title: 'Starlight', source: 'typed', editedFields: [], createdAt: expect.any(Number) });
});

it('drops malformed optional fields on load', () => {
  appStorage.set(
    'make.intent.v1',
    JSON.stringify({ artist: 'A', title: 'B', source: 'nope', editedFields: ['artist', 'bogus', 3], songKey: 5, createdAt: Date.now() }),
  );
  expect(relaunch().getState().intent).toEqual({ artist: 'A', title: 'B', source: 'typed', editedFields: ['artist'], createdAt: expect.any(Number) });
});

describe('identified and typed intents', () => {
  it('Make it on an identified song stores source identified with the canonical values', () => {
    const i = identifiedIntent({ artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight' }, 1000);
    expect(i).toEqual({
      artist: 'Muse',
      title: 'Starlight',
      canonicalArtist: 'Muse',
      canonicalTitle: 'Starlight',
      songKey: 'muse|starlight',
      source: 'identified',
      editedFields: [],
      createdAt: 1000,
    });
  });

  it('a typed intent trims the fields and keeps the edits and the pre-fill it started from', () => {
    const draft = editMake(prefillMake(EMPTY_DRAFT, { artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight' }), 'title', ' Uprising ');
    expect(typedIntent(draft, 5)).toEqual({
      artist: 'Muse',
      title: 'Uprising',
      canonicalArtist: 'Muse',
      canonicalTitle: 'Starlight',
      songKey: 'muse|starlight',
      source: 'typed',
      editedFields: ['title'],
      createdAt: 5,
    });
  });
});

describe('make-any pre-fill (kjbox D10 / A95)', () => {
  const starlight = { artist: 'Muse', title: 'Starlight', song_key: 'muse|starlight' };
  const hello = { artist: 'Adele', title: 'Hello', song_key: 'adele|hello' };

  it('pre-fills both fields from the identification, and a new one replaces them while nothing was edited', () => {
    let d = prefillMake(EMPTY_DRAFT, starlight);
    expect(d).toMatchObject({ artist: 'Muse', title: 'Starlight', editedFields: [] });
    d = prefillMake(d, hello);
    expect(d).toMatchObject({ artist: 'Adele', title: 'Hello', songKey: 'adele|hello' });
    d = prefillMake(d, null);
    expect(d).toEqual(EMPTY_DRAFT);
  });

  it('an artist/title split of the typed words fills the fields but is not canonical', () => {
    expect(prefillMake(EMPTY_DRAFT, { artist: 'Queen', title: 'Bohemian Rhapsody' })).toEqual({
      artist: 'Queen',
      title: 'Bohemian Rhapsody',
      editedFields: [],
    });
  });

  it('pre-fill, edit the title, new identification: the title stays and the artist follows', () => {
    let d = prefillMake(EMPTY_DRAFT, starlight);
    d = editMake(d, 'title', 'Starlight (Live)');
    expect(d.editedFields).toEqual(['title']);
    d = prefillMake(d, hello);
    expect(d.title).toBe('Starlight (Live)');
    expect(d.artist).toBe('Adele');
    d = prefillMake(d, null);
    expect(d.title).toBe('Starlight (Live)');
    expect(d.artist).toBe('');
  });

  it('a field counts as edited from the first edit on, even when edited back to empty', () => {
    let d = editMake(prefillMake(EMPTY_DRAFT, starlight), 'artist', '');
    d = editMake(d, 'artist', 'M');
    expect(d.editedFields).toEqual(['artist']);
    d = prefillMake(d, hello);
    expect(d).toMatchObject({ artist: 'M', title: 'Hello' });
  });

  it('the store keeps the draft across screens; clear() (a job was made) starts it over', () => {
    const s = () => useMakeIntent.getState();
    s().prefill(starlight);
    s().edit('title', 'Uprising');
    s().prefill(hello);
    expect(s().draft).toMatchObject({ artist: 'Adele', title: 'Uprising', editedFields: ['title'] });
    s().clear();
    expect(s().draft).toEqual(EMPTY_DRAFT);
  });
});
