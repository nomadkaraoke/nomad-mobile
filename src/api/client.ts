import * as SecureStore from 'expo-secure-store';
import type {
  Song,
  Playlist,
  User,
  AuthTokens,
  PaginatedResponse,
  SearchParams,
  Recommendation,
} from '../types';

const BASE_URL = 'https://karaoke-decide-718638054799.us-central1.run.app';

const TOKEN_KEY = 'auth_token';

class ApiClient {
  private accessToken: string | null = null;

  async init() {
    this.accessToken = await SecureStore.getItemAsync(TOKEN_KEY);
  }

  private async getHeaders(): Promise<HeadersInit> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers = await this.getHeaders();
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Token management
  async setToken(token: string) {
    this.accessToken = token;
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }

  async clearToken() {
    this.accessToken = null;
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  // Auth endpoints
  auth = {
    guest: async (): Promise<AuthTokens> => {
      const result = await this.request<AuthTokens>('/api/auth/guest', {
        method: 'POST',
      });
      await this.setToken(result.access_token);
      return result;
    },

    sendMagicLink: async (email: string): Promise<void> => {
      await this.request('/api/auth/magic-link', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
    },

    verifyMagicLink: async (token: string): Promise<AuthTokens> => {
      const result = await this.request<AuthTokens>('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      await this.setToken(result.access_token);
      return result;
    },

    logout: async (): Promise<void> => {
      await this.clearToken();
    },
  };

  // Catalog endpoints
  catalog = {
    searchSongs: async (
      params: SearchParams
    ): Promise<PaginatedResponse<Song>> => {
      const queryParams = new URLSearchParams();
      if (params.q) queryParams.set('q', params.q);
      if (params.genre) queryParams.set('genre', params.genre);
      if (params.decade) queryParams.set('decade', params.decade);
      if (params.page) queryParams.set('page', params.page.toString());
      if (params.per_page) queryParams.set('per_page', params.per_page.toString());

      return this.request<PaginatedResponse<Song>>(
        `/api/catalog/songs?${queryParams.toString()}`
      );
    },

    getSong: async (id: string): Promise<Song> => {
      return this.request<Song>(`/api/catalog/songs/${id}`);
    },
  };

  // User endpoints
  users = {
    me: async (): Promise<User> => {
      return this.request<User>('/api/users/me');
    },

    getRecommendations: async (): Promise<Recommendation[]> => {
      return this.request<Recommendation[]>('/api/my/recommendations');
    },

    getKnownSongs: async (): Promise<Song[]> => {
      return this.request<Song[]>('/api/my/songs');
    },

    addKnownSong: async (songId: string): Promise<void> => {
      await this.request(`/api/my/songs/${songId}`, {
        method: 'POST',
      });
    },

    removeKnownSong: async (songId: string): Promise<void> => {
      await this.request(`/api/my/songs/${songId}`, {
        method: 'DELETE',
      });
    },
  };

  // Playlist endpoints
  playlists = {
    list: async (): Promise<Playlist[]> => {
      return this.request<Playlist[]>('/api/playlists');
    },

    get: async (id: string): Promise<Playlist> => {
      return this.request<Playlist>(`/api/playlists/${id}`);
    },

    create: async (name: string): Promise<Playlist> => {
      return this.request<Playlist>('/api/playlists', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
    },

    delete: async (id: string): Promise<void> => {
      await this.request(`/api/playlists/${id}`, {
        method: 'DELETE',
      });
    },

    addSong: async (playlistId: string, songId: string): Promise<void> => {
      await this.request(`/api/playlists/${playlistId}/songs`, {
        method: 'POST',
        body: JSON.stringify({ song_id: songId }),
      });
    },

    removeSong: async (playlistId: string, songId: string): Promise<void> => {
      await this.request(`/api/playlists/${playlistId}/songs/${songId}`, {
        method: 'DELETE',
      });
    },
  };

  // Service connection endpoints
  services = {
    connectSpotify: async (code: string): Promise<void> => {
      await this.request('/api/services/connect/spotify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
    },

    disconnectSpotify: async (): Promise<void> => {
      await this.request('/api/services/disconnect/spotify', {
        method: 'POST',
      });
    },

    syncListeningHistory: async (): Promise<void> => {
      await this.request('/api/services/sync', {
        method: 'POST',
      });
    },
  };
}

// Export singleton instance
export const api = new ApiClient();
