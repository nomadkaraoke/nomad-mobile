// The kjbox adapters the Phase 1 make hooks are given in Tonight (Task E7).
import * as kjbox from '@nomad/api-kjbox';

import { kjboxJudge, kjboxSearcher } from '../../../tonight/make/kjboxMake';
import type { NomadNight } from '../../../tonight/nightStore';

jest.mock('@nomad/api-kjbox', () => ({ ...jest.requireActual('@nomad/api-kjbox'), makeSearch: jest.fn(), makeCheck: jest.fn() }));
const api = kjbox as jest.Mocked<typeof kjbox>;
const night = { kind: 'nomad', code: '2121', nightId: 'n1' } as NomadNight;

it('search drops malformed rows and maps a missing session id to empty', async () => {
  api.makeSearch.mockResolvedValue({
    api_version: '1.0',
    search_session_id: null,
    results: [{ index: 0, title: 'Album', artist: 'Muse', provider: 'RED' }, { nonsense: true }],
  });
  const r = await kjboxSearcher(night)('Muse', 'Starlight');
  expect(api.makeSearch).toHaveBeenCalledWith('2121', 'Muse', 'Starlight', 'n1');
  expect(r.sessionId).toBe('');
  expect(r.results.map((x) => x.index)).toEqual([0]);
});

it('judge passes the tier and normalises an unknown kind to none', async () => {
  api.makeCheck.mockResolvedValue({ api_version: '1.0', kind: 'something_new', confident: true, alternatives: [{ artist: 'A' }] });
  const v = await kjboxJudge(night)({ artist: 'muse', title: 'starlite', stage: 'full', audio_confidence_tier: 3 });
  expect(api.makeCheck).toHaveBeenCalledWith('2121', { artist: 'muse', title: 'starlite', stage: 'full', night_id: 'n1', tier: 3 });
  expect(v).toMatchObject({ kind: 'none', confident: true, canonical_artist: 'muse', canonical_title: 'starlite', alternatives: [], needs_ai: false });
});
