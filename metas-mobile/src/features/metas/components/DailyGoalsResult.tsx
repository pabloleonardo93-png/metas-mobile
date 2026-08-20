import { StyleSheet, View } from 'react-native';

import { TEAM_ROLE_LABELS } from '@/features/metas/config/teamRoles';
import type { DailyGoalsCalculationResult } from '@/features/metas/types/teamDistribution.types';
import { formatBrazilianCurrency, formatDecimal } from '@/features/metas/utils/formatCurrency';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { formatPercentage } from '@/shared/utils/formatters';

interface DailyGoalsResultProps {
  result: DailyGoalsCalculationResult;
}

export function DailyGoalsResult({ result }: DailyGoalsResultProps) {
  if (result.status !== 'success') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.statusCard}>
        <View style={styles.statusAccent} />
        <AppText style={styles.statusMessage} variant="bodyMedium">
          {result.message}
        </AppText>
      </View>
    );
  }

  return (
    <View accessibilityLiveRegion="polite" style={styles.section}>
      <AppText accessibilityRole="header" variant="title">
        Distribuição da meta diária
      </AppText>

      <View style={styles.resultCard}>
        <View style={styles.storeGoal}>
          <AppText color="textMuted" variant="label">
            Meta diária da loja
          </AppText>
          <AppText color="primary" variant="display">
            {formatBrazilianCurrency(result.dailyStoreGoal)}
          </AppText>
          <AppText color="textMuted" variant="caption">
            por dia restante
          </AppText>
        </View>

        <View style={styles.divider} />

        <AppText variant="bodyMedium">Distribuição por cargo</AppText>

        <View style={styles.roleResults}>
          {result.roles.map((role) => {
            const labels = TEAM_ROLE_LABELS[role.role];
            const employeeLabel = role.quantity === 1 ? 'funcionário' : 'funcionários';

            return (
              <View key={role.role} style={styles.roleBlock}>
                <View style={styles.roleHeading}>
                  <AppText variant="bodyMedium">{labels.plural}</AppText>
                  <AppText color="textMuted" variant="caption">
                    {role.quantity} {employeeLabel}
                  </AppText>
                </View>

                <View style={styles.metrics}>
                  <View style={styles.metricRow}>
                    <AppText color="textMuted" variant="caption">
                      Peso individual
                    </AppText>
                    <AppText variant="label">{formatDecimal(role.weight)}</AppText>
                  </View>

                  <View style={styles.metricRow}>
                    <View style={styles.metricCopy}>
                      <AppText color="textMuted" variant="caption">
                        Participação ponderada do cargo
                      </AppText>
                      <AppText color="textMuted" variant="caption">
                        {formatDecimal(role.weightedGroupValue)} de{' '}
                        {formatDecimal(result.totalTeamWeight)} pontos
                      </AppText>
                    </View>
                    <AppText variant="label">
                      {formatPercentage(role.weightedGroupShare * 100)}
                    </AppText>
                  </View>

                  <View style={styles.metricRow}>
                    <AppText color="textMuted" variant="caption">
                      Meta do cargo / dia
                    </AppText>
                    <AppText variant="label">
                      {formatBrazilianCurrency(role.dailyGoalForGroup)}
                    </AppText>
                  </View>
                </View>

                <View style={styles.individualGoal}>
                  <AppText color="textMuted" variant="caption">
                    Meta por funcionário / dia
                  </AppText>
                  <AppText color="primary" variant="bodyMedium">
                    {formatBrazilianCurrency(role.dailyGoalPerEmployee)}
                  </AppText>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    backgroundColor: colors.border,
    height: 1,
  },
  resultCard: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  individualGoal: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  metricCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  metricRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  metrics: {
    gap: spacing.sm,
  },
  roleResults: {
    gap: 0,
  },
  roleBlock: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  roleHeading: {
    gap: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  statusAccent: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 10,
    width: 10,
  },
  statusCard: {
    ...shadows.panel,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  statusMessage: {
    flex: 1,
  },
  storeGoal: {
    gap: spacing.xs,
  },
});
