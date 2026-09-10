import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { managementApi } from '../api/managementApi';
import type { AuditEvent } from '../api/management.contracts';
import { AdminIcon, type AdminIconName } from '../components/AdminIcon';
import { AppShell } from '../components/AppShell';
import { formatManagementDate, managementActionLabels } from '../management/presentation';

interface DashboardSummary {
  auditCount: number;
  employeeCount: number;
  pharmacyCount: number;
  recentAudit: AuditEvent[];
}

const summaryCards: Array<{
  description: string;
  icon: AdminIconName;
  key: 'auditCount' | 'employeeCount' | 'pharmacyCount';
  label: string;
  to: string;
}> = [
  {
    description: 'Unidades cadastradas',
    icon: 'pharmacy',
    key: 'pharmacyCount',
    label: 'Farmácias',
    to: '/pharmacies',
  },
  {
    description: 'Pessoas vinculadas',
    icon: 'employees',
    key: 'employeeCount',
    label: 'Funcionários',
    to: '/employees',
  },
  {
    description: 'Registros disponíveis',
    icon: 'audit',
    key: 'auditCount',
    label: 'Auditoria',
    to: '/audit',
  },
];

export const DashboardPage = (): React.JSX.Element => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryUnavailable, setSummaryUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setSummaryUnavailable(false);
    void Promise.all([
      managementApi.list('pharmacies', { page: 1, pageSize: 1 }, controller.signal),
      managementApi.list('employees', { page: 1, pageSize: 1 }, controller.signal),
      managementApi.list('audit', { page: 1, pageSize: 5 }, controller.signal),
    ])
      .then(([pharmacies, employees, audit]) => {
        if (controller.signal.aborted) return;
        setSummary({
          auditCount: audit.total,
          employeeCount: employees.total,
          pharmacyCount: pharmacies.total,
          recentAudit: audit.items as AuditEvent[],
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSummaryUnavailable(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <AppShell>
      <section className="directory-content dashboard-content">
        <header className="page-heading">
          <div>
            <span className="eyebrow">Visão geral</span>
            <h1>Gestão da plataforma</h1>
            <p>Farmácias, pessoas e o histórico das decisões, em um só lugar.</p>
          </div>
        </header>

        <div aria-label="Resumo da plataforma" className="summary-grid">
          {summaryCards.map((card) => (
            <Link className="summary-card" key={card.key} to={card.to}>
              <span className="summary-card__icon">
                <AdminIcon name={card.icon} />
              </span>
              <span className="summary-card__copy">
                <strong>{card.label}</strong>
                <b aria-label={`${card.label}: ${summary?.[card.key] ?? 'carregando'}`}>
                  {summary?.[card.key] ?? '—'}
                </b>
                <small>{card.description}</small>
              </span>
              <span aria-hidden="true" className="summary-card__arrow">
                →
              </span>
            </Link>
          ))}
        </div>

        {summaryUnavailable && (
          <p className="dashboard-feedback" role="status">
            O resumo não está disponível agora. Os atalhos continuam funcionando.
          </p>
        )}

        <div className="dashboard-grid">
          <section className="dashboard-panel" aria-labelledby="recent-activity-title">
            <header className="panel-heading">
              <div>
                <span className="panel-heading__icon">
                  <AdminIcon name="audit" />
                </span>
                <h2 id="recent-activity-title">Atividade recente</h2>
              </div>
              <Link to="/audit">Ver auditoria</Link>
            </header>
            {summary?.recentAudit.length ? (
              <ul className="activity-list">
                {summary.recentAudit.map((event) => (
                  <li key={event.id}>
                    <span className={`outcome-dot outcome-dot--${event.outcome.toLowerCase()}`} />
                    <div>
                      <strong>
                        {managementActionLabels[event.action] ?? 'Operação administrativa'}
                      </strong>
                      <span>{event.actor}</span>
                    </div>
                    <time dateTime={event.createdAt}>{formatManagementDate(event.createdAt)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-empty">
                {summary ? 'Nenhuma atividade registrada.' : 'Carregando atividade…'}
              </p>
            )}
          </section>

          <section className="dashboard-panel" aria-labelledby="quick-access-title">
            <header className="panel-heading">
              <div>
                <span className="panel-heading__icon">
                  <AdminIcon name="dashboard" />
                </span>
                <h2 id="quick-access-title">Acesso rápido</h2>
              </div>
            </header>
            <div className="quick-access-list">
              {summaryCards.map((card) => (
                <Link key={card.to} to={card.to}>
                  <span>
                    <AdminIcon name={card.icon} />
                  </span>
                  <div>
                    <strong>{card.label}</strong>
                    <small>{card.description}</small>
                  </div>
                  <b aria-hidden="true">→</b>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
};
