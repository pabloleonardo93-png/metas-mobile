import { StyleSheet, View } from 'react-native';

import { TEAM_ROLE_LABELS } from '@/features/metas/config/teamRoles';
import type { DailyGoalsCalculationResult } from '@/features/metas/types/teamDistribution.types';
import { formatBrazilianCurrency, formatDecimal } from '@/features/metas/utils/formatCurrency';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

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
        Resultado calculado
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
            por dia útil restante
          </AppText>
        </View>

        <View style={styles.divider} />

        <AppText variant="bodyMedium">Meta diária por funcionário</AppText>

        <View style={styles.roleResults}>
          {result.roles.map((role) => {
            const labels = TEAM_ROLE_LABELS[role.role];
            const employeeLabel = role.quantity === 1 ? 'funcionário' : 'funcionários';

            return (
              <View key={role.role} style={styles.roleRow}>
                <View style={styles.roleCopy}>
                  <AppText variant="bodyMedium">{labels.singular}</AppText>
                  <AppText color="textMuted" variant="caption">
                    {role.quantity} {employeeLabel} - Peso {formatDecimal(role.weight)}
                  </AppText>
                </View>

                <View style={styles.roleValue}>
                  <AppText color="primary" variant="bodyMedium">
                    {formatBrazilianCurrency(role.dailyGoalPerEmployee)}
                  </AppText>
                  <AppText color="textMuted" style={styles.valueCaption} variant="caption">
                    por funcionário / dia
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
  roleCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  roleResults: {
    gap: spacing.md,
  },
  roleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  roleValue: {
    alignItems: 'flex-end',
    flexShrink: 1,
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
  valueCaption: {
    textAlign: 'right',
  },
});
