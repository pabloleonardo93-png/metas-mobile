import { useEffect, useId, useRef, useState } from 'react';

import { managementApi } from '../api/managementApi';
import {
  employeeCreateInputSchema,
  employeeRoles,
  type EmployeeRole,
  type Pharmacy,
} from '../api/management.contracts';
import { authenticateWithPasskey, supportsWebAuthn } from '../auth/webauthn';
import { roleLabels, safeManagementMessage } from './ManagementDialog';

interface EmployeeCreationDialogProps {
  close: () => void;
  initialRole?: EmployeeRole;
  initialStore?: Pick<Pharmacy, 'id' | 'name'>;
  saved: () => void;
}

export const EmployeeCreationDialog = ({
  close,
  initialRole,
  initialStore,
  saved,
}: EmployeeCreationDialogProps): React.JSX.Element => {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [role, setRole] = useState<EmployeeRole | ''>(initialRole ?? '');
  const [storeId, setStoreId] = useState(initialStore?.id ?? '');
  const [storeSearch, setStoreSearch] = useState('');
  const [stores, setStores] = useState<Pick<Pharmacy, 'id' | 'name'>[]>(
    initialStore ? [initialStore] : [],
  );
  const [storesBusy, setStoresBusy] = useState(!initialStore);
  const fixedManager = initialRole === 'GESTOR' && initialStore !== undefined;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (initialStore) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStoresBusy(true);
      void managementApi
        .list(
          'pharmacies',
          { q: storeSearch, status: 'ACTIVE', page: 1, pageSize: 50 },
          controller.signal,
        )
        .then((result) => {
          if (!controller.signal.aborted) setStores(result.items as Pharmacy[]);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(safeManagementMessage(reason));
        })
        .finally(() => {
          if (!controller.signal.aborted) setStoresBusy(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [initialStore, storeSearch]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    setFields({});
    const parsed = employeeCreateInputSchema.safeParse({ email, name, role, storeId });
    if (!parsed.success) {
      const nextFields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string') nextFields[key] = 'Revise este campo.';
      }
      setFields(nextFields);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      if (!supportsWebAuthn())
        throw new Error('Este dispositivo não permite confirmar sua identidade.');
      await authenticateWithPasskey();
      await managementApi.save('employees', null, parsed.data);
      saved();
    } catch (reason) {
      setError(safeManagementMessage(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog
      className="management-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className="dialog-heading">
        <h2 id={titleId}>{fixedManager ? 'Adicionar gestor' : 'Novo funcionário'}</h2>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={close}
          aria-label="Fechar cadastro"
        >
          Fechar
        </button>
      </header>
      {error && (
        <p role="alert" className="feedback feedback--error">
          {error}
        </p>
      )}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label className="form-field">
          Nome completo
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={150}
            autoComplete="name"
            aria-invalid={Boolean(fields.name)}
          />
          {fields.name && <span className="field-error">{fields.name}</span>}
        </label>
        <label className="form-field">
          E-mail da conta Google
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={320}
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(fields.email)}
          />
          {fields.email && <span className="field-error">{fields.email}</span>}
        </label>
        {initialStore ? (
          <p className="readonly-field">
            <span>Farmácia</span>
            <strong>{initialStore.name}</strong>
          </p>
        ) : (
          <>
            <label className="form-field">
              Buscar farmácia
              <input
                value={storeSearch}
                onChange={(event) => setStoreSearch(event.target.value)}
                placeholder="Nome ou identificador"
                maxLength={100}
              />
            </label>
            <label className="form-field">
              Farmácia
              <select
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                required
                aria-invalid={Boolean(fields.storeId)}
              >
                <option value="">Selecione uma farmácia ativa</option>
                {stores.map((store) => (
                  <option value={store.id} key={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              {fields.storeId && <span className="field-error">Selecione uma farmácia.</span>}
            </label>
            {storesBusy && <p role="status">Buscando farmácias…</p>}
          </>
        )}
        {initialRole ? (
          <p className="readonly-field">
            <span>Função</span>
            <strong>{roleLabels[initialRole]}</strong>
          </p>
        ) : (
          <label className="form-field">
            Função
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as EmployeeRole | '')}
              required
              aria-invalid={Boolean(fields.role)}
            >
              <option value="">Selecione a função</option>
              {employeeRoles.map((value) => (
                <option key={value} value={value}>
                  {roleLabels[value]}
                </option>
              ))}
            </select>
            {fields.role && <span className="field-error">Selecione uma função.</span>}
          </label>
        )}
        <p className="privacy-note">
          O acesso será autorizado para esta conta Google após a confirmação da sua identidade.
        </p>
        <div className="form-actions">
          <button className="button button--ghost" type="button" disabled={busy} onClick={close}>
            Cancelar
          </button>
          <button className="button button--primary" disabled={busy || storesBusy} type="submit">
            {busy ? 'Confirmando…' : fixedManager ? 'Adicionar gestor' : 'Adicionar funcionário'}
          </button>
        </div>
      </form>
    </dialog>
  );
};
