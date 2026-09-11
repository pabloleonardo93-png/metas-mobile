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
import { BrandLogo } from '../components/BrandLogo';
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
      <header className="mfa-header">
        <div className="brand brand--mfa">
          <BrandLogo className="brand-logo brand-logo--mfa" />
          <div>
            <strong>Metas</strong>
            <span>Administração</span>
          </div>
        </div>
      </header>
      <section className="mfa-card" aria-labelledby="mfa-title">
        <BrandLogo className="mfa-card-logo" decorative />
        <span className="eyebrow mfa-step">Etapa 2 de 2</span>
        <h1 id="mfa-title">
          {hasCredential
            ? 'Confirme sua identidade'
            : hasCredentialHistory
              ? 'Recupere o acesso'
              : 'Cadastre seu dispositivo'}
        </h1>
        <p>Use a biometria, PIN ou bloqueio de tela do seu dispositivo para continuar.</p>
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
                  {busy === 'authenticate' ? 'Validando…' : 'Continuar com biometria ou PIN'}
                </button>
              )}
              <button
                className="button button--secondary"
                disabled={busy !== null || (recoveryRequest?.status === 'APPROVED' && !supported)}
                type="button"
                onClick={() =>
                  void (recoveryRequest?.status === 'APPROVED' ? recover() : requestRecovery())
                }
              >
                {busy === 'recover'
                  ? 'Cadastrando…'
                  : busy === 'recovery-request'
                    ? 'Solicitando…'
                    : recoveryRequest?.status === 'APPROVED'
                      ? 'Continuar recuperação'
                      : recoveryRequest
                        ? 'Solicitar ou verificar nova autorização'
                        : 'Perdi acesso a este dispositivo'}
              </button>
              {recoveryRequest && (
                <div className="enrollment-status" role="status">
                  <strong>
                    {recoveryRequest.status === 'APPROVED'
                      ? 'Recuperação autorizada por tempo limitado'
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
                    Ao continuar, os dispositivos anteriores serão revogados e outras sessões
                    administrativas poderão ser encerradas.
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <button
                className="button button--primary"
                disabled={busy !== null || (enrollmentRequest?.status === 'APPROVED' && !supported)}
                type="button"
                onClick={() =>
                  void (enrollmentRequest?.status === 'APPROVED'
                    ? run('register')
                    : requestEnrollment())
                }
              >
                {busy === 'register'
                  ? 'Cadastrando…'
                  : busy === 'request'
                    ? 'Solicitando…'
                    : enrollmentRequest?.status === 'APPROVED'
                      ? 'Concluir cadastro neste dispositivo'
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
