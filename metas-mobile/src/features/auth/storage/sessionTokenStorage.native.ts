import * as SecureStore from 'expo-secure-store';

import type { SessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';

const SESSION_TOKEN_KEY = 'metas.sessionToken';

export const sessionTokenStorage: SessionTokenStorage = {
  deleteToken: () => SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
  getToken: () => SecureStore.getItemAsync(SESSION_TOKEN_KEY),
  saveToken: (token) =>
    SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
};
