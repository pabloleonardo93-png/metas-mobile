import { useState, type PropsWithChildren } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { BrandLogo } from './BrandLogo';

const navigation = [
  ['/dashboard', 'Visão geral', '◫'],
  ['/pharmacies', 'Farmácias', '⌂'],
  ['/employees', 'Funcionários / Gestores', '◎'],
  ['/audit', 'Auditoria', '≡'],
  ['/settings', 'Configurações', '⚙'],
] as const;
export const AppShell = ({ children }: PropsWithChildren): React.JSX.Element => {
  const { logout, state } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const admin = state.kind === 'verified' ? state.admin : null;
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-content">
        Pular para o conteúdo
      </a>
      <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`} id="admin-navigation">
        <div className="brand brand--sidebar">
          <BrandLogo className="brand-logo brand-logo--sidebar" />
          <div>
            <strong>Metas</strong>
            <span>Administração</span>
          </div>
        </div>
        <nav aria-label="Navegação principal">
          {navigation.map(([to, label, icon]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="sidebar-note">
          Gestão da plataforma
          <br />
          Acesso administrativo protegido
        </p>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <button
            className="button button--ghost menu-toggle"
            aria-controls="admin-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
            type="button"
          >
            {menuOpen ? 'Fechar menu' : 'Menu'}
          </button>
          <div className="topbar-identity">
            <span className="eyebrow">Platform Admin</span>
            <strong>{admin?.displayName}</strong>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => void logout().catch(() => undefined)}
          >
            Sair
          </button>
        </header>
        <div id="admin-content" tabIndex={-1}>
          {children}
        </div>
      </main>
    </div>
  );
};
