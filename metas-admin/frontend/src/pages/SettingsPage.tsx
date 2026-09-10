import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
export const SettingsPage = (): React.JSX.Element => {
  const { state } = useAuth();
  const admin = state.kind === 'verified' ? state.admin : null;
  return (
    <AppShell>
      <section className="directory-content">
        <header className="page-heading">
          <div>
            <span className="eyebrow">Conta administrativa</span>
            <h1>Configurações</h1>
            <p>Informações da sessão atual. Não há configurações editáveis nesta etapa.</p>
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
      </section>
    </AppShell>
  );
};
