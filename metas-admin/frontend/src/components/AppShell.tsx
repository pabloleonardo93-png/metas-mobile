import type { PropsWithChildren } from 'react';

import { useAuth } from '../auth/AuthContext';

export const AppShell = ({ children }: PropsWithChildren): React.JSX.Element => {
  const { logout, state } = useAuth();
  const admin = state.kind === 'verified' ? state.admin : null;

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand brand--sidebar">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <div>
            <strong>Metas</strong>
            <span>Administração</span>
          </div>
        </div>
        <nav aria-label="Navegação principal">
          <a className="nav-item nav-item--active" href="/dashboard" aria-current="page">
            <span aria-hidden="true">◫</span> Visão geral
          </a>
          <span className="nav-item nav-item--disabled">
            <span aria-hidden="true">⌂</span> Farmácias
          </span>
          <span className="nav-item nav-item--disabled">
            <span aria-hidden="true">◎</span> Gestores
          </span>
          <span className="nav-item nav-item--disabled">
            <span aria-hidden="true">≡</span> Auditoria
          </span>
        </nav>
        <p className="sidebar-note">Funções administrativas serão liberadas em etapas revisadas.</p>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div>
            <span className="eyebrow">Ambiente administrativo</span>
            <strong>{admin?.displayName}</strong>
            <span className="admin-email">{admin?.primaryEmail}</span>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => void logout().catch(() => undefined)}
          >
            Sair
          </button>
        </header>
        {children}
      </main>
    </div>
  );
};
