import { useAuthStore } from '../auth';
import { api } from '../../api/client';

// Mock the API client
jest.mock('../../api/client', () => ({
  api: {
    init: jest.fn(),
    isAuthenticated: jest.fn(),
    auth: {
      guest: jest.fn(),
      sendMagicLink: jest.fn(),
      verifyMagicLink: jest.fn(),
      logout: jest.fn(),
    },
    users: {
      me: jest.fn(),
    },
  },
}));

const mockApi = api as jest.Mocked<typeof api>;

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset store state
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
    });
    jest.clearAllMocks();
  });

  describe('init', () => {
    it('should initialize with existing auth and fetch user', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com', spotify_connected: false, lastfm_connected: false };
      mockApi.init.mockResolvedValue(undefined);
      mockApi.isAuthenticated.mockReturnValue(true);
      mockApi.users.me.mockResolvedValue(mockUser);

      await useAuthStore.getState().init();

      expect(mockApi.init).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('should create guest session when not authenticated', async () => {
      mockApi.init.mockResolvedValue(undefined);
      mockApi.isAuthenticated.mockReturnValue(false);
      mockApi.auth.guest.mockResolvedValue({ access_token: 'guest-token' });
      mockApi.users.me.mockResolvedValue({ id: 'guest-1', spotify_connected: false, lastfm_connected: false });

      await useAuthStore.getState().init();

      expect(mockApi.auth.guest).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('should handle init errors gracefully', async () => {
      mockApi.init.mockRejectedValue(new Error('Init failed'));

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('loginAsGuest', () => {
    it('should create guest session and fetch user', async () => {
      const mockUser = { id: 'guest-1', spotify_connected: false, lastfm_connected: false };
      mockApi.auth.guest.mockResolvedValue({ access_token: 'guest-token' });
      mockApi.users.me.mockResolvedValue(mockUser);

      await useAuthStore.getState().loginAsGuest();

      expect(mockApi.auth.guest).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('should set error on failure', async () => {
      mockApi.auth.guest.mockRejectedValue(new Error('Network error'));

      await expect(useAuthStore.getState().loginAsGuest()).rejects.toThrow();

      expect(useAuthStore.getState().error).toBe('Failed to create guest session');
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('sendMagicLink', () => {
    it('should send magic link email', async () => {
      mockApi.auth.sendMagicLink.mockResolvedValue(undefined);

      await useAuthStore.getState().sendMagicLink('test@example.com');

      expect(mockApi.auth.sendMagicLink).toHaveBeenCalledWith('test@example.com');
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('should set error on failure', async () => {
      mockApi.auth.sendMagicLink.mockRejectedValue(new Error('Invalid email'));

      await expect(useAuthStore.getState().sendMagicLink('invalid')).rejects.toThrow();

      expect(useAuthStore.getState().error).toBe('Failed to send magic link');
    });
  });

  describe('verifyMagicLink', () => {
    it('should verify token and authenticate user', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com', spotify_connected: true, lastfm_connected: false };
      mockApi.auth.verifyMagicLink.mockResolvedValue({ access_token: 'verified-token' });
      mockApi.users.me.mockResolvedValue(mockUser);

      await useAuthStore.getState().verifyMagicLink('magic-token-123');

      expect(mockApi.auth.verifyMagicLink).toHaveBeenCalledWith('magic-token-123');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('should set error on invalid token', async () => {
      mockApi.auth.verifyMagicLink.mockRejectedValue(new Error('Invalid token'));

      await expect(useAuthStore.getState().verifyMagicLink('bad-token')).rejects.toThrow();

      expect(useAuthStore.getState().error).toBe('Invalid or expired magic link');
    });
  });

  describe('logout', () => {
    it('should clear user and create new guest session', async () => {
      // Setup authenticated state
      useAuthStore.setState({
        user: { id: 'user-1', email: 'test@example.com', spotify_connected: false, lastfm_connected: false },
        isAuthenticated: true,
      });

      mockApi.auth.logout.mockResolvedValue(undefined);
      mockApi.auth.guest.mockResolvedValue({ access_token: 'new-guest-token' });
      mockApi.users.me.mockResolvedValue({ id: 'guest-new', spotify_connected: false, lastfm_connected: false });

      await useAuthStore.getState().logout();

      expect(mockApi.auth.logout).toHaveBeenCalled();
      expect(mockApi.auth.guest).toHaveBeenCalled();
    });
  });

  describe('fetchUser', () => {
    it('should update user in state', async () => {
      const mockUser = { id: 'user-1', email: 'updated@example.com', spotify_connected: true, lastfm_connected: true };
      mockApi.users.me.mockResolvedValue(mockUser);

      await useAuthStore.getState().fetchUser();

      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('should handle fetch errors gracefully', async () => {
      mockApi.users.me.mockRejectedValue(new Error('Unauthorized'));

      await useAuthStore.getState().fetchUser();

      // Should not throw, just log error
      expect(useAuthStore.getState().user).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear error state', () => {
      useAuthStore.setState({ error: 'Some error' });

      useAuthStore.getState().clearError();

      expect(useAuthStore.getState().error).toBeNull();
    });
  });
});
