import { StyleSheet, View } from 'react-native';

import type { Campaign } from '@/features/campaigns/types/campaign.types';
import type { EmployeeSalesSnapshot } from '@/features/employees/types/employee.types';
import { EmployeeFinancialGoalCard } from '@/features/metas/components/EmployeeFinancialGoalCard';
import type { EmployeeFinancialGoal } from '@/features/metas/types/teamDistribution.types';
import { resolveCampaignContributions } from '@/features/results/utils/resolveCampaignContributions';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import type { EmployeeRole } from '@/shared/types/userRole';
import { formatBrazilianCurrency } from '@/shared/utils/formatters';

interface EmployeeGoalDetailsProps {
  campaigns: readonly Campaign[];
  financialGoal: EmployeeFinancialGoal | null;
  performance: EmployeeSalesSnapshot;
  role: EmployeeRole;
  statusMessage?: string;
}

export function EmployeeGoalDetails({
  campaigns,
  financialGoal,
  performance,
  role,
  statusMessage,
}: EmployeeGoalDetailsProps) {
  const contributions = resolveCampaignContributions(campaigns, performance.campaignContributions);

  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" style={styles.sectionTitle} variant="title">
        Meta financeira
      </AppText>

      <EmployeeFinancialGoalCard goal={financialGoal} role={role} statusMessage={statusMessage} />

      <View style={styles.performanceCard}>
        <View style={styles.performanceCopy}>
          <AppText variant="bodyMedium">Desempenho individual simulado</AppText>
          <AppText color="textMuted" variant="caption">
            Vendas registradas no mês
          </AppText>
        </View>
        <AppText color="primary" variant="bodyMedium">
          {formatBrazilianCurrency(performance.monthSalesAmount)}
        </AppText>
      </View>

      {contributions.length > 0 ? (
        <View style={styles.contributionsSection}>
          <AppText variant="bodyMedium">Contribuição em campanhas</AppText>
          <View style={styles.contributionsCard}>
            {contributions.map(({ campaign, contributedQuantity }, index) => (
              <View
                key={campaign.id}
                style={[styles.contributionRow, index > 0 && styles.contributionRowWithDivider]}
              >
                <View style={styles.contributionCopy}>
                  <AppText numberOfLines={2} variant="bodyMedium">
                    {campaign.name}
                  </AppText>
                  <AppText color="textMuted" variant="caption">
                    Campanha coletiva da loja
                  </AppText>
                </View>
                <View style={styles.contributionValue}>
                  <AppText color="textMuted" variant="caption">
                    Sua contribuição
                  </AppText>
                  <AppText color="primary" variant="bodyMedium">
                    {contributedQuantity} {contributedQuantity === 1 ? 'unidade' : 'unidades'}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contributionCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  contributionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 76,
    padding: spacing.md,
  },
  contributionRowWithDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  contributionValue: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  contributionsCard: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  contributionsSection: {
    gap: spacing.md,
  },
  performanceCard: {
    ...shadows.panel,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  performanceCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 20,
    letterSpacing: 0,
    lineHeight: 28,
  },
});
