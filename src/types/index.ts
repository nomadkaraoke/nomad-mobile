// Song types
export interface Song {
  id: string;
  title: string;
  artist: string;
  karaoke_brand: string;
  genre?: string;
  decade?: string;
  popularity?: number;
  energy?: number;
  danceability?: number;
}

// Playlist types
export interface Playlist {
  id: string;
  name: string;
  song_count: number;
  created_at: string;
  updated_at: string;
}

export interface PlaylistWithSongs extends Playlist {
  songs: Song[];
}

// User types
export interface User {
  id: string;
  email?: string;
  display_name?: string;
  spotify_connected: boolean;
  lastfm_connected: boolean;
}

// Auth types
export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

export interface MagicLinkRequest {
  email: string;
}

export interface MagicLinkVerifyRequest {
  token: string;
}

// API Response types
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

// Search types
export interface SearchParams {
  q?: string;
  genre?: string;
  decade?: string;
  min_energy?: number;
  max_energy?: number;
  page?: number;
  per_page?: number;
}

// Recommendation types
export interface Recommendation {
  song: Song;
  reason: string;
  score: number;
}
