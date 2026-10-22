// quizSuggestionsCap: step 3's append-only suggestions stop growing at MAX_SUGGESTIONS (no endless list or calls).
import * as decide from '@nomad/api-decide';

import { MAX_SUGGESTIONS, useQuizDraft } from '../discover/quizStore';

jest.mock('@nomad/api-decide', () => ({
  ...jest.requireActual('@nomad/api-decide'),
  getQuizProgress: jest.fn(async () => null),
  saveQuizProgress: jest.fn(async () => ({ saved: true })),
  smartQuizArtists: jest.fn(),
}));

const smart = decide.smartQuizArtists as jest.Mock;
let n = 0;

beforeEach(() => {
  n = 0;
  smart.mockImplementation(async ({ count }: { count: number }) => ({
    artists: Array.from({ length: count + 5 }, () => ({ name: `Invented Artist ${n++}` })),
    has_more: true,
  }));
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
};

it(`caps the suggestions at ${MAX_SUGGESTIONS} and stops asking`, async () => {
  expect(MAX_SUGGESTIONS).toBe(60);
  await useQuizDraft.getState().load('me@example.com');
  for (let i = 0; i < 12; i++) {
    useQuizDraft.getState().suggest();
    await settle();
  }
  expect(useQuizDraft.getState().suggestions).toHaveLength(MAX_SUGGESTIONS);
  const calls = smart.mock.calls.length;
  useQuizDraft.getState().suggest();
  await settle();
  expect(smart.mock.calls.length).toBe(calls);
  expect(useQuizDraft.getState().suggesting).toBe(false);
});
