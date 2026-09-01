const GOOGLE_SCRIPT_ID = 'google-identity-services';
const GOOGLE_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      cancel(): void;
      initialize(options: {
        callback(response: GoogleCredentialResponse): void;
        client_id: string;
        ux_mode: 'popup';
      }): void;
      renderButton(element: HTMLElement, options: Record<string, string>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

let googleScriptPromise: Promise<GoogleIdentityApi> | null = null;

export const loadGoogleIdentity = (): Promise<GoogleIdentityApi> => {
  if (window.google) return Promise.resolve(window.google);
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    script.id = GOOGLE_SCRIPT_ID;
    script.src = GOOGLE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google) resolve(window.google);
      else reject(new Error('Google Identity Services indisponível.'));
    };
    script.onerror = () => reject(new Error('Não foi possível carregar o login do Google.'));
    if (!existing) document.head.append(script);
  });
  return googleScriptPromise;
};
