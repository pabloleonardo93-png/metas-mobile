import { useCallback, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { BrandLogo } from '../components/BrandLogo';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { loadPublicConfig } from '../config';

export const LoginPage = (): React.JSX.Element => {
  const { loginWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { googleAdminClientId } = loadPublicConfig();

  const handleCredential = useCallback(
    async (credential: string) => {
      setBusy(true);
      setError(null);
      try {
        await loginWithGoogle(credential);
      } finally {
        setBusy(false);
      }
    },
    [loginWithGoogle],
  );
  const handleError = useCallback((message: string) => setError(message), []);

  return (
    <main className="admin-login-page">
      <section className="admin-login-card" aria-labelledby="login-title">
        <div className="admin-login-content">
          <BrandLogo className="brand-logo admin-login-logo" />
          <div className="admin-login-copy">
            <h1 id="login-title">Administre suas metas</h1>
            <p>Gerencie a plataforma, acompanhe a operação e mantenha tudo sob controle.</p>
          </div>
          <div className="admin-login-access">
            <GoogleSignInButton
              clientId={googleAdminClientId}
              disabled={busy}
              onCredential={handleCredential}
              onError={handleError}
            />
            {busy && (
              <p className="admin-login-status" role="status">
                Validando sua identidade…
              </p>
            )}
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <footer className="admin-login-footer">
          <div aria-hidden="true" />
          <p>Acesso exclusivo para administradores autorizados.</p>
        </footer>
      </section>
    </main>
  );
};
