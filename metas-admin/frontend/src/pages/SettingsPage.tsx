import { useCallback, useEffect, useState } from 'react';

import type { PlatformAdminAccessEntry } from '../api/platformAdminAccess.contracts';
import { platformAdminAccessApi } from '../api/platformAdminAccessApi';
import { useAuth } from '../auth/AuthContext';
import { authenticateWithPasskey, supportsWebAuthn } from '../auth/webauthn';
import { AppShell } from '../components/AppShell';

const statusLabels: Record<PlatformAdminAccessEntry['status'], string> = {
  ACTIVE: 'Ativo',
  AWAITING_FIRST_ACCESS: 'Aguardando primeiro acesso',
  AWAITING_DEVICE_APPROVAL: 'Aguardando aprovação do dispositivo',
  DISABLED: 'Desativado',
};

const identityConfirmationError = (error: unknown): string => {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'A confirmação foi cancelada ou expirou. Tente novamente.';
  }
  if (error instanceof Error && error.name === 'AdminApiError') return error.message;
  return 'Não foi possível confirmar sua identidade. Tente novamente.';
};

export const SettingsPage = (): React.JSX.Element => {
  const { state } = useAuth();
  const admin = state.kind === 'verified' ? state.admin : null;
  const [items, setItems] = useState<PlatformAdminAccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setItems((await platformAdminAccessApi.list(signal)).items);
      setError(null);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Não foi possível carregar os administradores.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const withIdentityConfirmation = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!supportsWebAuthn())
        throw new Error('Este dispositivo não permite confirmar sua identidade.');
      await authenticateWithPasskey();
      await operation();
      await load();
    } catch (caught) {
      setError(identityConfirmationError(caught));
    } finally {
      setBusy(false);
    }
  };

  const submitInvitation = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    await withIdentityConfirmation(async () => {
      await platformAdminAccessApi.invite({ displayName, email });
      setDialogOpen(false);
      setDisplayName('');
      setEmail('');
      setMessage('Acesso autorizado. Peça para a pessoa entrar com esta conta Google.');
    });
  };

  return (
    <AppShell>
      <section className="directory-content">
        <header className="page-heading">
          <div>
            <span className="eyebrow">Conta administrativa</span>
            <h1>Configurações</h1>
            <p>Gerencie sua conta e autorize pessoas responsáveis pela plataforma.</p>
          </div>
        </header>
        <dl className="detail-list settings-card">
          <div>
            <dt>Administrador</dt>
            <dd>{admin?.displayName}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{admin?.primaryEmail}</dd>
          </div>
        </dl>

        <section className="administrators-section" aria-labelledby="administrators-title">
          <div className="section-heading">
            <div>
              <h2 id="administrators-title">Administradores</h2>
              <p>Autorize acessos e acompanhe o primeiro cadastro de cada pessoa.</p>
            </div>
            <button
              className="button button--primary"
              type="button"
              onClick={() => setDialogOpen(true)}
            >
              + Adicionar administrador
            </button>
          </div>
          {message && (
            <p className="success-message" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {loading ? (
            <p className="table-state" role="status">
              Carregando administradores…
            </p>
          ) : (
            <div className="directory-table-wrap">
              <table className="directory-table administrators-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Situação</th>
                    <th>Último acesso</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={`${item.invitationId ? 'invitation' : 'admin'}-${item.id}`}>
                      <td data-label="Nome">
                        <strong>{item.displayName}</strong>
                      </td>
                      <td data-label="E-mail">{item.email}</td>
                      <td data-label="Situação">
                        <span
                          className={`status-badge status-badge--admin-${item.status.toLowerCase()}`}
                        >
                          <i />
                          {statusLabels[item.status]}
                        </span>
                      </td>
                      <td data-label="Último acesso">
                        {item.lastAccessAt
                          ? new Date(item.lastAccessAt).toLocaleString('pt-BR')
                          : 'Ainda não acessou'}
                      </td>
                      <td data-label="Ações">
                        <div className="row-actions">
                          {item.invitationId && (
                            <button
                              className="text-action"
                              disabled={busy}
                              type="button"
                              onClick={() =>
                                void withIdentityConfirmation(() =>
                                  platformAdminAccessApi.cancel(item.invitationId!),
                                )
                              }
                            >
                              Cancelar acesso
                            </button>
                          )}
                          {item.enrollmentRequestId && item.email !== admin?.primaryEmail && (
                            <button
                              className="text-action"
                              disabled={busy}
                              type="button"
                              onClick={() =>
                                void withIdentityConfirmation(async () => {
                                  await platformAdminAccessApi.approve(item.enrollmentRequestId!);
                                  setMessage('Primeiro dispositivo autorizado por tempo limitado.');
                                })
                              }
                            >
                              Aprovar dispositivo
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5}>Nenhum administrador encontrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
      {dialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <form
            className="management-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-admin-title"
            onSubmit={(event) => void submitInvitation(event)}
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">Novo acesso</span>
                <h2 id="new-admin-title">Adicionar administrador</h2>
              </div>
              <button
                aria-label="Fechar"
                className="dialog-close"
                type="button"
                onClick={() => setDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <label className="form-field">
              Nome completo
              <input
                required
                minLength={2}
                maxLength={160}
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label className="form-field">
              E-mail da conta Google
              <input
                required
                maxLength={320}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <p className="privacy-note">
              Você confirmará sua identidade antes de autorizar este acesso.
            </p>
            <div className="dialog-actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </button>
              <button className="button button--primary" disabled={busy} type="submit">
                {busy ? 'Confirmando…' : 'Confirmar identidade e autorizar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
};
