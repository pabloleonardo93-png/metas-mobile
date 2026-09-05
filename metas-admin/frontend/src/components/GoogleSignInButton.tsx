import { useEffect, useRef, useState } from 'react';

import { loadGoogleIdentity } from '../auth/googleIdentity';

interface GoogleSignInButtonProps {
  clientId: string;
  disabled: boolean;
  onCredential: (credential: string) => Promise<void>;
  onError: (message: string) => void;
}

export const GoogleSignInButton = ({
  clientId,
  disabled,
  onCredential,
  onError,
}: GoogleSignInButtonProps): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadGoogleIdentity()
      .then((google) => {
        if (!active || !containerRef.current) return;
        google.accounts.id.initialize({
          callback: (response) => {
            if (!response.credential) {
              onError('O Google não forneceu uma credencial válida.');
              return;
            }
            void onCredential(response.credential).catch((error: unknown) => {
              onError(error instanceof Error ? error.message : 'Não foi possível entrar.');
            });
          },
          client_id: clientId,
          ux_mode: 'popup',
        });
        containerRef.current.replaceChildren();
        google.accounts.id.renderButton(containerRef.current, {
          locale: 'pt-BR',
          logo_alignment: 'left',
          shape: 'rectangular',
          size: 'large',
          text: 'signin_with',
          theme: 'outline',
          type: 'standard',
        });
        setReady(true);
      })
      .catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : 'Login indisponível.');
      });
    return () => {
      active = false;
      window.google?.accounts.id.cancel();
    };
  }, [clientId, onCredential, onError]);

  return (
    <div className={disabled ? 'google-button google-button--disabled' : 'google-button'}>
      <div
        ref={containerRef}
        aria-hidden={!ready || disabled}
        className="google-button__surface"
        data-testid="google-sign-in-container"
      />
      {!ready && <span className="button-placeholder">Carregando acesso seguro…</span>}
    </div>
  );
};
