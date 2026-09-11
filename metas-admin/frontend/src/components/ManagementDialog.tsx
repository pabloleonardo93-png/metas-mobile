import { useEffect, useId, useRef, useState } from 'react';
import { AdminApiError } from '../api/adminApi';
import { managementApi } from '../api/managementApi';
import {
  employeeInputSchema,
  employeeRoles,
  linkInputSchema,
  pharmacyInputSchema,
  type Employee,
  type Pharmacy,
} from '../api/management.contracts';

export const roleLabels = {
  GESTOR: 'Gestor',
  BALCONISTA: 'Balconista',
  CAIXA: 'Caixa',
  FARMACEUTICO: 'Farmacêutico',
} as const;
export type DialogSelection = {
  mode: 'create' | 'edit' | 'details' | 'status' | 'link';
  item: Pharmacy | Employee | null;
};
export interface ManagementSaveResult {
  id: string;
  input: unknown;
}
export const safeManagementMessage = (error: unknown): string =>
  error instanceof AdminApiError
    ? error.message
    : 'Não foi possível concluir a operação. Tente novamente.';

export const ManagementDialog = ({
  resource,
  selection,
  close,
  saved,
}: {
  resource: 'pharmacies' | 'employees';
  selection: DialogSelection;
  close: () => void;
  saved: (result: ManagementSaveResult) => void;
}): React.JSX.Element => {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<unknown>(null);
  const [storeSearch, setStoreSearch] = useState('');
  const [stores, setStores] = useState<Pharmacy[]>([]);
  const [storesBusy, setStoresBusy] = useState(false);
  const item = selection.item;
  const pharmacy = item && 'slug' in item ? item : null;
  const employee = item && 'userId' in item ? item : null;
  const inactive = pharmacy ? !pharmacy.isActive : employee?.status === 'INATIVO';
  const title =
    selection.mode === 'details'
      ? 'Detalhes do cadastro'
      : selection.mode === 'link'
        ? 'Vincular a outra farmácia'
        : selection.mode === 'status'
          ? inactive
            ? 'Reativar cadastro?'
            : 'Desativar cadastro?'
          : selection.mode === 'create'
            ? 'Nova farmácia'
            : 'Editar cadastro';

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (selection.mode !== 'link') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStoresBusy(true);
      void managementApi
        .list('pharmacies', { q: storeSearch, status: 'ACTIVE', pageSize: 20 }, controller.signal)
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
  }, [storeSearch, selection.mode]);

  const persist = async (input: unknown) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await managementApi.save(
        resource,
        item?.id ?? null,
        input,
        selection.mode === 'link',
      );
      saved({ id: result.id, input });
    } catch (reason) {
      setError(safeManagementMessage(reason));
      setPending(null);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const statusInput = () =>
    pharmacy
      ? {
          name: pharmacy.name,
          slug: pharmacy.slug,
          timezone: pharmacy.timezone,
          isActive: !pharmacy.isActive,
          version: pharmacy.version,
        }
      : employee
        ? {
            name: employee.name,
            role: employee.role,
            status: employee.status === 'ATIVO' ? 'INATIVO' : 'ATIVO',
            version: employee.version,
            userVersion: employee.userVersion,
          }
        : {};
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setFields({});
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const input =
      selection.mode === 'link'
        ? data
        : resource === 'pharmacies'
          ? {
              ...data,
              isActive: pharmacy?.isActive ?? true,
              ...(pharmacy ? { version: pharmacy.version } : {}),
            }
          : {
              ...data,
              status: employee?.status,
              version: employee?.version,
              userVersion: employee?.userVersion,
            };
    const schema =
      selection.mode === 'link'
        ? linkInputSchema
        : resource === 'pharmacies'
          ? pharmacyInputSchema
          : employeeInputSchema;
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string') errors[key] = 'Revise este campo.';
      }
      setFields(errors);
      return;
    }
    if (employee && selection.mode === 'edit' && data.role !== employee.role) {
      setPending(parsed.data);
      return;
    }
    void persist(parsed.data);
  };
  const field = (key: string, label: string, value = '', type = 'text') => (
    <div className="form-field" key={key}>
      <label htmlFor={`${titleId}-input-${key}`}>{label}</label>
      <input
        id={`${titleId}-input-${key}`}
        name={key}
        type={type}
        defaultValue={value}
        required
        aria-invalid={Boolean(fields[key])}
        aria-describedby={fields[key] ? `${titleId}-${key}` : undefined}
        maxLength={key === 'slug' ? 80 : 150}
      />
      {fields[key] && (
        <span id={`${titleId}-${key}`} className="field-error">
          {fields[key]}
        </span>
      )}
    </div>
  );
  const roleField = (
    <label className="form-field">
      Função
      <select name="role" defaultValue={employee?.role ?? 'GESTOR'}>
        {employeeRoles.map((role) => (
          <option key={role} value={role}>
            {roleLabels[role]}
          </option>
        ))}
      </select>
    </label>
  );
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
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={close}
          aria-label="Fechar detalhes"
        >
          Fechar
        </button>
      </header>
      {error && (
        <p role="alert" className="feedback feedback--error">
          {error}
        </p>
      )}
      {selection.mode === 'details' && item ? (
        <>
          <dl className="detail-list">
            <div>
              <dt>Nome</dt>
              <dd>{item.name}</dd>
            </div>
            <div>
              <dt>Identificador interno</dt>
              <dd>{item.id}</dd>
            </div>
            {pharmacy ? (
              <>
                <div>
                  <dt>Identificador público</dt>
                  <dd>{pharmacy.slug}</dd>
                </div>
                <div>
                  <dt>Fuso horário</dt>
                  <dd>{pharmacy.timezone}</dd>
                </div>
                <div>
                  <dt>Gestores ativos</dt>
                  <dd>{pharmacy.managers.join(', ') || 'Nenhum gestor cadastrado'}</dd>
                </div>
                <div>
                  <dt>Funcionários ativos</dt>
                  <dd>{pharmacy.employeeCount}</dd>
                </div>
              </>
            ) : employee ? (
              <>
                <div>
                  <dt>E-mail de acesso</dt>
                  <dd>{employee.email}</dd>
                </div>
                <div>
                  <dt>Farmácia</dt>
                  <dd>{employee.storeName}</dd>
                </div>
                <div>
                  <dt>Função</dt>
                  <dd>{roleLabels[employee.role]}</dd>
                </div>
                <div>
                  <dt>Conta</dt>
                  <dd>
                    {
                      { ACTIVE: 'Ativa', PENDING: 'Pendente', DISABLED: 'Desabilitada' }[
                        employee.accountStatus
                      ]
                    }
                  </dd>
                </div>
                <div>
                  <dt>Início do vínculo</dt>
                  <dd>{employee.joinedOn}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Situação do {pharmacy ? 'cadastro' : 'vínculo'}</dt>
              <dd>{inactive ? 'Inativo' : 'Ativo'}</dd>
            </div>
          </dl>
        </>
      ) : selection.mode === 'status' || pending ? (
        <div className="confirmation">
          <p>
            {pending
              ? 'A mudança de função encerra as sessões deste vínculo. A pessoa precisará entrar novamente.'
              : inactive
                ? 'O cadastro será reativado. As demais condições de acesso continuam sendo exigidas.'
                : pharmacy
                  ? 'O acesso dos funcionários desta farmácia será bloqueado e suas sessões serão encerradas. Os cadastros e o histórico serão preservados.'
                  : 'O acesso por este vínculo será bloqueado e suas sessões serão encerradas. Outros vínculos permanecem inalterados. O último gestor ativo não pode ser desativado.'}
          </p>
          <div className="form-actions">
            <button className="button button--ghost" type="button" onClick={close} disabled={busy}>
              Cancelar
            </button>
            <button
              className={`button ${!inactive && !pending ? 'button--danger' : 'button--primary'}`}
              disabled={busy}
              type="button"
              onClick={() => void persist(pending ?? statusInput())}
            >
              {busy
                ? 'Salvando…'
                : pending
                  ? 'Confirmar alteração'
                  : inactive
                    ? 'Reativar'
                    : 'Desativar'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          {selection.mode === 'link' ? (
            <>
              <p>
                Cria um novo vínculo sem mover ou apagar o histórico do anterior. O primeiro vínculo
                de uma farmácia deve ser de gestor.
              </p>
              <label className="form-field">
                Buscar farmácia
                <input
                  value={storeSearch}
                  onChange={(e) => setStoreSearch(e.target.value)}
                  placeholder="Nome ou identificador"
                />
              </label>
              <label className="form-field">
                Farmácia de destino
                <select
                  name="storeId"
                  required
                  aria-invalid={Boolean(fields.storeId)}
                  defaultValue=""
                >
                  <option value="">Selecione uma farmácia ativa</option>
                  {stores
                    .filter((s) => s.id !== employee?.storeId)
                    .map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
                {fields.storeId && <span className="field-error">Selecione uma farmácia.</span>}
              </label>
              {storesBusy && <p role="status">Buscando farmácias…</p>}
              {roleField}
            </>
          ) : resource === 'pharmacies' ? (
            <>
              {field('name', 'Nome da farmácia', pharmacy?.name)}
              {field('slug', 'Identificador público', pharmacy?.slug)}
              <p className="field-hint">Use letras minúsculas, números e hífens.</p>
              {field('timezone', 'Fuso horário', pharmacy?.timezone ?? 'America/Sao_Paulo')}
            </>
          ) : (
            <>
              {field('name', 'Nome completo', employee?.name)}
              <p className="field-hint">
                O nome pertence à pessoa e é compartilhado por todos os seus vínculos. O e-mail de
                acesso não é alterado aqui.
              </p>
              {roleField}
            </>
          )}
          <div className="form-actions">
            <button className="button button--ghost" type="button" disabled={busy} onClick={close}>
              Cancelar
            </button>
            <button className="button button--primary" disabled={busy || storesBusy} type="submit">
              {busy ? 'Salvando…' : selection.mode === 'link' ? 'Criar vínculo' : 'Salvar cadastro'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
};
