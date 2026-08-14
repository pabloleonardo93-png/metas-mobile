import type { SessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';

let inMemoryToken: string | null = null;

// Web intentionally keeps the session only in memory; no token is persisted in localStorage.
export const sessionTokenStorage: SessionTokenStorage = {
  deleteToken: async () => {
    inMemoryToken = null;
  },
  getToken: async () => inMemoryToken,
  saveToken: async (token) => {
    inMemoryToken = token;
  },
};
