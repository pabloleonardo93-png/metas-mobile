import { useState } from 'react';

import { adminApi, AdminApiError } from '../api/adminApi';
import { useAuth } from '../auth/AuthContext';
import {
  authenticateWithPasskey,
  describeWebAuthnError,
  recoverWithNewPasskey,
  registerFirstPasskey,
  supportsWebAuthn,
} from '../auth/webauthn';
import type { FirstEnrollmentRequestResult, MfaRecoveryRequestResult } from '../types';

type BusyAction = 'authenticate' | 'recover' | 'recovery-request' | 'register' | 'request';

export const MfaPage = (): React.JSX.Element => {
  const { refresh, state } = useAuth();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [enrollmentRequest, setEnrollmentRequest] = useState<FirstEnrollmentRequestResult | null>(
    null,
  );
  const [recoveryRequest, setRecoveryRequest] = useState<MfaRecoveryRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = supportsWebAuthn();
  const hasCredential = state.kind === 'google-only' && state.admin.hasWebAuthnCredential;
  const hasCredentialHistory =
    state.kind === 'google-only' && state.admin.hasWebAuthnCredentialHistory;

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

  const requestRecovery = async (): Promise<void> => {
    setBusy('recovery-request');
    setError(null);
    try {
      setRecoveryRequest(await adminApi.requestMfaRecovery());
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 401) {
        await refresh();
        return;
      }
      if (caught instanceof AdminApiError && caught.retryAfterSeconds !== undefined) {
        setError(`Aguarde ${caught.retryAfterSeconds} segundos antes de tentar novamente.`);
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Não foi possível solicitar recovery.');
    } finally {
      setBusy(null);
    }
  };

  const recover = async (): Promise<void> => {
    setBusy('recover');
    setError(null);
    try {
      await recoverWithNewPasskey();
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
          ⌑
        </div>
        <span className="eyebrow">Segunda etapa</span>
        <h1 id="mfa-title">
          {hasCredential
            ? 'Confirme com sua passkey'
            : hasCredentialHistory
              ? 'Recupere o acesso com uma nova passkey'
              : 'Proteja sua conta com uma passkey'}
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
          {hasCredentialHistory ? (
            <>
              {hasCredential && (
                <button
                  className="button button--primary"
                  disabled={!supported || busy !== null}
                  type="button"
                  onClick={() => void run('authenticate')}
                >
                  {busy === 'authenticate' ? 'Validando…' : 'Usar passkey cadastrada'}
                </button>
              )}
              <button
                className="button button--secondary"
                disabled={busy !== null}
                type="button"
                onClick={() => void requestRecovery()}
              >
                {busy === 'recovery-request'
                  ? 'Solicitando…'
                  : recoveryRequest
                    ? 'Solicitar ou verificar nova autorização'
                    : 'Perdi acesso às minhas passkeys'}
              </button>
              {recoveryRequest && (
                <div className="enrollment-status" role="status">
                  <strong>
                    {recoveryRequest.status === 'APPROVED'
                      ? 'Recovery autorizado por tempo limitado'
                      : recoveryRequest.status === 'ENROLLMENT_STARTED'
                        ? 'Cadastro de recuperação iniciado'
                        : 'Aguardando confirmação independente'}
                  </strong>
                  <span>Identificador: {recoveryRequest.requestId}</span>
                  <span>
                    Validade da solicitação:{' '}
                    {new Date(recoveryRequest.expiresAt).toLocaleString('pt-BR')}
                  </span>
                  <span>
                    Ao continuar, as passkeys anteriores serão revogadas e outras sessões
                    administrativas poderão ser encerradas.
                  </span>
                </div>
              )}
              <button
                className="button button--secondary"
                disabled={!supported || busy !== null || recoveryRequest?.status !== 'APPROVED'}
                type="button"
                onClick={() => void recover()}
              >
                {busy === 'recover' ? 'Cadastrando…' : 'Cadastrar nova passkey autorizada'}
              </button>
            </>
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
            : hasCredentialHistory
              ? 'Cada nova tentativa exige autorização operacional independente.'
              : 'O primeiro cadastro só é liberado após autorização operacional temporária.'}
        </p>
      </section>
    </main>
  );
};
