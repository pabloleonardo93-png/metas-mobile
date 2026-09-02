import { useState } from 'react';

import { adminApi, AdminApiError } from '../api/adminApi';
import { useAuth } from '../auth/AuthContext';
import {
  authenticateWithPasskey,
  describeWebAuthnError,
  registerFirstPasskey,
  supportsWebAuthn,
} from '../auth/webauthn';
import type { FirstEnrollmentRequestResult } from '../types';

export const MfaPage = (): React.JSX.Element => {
  const { refresh, state } = useAuth();
  const [busy, setBusy] = useState<'authenticate' | 'register' | 'request' | null>(null);
  const [enrollmentRequest, setEnrollmentRequest] = useState<FirstEnrollmentRequestResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const supported = supportsWebAuthn();
  const hasCredential = state.kind === 'google-only' && state.admin.hasWebAuthnCredential;

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

  const requestEnrollment = async (): Promise<void> => {
    setBusy('request');
    setError(null);
    try {
      setEnrollmentRequest(await adminApi.requestFirstEnrollment());
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 401) {
        await refresh();
        return;
      }
      if (caught instanceof AdminApiError && caught.retryAfterSeconds !== undefined) {
        setError(`Aguarde ${caught.retryAfterSeconds} segundos antes de tentar novamente.`);
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Não foi possível solicitar o cadastro.');
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
        <h1 id="mfa-title">
          {hasCredential ? 'Confirme com sua passkey' : 'Proteja sua conta com uma passkey'}
        </h1>
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
          {hasCredential ? (
            <button
              className="button button--primary"
              disabled={!supported || busy !== null}
              type="button"
              onClick={() => void run('authenticate')}
            >
              {busy === 'authenticate' ? 'Validando…' : 'Usar passkey cadastrada'}
            </button>
          ) : (
            <>
              <button
                className="button button--primary"
                disabled={busy !== null}
                type="button"
                onClick={() => void requestEnrollment()}
              >
                {busy === 'request'
                  ? 'Solicitando…'
                  : enrollmentRequest
                    ? 'Verificar autorização'
                    : 'Solicitar primeiro cadastro'}
              </button>
              {enrollmentRequest && (
                <div className="enrollment-status" role="status">
                  <strong>
                    {enrollmentRequest.status === 'APPROVED'
                      ? 'Autorização disponível'
                      : 'Aguardando autorização operacional'}
                  </strong>
                  <span>Identificador: {enrollmentRequest.requestId}</span>
                  <span>
                    Validade da solicitação:{' '}
                    {new Date(enrollmentRequest.expiresAt).toLocaleString('pt-BR')}
                  </span>
                </div>
              )}
              <button
                className="button button--secondary"
                disabled={!supported || busy !== null || enrollmentRequest?.status !== 'APPROVED'}
                type="button"
                onClick={() => void run('register')}
              >
                {busy === 'register' ? 'Cadastrando…' : 'Cadastrar passkey autorizada'}
              </button>
            </>
          )}
        </div>
        <p className="privacy-note">
          {hasCredential
            ? 'A validação ocorre no autenticador do seu dispositivo.'
            : 'O primeiro cadastro só é liberado após autorização operacional temporária.'}
        </p>
      </section>
    </main>
  );
};
