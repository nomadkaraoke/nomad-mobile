import { configureClient, listBoardRequests, submitSongRequest } from '../index';

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
  configureClient({ baseUrl: 'https://gen.test', getToken: () => 'tok', getLocale: () => 'en', onUnauthorized: jest.fn() });
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lastRequest = (): Request => fetchMock.mock.calls.at(-1)[0];

const REQ = {
  id: 'r1',
  artist: 'Fixture Artist',
  title: 'Fixture Song',
  status: 'open',
  source: 'human',
  vote_count: 1,
  created_at: '2026-10-28T00:00:00Z',
  your_vote: 1,
};
const submitted = (status: string) => ({
  status,
  request: REQ,
  canonical_artist: 'Fixture Artist',
  canonical_title: 'Fixture Song',
  was_corrected: false,
});

describe('submitSongRequest', () => {
  it('POSTs artist + title once and maps created', async () => {
    fetchMock.mockResolvedValue(json(submitted('created')));
    await expect(submitSongRequest('Fixture Artist', 'Fixture Song')).resolves.toEqual({ status: 'created', request: REQ });
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://gen.test/api/requests-board/requests');
    expect(req.headers.get('authorization')).toBe('Bearer tok');
    expect(await req.json()).toEqual({ artist: 'Fixture Artist', title: 'Fixture Song' });
  });

  it('maps already_exists and sends no vote call (R15)', async () => {
    fetchMock.mockResolvedValue(json(submitted('already_exists')));
    await expect(submitSongRequest('Fixture Artist', 'Fixture Song')).resolves.toEqual({
      status: 'already_exists',
      request: REQ,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const [r] of fetchMock.mock.calls as [Request][]) expect(r.url).not.toMatch(/\/vote/);
  });

  it('maps 409 vote_already_used to vote_used', async () => {
    fetchMock.mockResolvedValue(json({ detail: { code: 'vote_already_used', message: 'used' } }, 409));
    await expect(submitSongRequest('A', 'B')).resolves.toEqual({ status: 'vote_used' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 429 to submission_limit', async () => {
    fetchMock.mockResolvedValue(json({ detail: { code: 'submission_limit', message: 'tomorrow' } }, 429));
    await expect(submitSongRequest('A', 'B')).resolves.toEqual({ status: 'submission_limit' });
  });

  it('throws other errors, including a 409 with another code', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: { code: 'something_else' } }, 409));
    await expect(submitSongRequest('A', 'B')).rejects.toMatchObject({ status: 409 });
    fetchMock.mockResolvedValueOnce(json({ detail: 'A signed-in email is required to submit.' }, 403));
    await expect(submitSongRequest('A', 'B')).rejects.toMatchObject({ status: 403 });
    fetchMock.mockResolvedValueOnce(json({ detail: 'boom' }, 500));
    await expect(submitSongRequest('A', 'B')).rejects.toMatchObject({ status: 500 });
  });

  it('throws on an unexpected success status', async () => {
    fetchMock.mockResolvedValue(json(submitted('weird')));
    await expect(submitSongRequest('A', 'B')).rejects.toThrow(/weird/);
  });
});

describe('listBoardRequests', () => {
  it('GETs the board and returns only the active requests', async () => {
    const published = { ...REQ, id: 'p1', status: 'published' };
    fetchMock.mockResolvedValue(json({ requests: [REQ], published: [published], voted_today: true, your_vote_request_id: 'r1' }));
    await expect(listBoardRequests()).resolves.toEqual([REQ]);
    expect(lastRequest().method).toBe('GET');
    expect(lastRequest().url).toBe('https://gen.test/api/requests-board/requests');
  });
});
