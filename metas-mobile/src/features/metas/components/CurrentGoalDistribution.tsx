import { StyleSheet, View } from 'react-native';

import { TEAM_ROLE_LABELS } from '@/features/metas/config/teamRoles';
import type { DailyGoalsCalculationResult } from '@/features/metas/types/teamDistribution.types';
import { formatDecimal } from '@/features/metas/utils/formatCurrency';
import { AppButton, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { formatBrazilianCurrency } from '@/shared/utils/formatters';

interface CurrentGoalDistributionProps {
  result: DailyGoalsCalculationResult;
  onOpenFullCalculation: () => void;
}

export function CurrentGoalDistribution({
  result,
  onOpenFullCalculation,
}: CurrentGoalDistributionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title">
          Distribuição atual
        </AppText>
        <AppText color="textMuted" variant="caption">
          Meta individual necessária por cargo e dia
        </AppText>
      </View>

      <View style={styles.card}>
        {result.status === 'success' ? (
          <View>
            {result.roles.map((role, index) => {
              const labels = TEAM_ROLE_LABELS[role.role];
              const employeeLabel = role.quantity === 1 ? 'funcionário' : 'funcionários';

              return (
                <View key={role.role} style={[styles.roleRow, index > 0 && styles.roleRowBorder]}>
                  <View style={styles.roleCopy}>
                    <AppText variant="bodyMedium">{labels.plural}</AppText>
                    <AppText color="textMuted" variant="caption">
                      Peso {formatDecimal(role.weight)} · {role.quantity} {employeeLabel}
                    </AppText>
                  </View>
                  <View style={styles.roleValue}>
                    <AppText
                      adjustsFontSizeToFit
                      color="primary"
                      minimumFontScale={0.78}
                      numberOfLines={1}
                      variant="bodyMedium"
                    >
                      {formatBrazilianCurrency(role.dailyGoalPerEmployee)}
                    </AppText>
                    <AppText color="textMuted" style={styles.valueCaption} variant="caption">
                      / funcionário / dia
                    </AppText>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View accessibilityLiveRegion="polite" style={styles.statusRow}>
            <View style={styles.statusDot} />
            <AppText style={styles.statusText} variant="bodyMedium">
              {result.message}
            </AppText>
          </View>
        )}

        <AppButton
          label="Ver cálculo completo"
          variant="secondary"
          onPress={onOpenFullCalculation}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  heading: {
    gap: spacing.xs,
  },
  roleCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  roleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  roleRowBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  roleValue: {
    alignItems: 'flex-end',
    flexShrink: 1,
    gap: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  statusDot: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 9,
    width: 9,
  },
  statusRow: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  statusText: {
    flex: 1,
  },
  valueCaption: {
    textAlign: 'right',
  },
});
