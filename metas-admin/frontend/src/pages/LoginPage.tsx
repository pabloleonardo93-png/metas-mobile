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
    <main className="auth-layout">
      <section className="auth-story" aria-labelledby="login-title">
        <div className="brand">
          <BrandLogo className="brand-logo brand-logo--story" />
          <div>
            <strong>Metas</strong>
            <span>Administração da plataforma</span>
          </div>
        </div>
        <div className="story-copy">
          <span className="eyebrow">Acesso restrito</span>
          <h1 id="login-title">Administre suas metas com segurança.</h1>
          <p>
            Uma área exclusiva para administrar a operação Metas com identidade verificada e
            autenticação forte.
          </p>
        </div>
        <ul className="trust-list" aria-label="Proteções deste acesso">
          <li>
            <span aria-hidden="true">01</span> Identidade administrativa separada
          </li>
          <li>
            <span aria-hidden="true">02</span> Passkey obrigatória após o Google
          </li>
          <li>
            <span aria-hidden="true">03</span> Sessão protegida no servidor
          </li>
        </ul>
      </section>
      <section className="auth-card" aria-label="Entrar no painel administrativo">
        <div>
          <span className="status-pill">
            <i aria-hidden="true" /> Ambiente protegido
          </span>
          <h2>Entrar no painel</h2>
          <p>Use a conta Google previamente autorizada para a plataforma.</p>
        </div>
        <GoogleSignInButton
          clientId={googleAdminClientId}
          disabled={busy}
          onCredential={handleCredential}
          onError={handleError}
        />
        {busy && (
          <p className="inline-status" role="status">
            Validando sua identidade…
          </p>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <p className="privacy-note">
          A credencial Google é enviada somente ao servidor seguro e não fica armazenada no
          navegador.
        </p>
      </section>
    </main>
  );
};
