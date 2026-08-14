const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/u, '') ?? '';
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';

export const publicEnv = {
  apiBaseUrl,
  googleWebClientId,
  isApiConfigured: apiBaseUrl.length > 0,
  isGoogleConfigured: googleWebClientId.length > 0,
} as const;
