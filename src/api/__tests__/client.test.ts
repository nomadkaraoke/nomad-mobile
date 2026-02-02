import * as SecureStore from 'expo-secure-store';
import { api } from '../client';

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

describe('ApiClient', () => {
  const BASE_URL = 'https://karaoke-decide-718638054799.us-central1.run.app';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('init', () => {
    it('should load token from secure store', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue('stored-token');

      await api.init();

      expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith('auth_token');
      expect(api.isAuthenticated()).toBe(true);
    });

    it('should handle no stored token', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);

      await api.init();

      expect(api.isAuthenticated()).toBe(false);
    });
  });

  describe('setToken', () => {
    it('should store token securely', async () => {
      await api.setToken('new-token');

      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'new-token');
      expect(api.isAuthenticated()).toBe(true);
    });
  });

  describe('clearToken', () => {
    it('should remove token from secure store', async () => {
      await api.setToken('some-token');
      await api.clearToken();

      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
      expect(api.isAuthenticated()).toBe(false);
    });
  });

  describe('auth.guest', () => {
    it('should create guest session and store token', async () => {
      const mockResponse = { access_token: 'guest-token-123' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await api.auth.guest();

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/auth/guest`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result).toEqual(mockResponse);
      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'guest-token-123');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Server error' }),
      } as Response);

      await expect(api.auth.guest()).rejects.toThrow('Server error');
    });
  });

  describe('auth.sendMagicLink', () => {
    it('should send magic link request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await api.auth.sendMagicLink('test@example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/auth/magic-link`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com' }),
        })
      );
    });
  });

  describe('auth.verifyMagicLink', () => {
    it('should verify token and store auth', async () => {
      const mockResponse = { access_token: 'verified-token' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await api.auth.verifyMagicLink('magic-token-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/auth/verify`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'magic-token-123' }),
        })
      );
      expect(result).toEqual(mockResponse);
      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'verified-token');
    });
  });

  describe('catalog.searchSongs', () => {
    it('should search songs with query params', async () => {
      const mockSongs = {
        data: [{ id: '1', title: 'Test Song', artist: 'Test Artist' }],
        total: 1,
        page: 1,
        per_page: 20,
        has_more: false,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSongs),
      } as Response);

      const result = await api.catalog.searchSongs({ q: 'test', page: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/catalog/songs?q=test&page=1`,
        expect.anything()
      );
      expect(result).toEqual(mockSongs);
    });

    it('should handle empty search params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], total: 0 }),
      } as Response);

      await api.catalog.searchSongs({});

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/catalog/songs?`,
        expect.anything()
      );
    });

    it('should include genre and decade filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      } as Response);

      await api.catalog.searchSongs({ genre: 'rock', decade: '1980s' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('genre=rock'),
        expect.anything()
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('decade=1980s'),
        expect.anything()
      );
    });
  });

  describe('catalog.getSong', () => {
    it('should get song by id', async () => {
      const mockSong = { id: 'song-123', title: 'Test Song', artist: 'Artist' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSong),
      } as Response);

      const result = await api.catalog.getSong('song-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/catalog/songs/song-123`,
        expect.anything()
      );
      expect(result).toEqual(mockSong);
    });
  });

  describe('users.me', () => {
    it('should fetch current user', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockUser),
      } as Response);

      const result = await api.users.me();

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/users/me`,
        expect.anything()
      );
      expect(result).toEqual(mockUser);
    });
  });

  describe('playlists', () => {
    it('should list playlists', async () => {
      const mockPlaylists = [{ id: 'pl-1', name: 'My Playlist', song_count: 5 }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPlaylists),
      } as Response);

      const result = await api.playlists.list();

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/playlists`,
        expect.anything()
      );
      expect(result).toEqual(mockPlaylists);
    });

    it('should create playlist', async () => {
      const mockPlaylist = { id: 'pl-new', name: 'New Playlist', song_count: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPlaylist),
      } as Response);

      const result = await api.playlists.create('New Playlist');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/playlists`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New Playlist' }),
        })
      );
      expect(result).toEqual(mockPlaylist);
    });

    it('should delete playlist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await api.playlists.delete('pl-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/playlists/pl-123`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should add song to playlist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await api.playlists.addSong('pl-123', 'song-456');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/playlists/pl-123/songs`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ song_id: 'song-456' }),
        })
      );
    });

    it('should remove song from playlist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await api.playlists.removeSong('pl-123', 'song-456');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/playlists/pl-123/songs/song-456`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('services', () => {
    it('should connect Spotify', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await api.services.connectSpotify('auth-code-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/services/connect/spotify`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ code: 'auth-code-123' }),
        })
      );
    });

    it('should disconnect Spotify', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await api.services.disconnectSpotify();

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/services/disconnect/spotify`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should sync listening history', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await api.services.syncListeningHistory();

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/services/sync`,
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('error handling', () => {
    it('should throw with message from API response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'Invalid request' }),
      } as Response);

      await expect(api.catalog.searchSongs({ q: 'test' })).rejects.toThrow('Invalid request');
    });

    it('should throw HTTP status when no message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error('Not JSON')),
      } as Response);

      await expect(api.catalog.getSong('missing')).rejects.toThrow('HTTP 404');
    });
  });

  describe('authorization header', () => {
    it('should include auth header when token is set', async () => {
      await api.setToken('my-token');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await api.users.me();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token',
          }),
        })
      );
    });
  });
});
