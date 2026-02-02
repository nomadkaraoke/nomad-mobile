import { create } from 'zustand';
import { api } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  init: () => Promise<void>;
  loginAsGuest: () => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  verifyMagicLink: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  init: async () => {
    try {
      await api.init();
      if (api.isAuthenticated()) {
        set({ isAuthenticated: true });
        await get().fetchUser();
      } else {
        // Create a guest session by default
        await get().loginAsGuest();
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  loginAsGuest: async () => {
    set({ isLoading: true, error: null });
    try {
      await api.auth.guest();
      set({ isAuthenticated: true });
      await get().fetchUser();
    } catch (error) {
      set({ error: 'Failed to create guest session' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  sendMagicLink: async (email: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.auth.sendMagicLink(email);
    } catch (error) {
      set({ error: 'Failed to send magic link' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  verifyMagicLink: async (token: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.auth.verifyMagicLink(token);
      set({ isAuthenticated: true });
      await get().fetchUser();
    } catch (error) {
      set({ error: 'Invalid or expired magic link' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await api.auth.logout();
      set({ user: null, isAuthenticated: false });
      // Create a new guest session
      await get().loginAsGuest();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchUser: async () => {
    try {
      const user = await api.users.me();
      set({ user });
    } catch (error) {
      console.error('Failed to fetch user:', error);
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
