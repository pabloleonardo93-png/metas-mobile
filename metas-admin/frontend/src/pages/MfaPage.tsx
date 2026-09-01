import { useState } from 'react';

import { AdminApiError } from '../api/adminApi';
import { useAuth } from '../auth/AuthContext';
import {
  authenticateWithPasskey,
  describeWebAuthnError,
  registerFirstPasskey,
  supportsWebAuthn,
} from '../auth/webauthn';

export const MfaPage = (): React.JSX.Element => {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState<'authenticate' | 'register' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = supportsWebAuthn();

  const run = async (kind: 'authenticate' | 'register'): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'register') await registerFirstPasskey();
      else await authenticateWithPasskey();
      await refresh();
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 401) {
        await refresh();
        return;
      }
      setError(describeWebAuthnError(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mfa-layout">
      <section className="mfa-card" aria-labelledby="mfa-title">
        <div className="security-icon" aria-hidden="true">
          ⌁
        </div>
        <span className="eyebrow">Segunda etapa</span>
        <h1 id="mfa-title">Confirme com sua passkey</h1>
        <p>
          A passkey usa a proteção do seu dispositivo para concluir o acesso sem expor uma senha.
        </p>
        {!supported && (
          <p className="alert" role="alert">
            Este navegador não oferece suporte a WebAuthn.
          </p>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="mfa-actions">
          <button
            className="button button--primary"
            disabled={!supported || busy !== null}
            type="button"
            onClick={() => void run('authenticate')}
          >
            {busy === 'authenticate' ? 'Validando…' : 'Usar passkey cadastrada'}
          </button>
          <button
            className="button button--secondary"
            disabled={!supported || busy !== null}
            type="button"
            onClick={() => void run('register')}
          >
            {busy === 'register' ? 'Cadastrando…' : 'Cadastrar primeira passkey'}
          </button>
        </div>
        <p className="privacy-note">
          O primeiro cadastro só deve ser usado no procedimento operacional autorizado.
        </p>
      </section>
    </main>
  );
};
