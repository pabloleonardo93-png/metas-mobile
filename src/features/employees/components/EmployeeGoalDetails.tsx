import { StyleSheet, View } from 'react-native';

import type { Campaign } from '@/features/campaigns/types/campaign.types';
import type { EmployeeGoalSummary } from '@/features/employees/types/employee.types';
import { AppProgressBar, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { calculateProgress } from '@/shared/utils/calculateProgress';
import { formatBrazilianCurrency, formatPercentage } from '@/shared/utils/formatters';
import { calculateRemainingGoalAmount } from '@/shared/utils/goalCalculations';

interface EmployeeGoalDetailsProps {
  campaigns: readonly Campaign[];
  goal: EmployeeGoalSummary;
}

interface ResolvedContribution {
  campaign: Campaign;
  contributedQuantity: number;
}

export function EmployeeGoalDetails({ campaigns, goal }: EmployeeGoalDetailsProps) {
  const progress = calculateProgress(goal.currentAmount, goal.targetAmount);
  const remaining = calculateRemainingGoalAmount(goal.targetAmount, goal.currentAmount);
  const remainingText =
    remaining > 0 ? `Faltam ${formatBrazilianCurrency(remaining)}` : 'Meta individual atingida.';
  const contributions = goal.campaignContributions.reduce<ResolvedContribution[]>(
    (resolvedContributions, contribution) => {
      const campaign = campaigns.find((item) => item.id === contribution.campaignId);

      if (campaign) {
        resolvedContributions.push({
          campaign,
          contributedQuantity: contribution.contributedQuantity,
        });
      }

      return resolvedContributions;
    },
    [],
  );

  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" style={styles.sectionTitle} variant="title">
        Meta atual
      </AppText>

      <View style={styles.goalCard}>
        <View style={styles.goalHeader}>
          <View style={styles.goalCopy}>
            <AppText style={styles.amount} variant="display">
              {formatBrazilianCurrency(goal.currentAmount)}
            </AppText>
            <AppText color="textMuted" variant="caption">
              de {formatBrazilianCurrency(goal.targetAmount)}
            </AppText>
          </View>
          <View style={styles.percentageBadge}>
            <AppText color="primary" variant="bodyMedium">
              {formatPercentage(progress)}
            </AppText>
          </View>
        </View>

        <AppProgressBar
          label={`Progresso da meta individual: ${formatPercentage(progress)}`}
          progress={progress}
        />

        <AppText color="textMuted" variant="caption">
          {remainingText}
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
  amount: {
    fontSize: 28,
    letterSpacing: 0,
    lineHeight: 36,
  },
  goalCard: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  goalCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  goalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  percentageBadge: {
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
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
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 20,
    letterSpacing: 0,
    lineHeight: 28,
  },
});
