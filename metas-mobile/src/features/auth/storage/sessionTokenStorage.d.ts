export interface SessionTokenStorage {
  deleteToken(): Promise<void>;
  getToken(): Promise<string | null>;
  saveToken(token: string): Promise<void>;
}

export const sessionTokenStorage: SessionTokenStorage;
