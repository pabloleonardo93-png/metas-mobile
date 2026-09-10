import { useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import {
  ManagementDialog,
  roleLabels,
  safeManagementMessage,
  type DialogSelection,
} from '../components/ManagementDialog';
import {
  employeeRoles,
  type AuditEvent,
  type Employee,
  type ListInput,
  type ManagementResource,
  type Page,
  type Pharmacy,
} from '../api/management.contracts';
import { managementApi } from '../api/managementApi';
import { formatManagementDate, managementActionLabels } from '../management/presentation';

const descriptions = {
  pharmacies: ['Farmácias', 'Organize as unidades e acompanhe os vínculos de cada farmácia.'],
  employees: [
    'Funcionários / Gestores',
    'Gerencie pessoas existentes, suas funções e vínculos. Desativar preserva o histórico.',
  ],
  audit: [
    'Auditoria',
    'Histórico das operações de gestão. Dados de autenticação e informações técnicas sensíveis não são exibidos.',
  ],
} as const;
export const StatusBadge = ({ active }: { active: boolean }): React.JSX.Element => (
  <span className={`status-badge ${active ? 'status-badge--active' : ''}`}>
    <i aria-hidden="true" />
    {active ? 'Ativo' : 'Inativo'}
  </span>
);

const accountStatusLabels = {
  ACTIVE: 'Ativa',
  DISABLED: 'Desabilitada',
  PENDING: 'Pendente',
} as const;

const outcomeLabels = {
  DENIED: 'Negada',
  FAILURE: 'Falhou',
  SUCCESS: 'Concluída',
} as const;
export const DirectoryPage = ({
  resource,
}: {
  resource: ManagementResource;
}): React.JSX.Element => {
  const [filters, setFilters] = useState<Partial<ListInput>>({
    page: 1,
    pageSize: 20,
    q: '',
    status: 'ALL',
    role: 'ALL',
  });
  const [query, setQuery] = useState('');
  const [data, setData] = useState<Page<Pharmacy | Employee | AuditEvent> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [success, setSuccess] = useState('');
  const [selection, setSelection] = useState<DialogSelection | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void managementApi
      .list(resource, filters, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(safeManagementMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [resource, filters, revision]);
  const updateFilters = (change: Partial<ListInput>) => {
    setFilters((current) => ({ ...current, ...change, page: 1 }));
    setSuccess('');
  };
  const title = descriptions[resource][0];
  const actions = (item: Pharmacy | Employee) => (
    <div className="row-actions">
      <button
        className="text-action"
        type="button"
        aria-label={`Detalhes de ${item.name}`}
        onClick={() => setSelection({ mode: 'details', item })}
      >
        Detalhes
      </button>
      <button
        className="text-action"
        type="button"
        aria-label={`Editar ${item.name}`}
        onClick={() => setSelection({ mode: 'edit', item })}
      >
        Editar
      </button>
      {'userId' in item && (
        <button
          className="text-action"
          type="button"
          aria-label={`Vincular ${item.name}`}
          onClick={() => setSelection({ mode: 'link', item })}
        >
          Vincular
        </button>
      )}
      <button
        className="text-action"
        type="button"
        aria-label={`${('isActive' in item ? item.isActive : item.status === 'ATIVO') ? 'Desativar' : 'Reativar'} ${item.name}`}
        onClick={() => setSelection({ mode: 'status', item })}
      >
        {('isActive' in item ? item.isActive : item.status === 'ATIVO') ? 'Desativar' : 'Reativar'}
      </button>
    </div>
  );
  return (
    <AppShell>
      <section className={`directory-content directory-content--${resource}`}>
        <header className="page-heading">
          <div>
            <span className="eyebrow">Gestão da plataforma</span>
            <h1>{title}</h1>
            <p>{descriptions[resource][1]}</p>
          </div>
          {resource === 'pharmacies' && (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setSelection({ mode: 'create', item: null })}
            >
              Nova farmácia
            </button>
          )}
        </header>
        <form
          className="directory-toolbar"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            updateFilters({ q: query });
          }}
        >
          <label className="search-field">
            <span>Pesquisar</span>
            <input
              type="search"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                resource === 'pharmacies'
                  ? 'Nome ou identificador'
                  : resource === 'employees'
                    ? 'Nome ou e-mail'
                    : 'Ação ou administrador'
              }
            />
          </label>
          <button type="submit" className="button button--secondary">
            Buscar
          </button>
          {resource !== 'audit' && (
            <label className="filter-field">
              Status
              <select
                value={filters.status}
                onChange={(event) =>
                  updateFilters({ status: event.target.value as ListInput['status'] })
                }
              >
                <option value="ALL">Todos</option>
                <option value="ACTIVE">Ativos</option>
                <option value="INACTIVE">Inativos</option>
              </select>
            </label>
          )}
          {resource === 'employees' && (
            <label className="filter-field">
              Função
              <select
                value={filters.role}
                onChange={(event) =>
                  updateFilters({ role: event.target.value as ListInput['role'] })
                }
              >
                <option value="ALL">Todas</option>
                {employeeRoles.map((role) => (
                  <option value={role} key={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="button button--ghost refresh-button"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            Atualizar
          </button>
        </form>
        {success && (
          <p className="feedback feedback--success" role="status">
            {success}
          </p>
        )}
        {loading ? (
          <div className="table-state" role="status" aria-label="Carregando registros">
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <p>Carregando registros…</p>
          </div>
        ) : error ? (
          <div className="table-state">
            <h2>Não foi possível carregar a lista</h2>
            <p role="alert">{error}</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setRevision((value) => value + 1)}
            >
              Tentar novamente
            </button>
          </div>
        ) : !data?.items.length ? (
          <div className="table-state">
            <span className="empty-symbol" aria-hidden="true">
              ≡
            </span>
            <h2>Nenhum registro encontrado</h2>
            <p>
              {filters.q || filters.status !== 'ALL' || filters.role !== 'ALL'
                ? 'Ajuste a busca ou os filtros para tentar novamente.'
                : resource === 'employees'
                  ? 'Os vínculos de usuários existentes aparecerão aqui.'
                  : resource === 'audit'
                    ? 'As próximas operações de gestão serão registradas aqui.'
                    : 'Cadastre a primeira farmácia para começar.'}
            </p>
          </div>
        ) : (
          <div className="directory-table-wrap">
            <table className="directory-table">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  {resource === 'pharmacies' ? (
                    <>
                      <th scope="col">Farmácia</th>
                      <th scope="col">Gestores ativos</th>
                      <th scope="col">Funcionários</th>
                      <th scope="col">Status</th>
                      <th scope="col">Atualização</th>
                      <th scope="col">Ações</th>
                    </>
                  ) : resource === 'employees' ? (
                    <>
                      <th scope="col">Pessoa</th>
                      <th scope="col">E-mail</th>
                      <th scope="col">Farmácia</th>
                      <th scope="col">Função</th>
                      <th scope="col">Status</th>
                      <th scope="col">Vínculo</th>
                      <th scope="col">Ações</th>
                    </>
                  ) : (
                    <>
                      <th scope="col">Operação</th>
                      <th scope="col">Administrador</th>
                      <th scope="col">Resultado</th>
                      <th scope="col">Data</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    {'slug' in item ? (
                      <>
                        <td data-label="Farmácia">
                          <strong>{item.name}</strong>
                          <span className="cell-secondary">{item.slug}</span>
                        </td>
                        <td data-label="Gestores">
                          {item.managers.join(', ') || 'Sem gestor vinculado'}
                        </td>
                        <td data-label="Funcionários ativos">{item.employeeCount}</td>
                        <td data-label="Status">
                          <StatusBadge active={item.isActive} />
                        </td>
                        <td data-label="Atualização">{formatManagementDate(item.updatedAt)}</td>
                        <td data-label="Ações">{actions(item)}</td>
                      </>
                    ) : 'userId' in item ? (
                      <>
                        <td data-label="Pessoa">
                          <strong>{item.name}</strong>
                        </td>
                        <td data-label="E-mail">{item.email}</td>
                        <td data-label="Farmácia">{item.storeName}</td>
                        <td data-label="Função">{roleLabels[item.role]}</td>
                        <td data-label="Status">
                          <span
                            className={`status-badge status-badge--account-${item.accountStatus.toLowerCase()}`}
                          >
                            <i aria-hidden="true" />
                            {accountStatusLabels[item.accountStatus]}
                          </span>
                        </td>
                        <td data-label="Vínculo">
                          <StatusBadge active={item.status === 'ATIVO'} />
                        </td>
                        <td data-label="Ações">{actions(item)}</td>
                      </>
                    ) : (
                      <>
                        <td data-label="Operação">
                          <strong>
                            {managementActionLabels[item.action] ?? 'Operação administrativa'}
                          </strong>
                        </td>
                        <td data-label="Administrador">{item.actor}</td>
                        <td data-label="Resultado">
                          <span
                            className={`status-badge status-badge--outcome-${item.outcome.toLowerCase()}`}
                          >
                            <i aria-hidden="true" />
                            {outcomeLabels[item.outcome]}
                          </span>
                        </td>
                        <td data-label="Data">{formatManagementDate(item.createdAt)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && data && (
          <footer className="pagination">
            <span>
              {data.total} {data.total === 1 ? 'registro' : 'registros'} · Página {data.page} de{' '}
              {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <div>
              <button
                type="button"
                className="button button--ghost"
                disabled={data.page <= 1}
                onClick={() =>
                  setFilters((current) => ({ ...current, page: (current.page ?? 1) - 1 }))
                }
              >
                Anterior
              </button>
              <button
                type="button"
                className="button button--ghost"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() =>
                  setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))
                }
              >
                Próxima
              </button>
            </div>
          </footer>
        )}
        {selection && resource !== 'audit' && (
          <ManagementDialog
            resource={resource}
            selection={selection}
            close={() => setSelection(null)}
            saved={() => {
              setSelection(null);
              setSuccess('Alteração salva e registrada em auditoria.');
              setRevision((value) => value + 1);
            }}
          />
        )}
      </section>
    </AppShell>
  );
};
