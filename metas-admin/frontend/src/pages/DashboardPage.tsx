import { Link } from 'react-router';
import { AppShell } from '../components/AppShell';
export const DashboardPage = (): React.JSX.Element => (
  <AppShell>
    <section className="directory-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Visão geral</span>
          <h1>Gestão da plataforma</h1>
          <p>Farmácias, pessoas e o histórico das decisões, em um só lugar.</p>
        </div>
        <span className="status-badge status-badge--active">MFA verificado</span>
      </header>
      <div className="home-intro">
        <span className="eyebrow">Seu espaço de trabalho</span>
        <h2>Por onde vamos começar?</h2>
        <p>
          Acesse os cadastros para consultar ou atualizar a operação. Toda alteração de gestão é
          registrada em auditoria.
        </p>
      </div>
      <div className="shortcut-list">
        <Link to="/pharmacies">
          <div>
            <h2>Farmácias</h2>
            <p>Cadastros, gestores responsáveis e situação de cada unidade.</p>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
        <Link to="/employees">
          <div>
            <h2>Funcionários / Gestores</h2>
            <p>Pessoas, funções e vínculos com as farmácias.</p>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
        <Link to="/audit">
          <div>
            <h2>Auditoria</h2>
            <p>Consulte as alterações administrativas registradas.</p>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  </AppShell>
);
