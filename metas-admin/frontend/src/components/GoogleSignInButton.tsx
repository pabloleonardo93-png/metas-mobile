import { useEffect, useRef, useState } from 'react';

import { loadGoogleIdentity } from '../auth/googleIdentity';

const GOOGLE_BUTTON_MAX_WIDTH = 400;

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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    let resizeObserver: ResizeObserver | null = null;

    void loadGoogleIdentity()
      .then((google) => {
        if (!active || !wrapperRef.current || !mountRef.current) return;

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

        let renderedWidth = 0;
        const renderAtAvailableWidth = (): void => {
          if (!active || !wrapperRef.current || !mountRef.current) return;

          const availableWidth = Math.min(
            Math.floor(wrapperRef.current.clientWidth),
            GOOGLE_BUTTON_MAX_WIDTH,
          );
          if (availableWidth <= 0 || availableWidth === renderedWidth) return;

          mountRef.current.replaceChildren();
          google.accounts.id.renderButton(mountRef.current, {
            locale: 'pt-BR',
            logo_alignment: 'left',
            shape: 'rectangular',
            size: 'large',
            text: 'signin_with',
            theme: 'outline',
            type: 'standard',
            width: String(availableWidth),
          });
          renderedWidth = availableWidth;
          setReady(true);
        };

        renderAtAvailableWidth();
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(renderAtAvailableWidth);
          resizeObserver.observe(wrapperRef.current);
        }
      })
      .catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : 'Login indisponível.');
      });
    return () => {
      active = false;
      resizeObserver?.disconnect();
      window.google?.accounts.id.cancel();
    };
  }, [clientId, onCredential, onError]);

  return (
    <div
      ref={wrapperRef}
      className={disabled ? 'google-button google-button--disabled' : 'google-button'}
    >
      <div ref={mountRef} aria-hidden={!ready || disabled} data-testid="google-sign-in-container" />
      {!ready && <span className="google-button__placeholder">Carregando acesso seguro…</span>}
    </div>
  );
};
