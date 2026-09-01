import { AppShell } from '../components/AppShell';

export const DashboardPage = (): React.JSX.Element => (
  <AppShell>
    <section className="dashboard-content">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">Visão geral</span>
          <h1>Painel da plataforma</h1>
        </div>
        <span className="status-pill">
          <i aria-hidden="true" /> MFA verificado
        </span>
      </div>
      <div className="foundation-card">
        <div className="foundation-mark" aria-hidden="true">
          ✓
        </div>
        <div>
          <h2>Fundação administrativa pronta</h2>
          <p>
            A autenticação Google, a passkey e a sessão protegida estão ativas nesta experiência
            local.
          </p>
        </div>
      </div>
      <div className="placeholder-grid" aria-label="Próximas capacidades">
        <article>
          <span>Próxima etapa</span>
          <h3>Farmácias</h3>
          <p>Cadastro e gestão multi-loja entrarão após a revisão das rotas administrativas.</p>
        </article>
        <article>
          <span>Próxima etapa</span>
          <h3>Gestores</h3>
          <p>O vínculo inicial será implementado com autorização e auditoria transacionais.</p>
        </article>
        <article>
          <span>Base existente</span>
          <h3>Auditoria</h3>
          <p>Os eventos administrativos já são registrados no backend desde a autenticação.</p>
        </article>
      </div>
    </section>
  </AppShell>
);
