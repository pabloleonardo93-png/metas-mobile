import { StyleSheet, View } from 'react-native';

import type { EmployeeFinancialGoal } from '@/features/metas/types/teamDistribution.types';
import { USER_ROLE_LABELS } from '@/shared/config/userRoles';
import { AppButton, AppIcon, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import type { EmployeeRole } from '@/shared/types/userRole';
import { formatBrazilianCurrency } from '@/shared/utils/formatters';

interface EmployeeFinancialGoalCardProps {
  compact?: boolean;
  goal: EmployeeFinancialGoal | null;
  onSeeDetails?: () => void;
  role: EmployeeRole;
  statusMessage?: string;
}

export function EmployeeFinancialGoalCard({
  compact = false,
  goal,
  onSeeDetails,
  role,
  statusMessage,
}: EmployeeFinancialGoalCardProps) {
  if (!goal) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.unavailableCard}>
        <View style={styles.unavailableIcon}>
          <AppIcon color={colors.primary} name="target" size={22} />
        </View>
        <View style={styles.unavailableCopy}>
          <AppText variant="bodyMedium">Sua meta</AppText>
          <AppText color="textMuted" variant="caption">
            {statusMessage ?? 'Seu cargo não possui meta individual na distribuição atual.'}
          </AppText>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headingCopy}>
          <AppText color="onPrimary" variant="label">
            Sua meta
          </AppText>
          <AppText color="onPrimary" style={styles.roleLabel} variant="caption">
            Cargo: {USER_ROLE_LABELS[role].singular}
          </AppText>
        </View>
        <View style={styles.iconContainer}>
          <AppIcon color={colors.onPrimary} name="target" size={22} />
        </View>
      </View>

      <View style={styles.dailyGoal}>
        <AppText color="onPrimary" variant="caption">
          Meta diária
        </AppText>
        <AppText
          adjustsFontSizeToFit
          color="onPrimary"
          minimumFontScale={0.72}
          numberOfLines={1}
          style={styles.dailyAmount}
          variant="display"
        >
          {formatBrazilianCurrency(goal.dailyGoal)}
        </AppText>
        <AppText color="onPrimary" style={styles.roleLabel} variant="caption">
          por funcionário / dia útil
        </AppText>
      </View>

      {!compact ? (
        <View style={styles.details}>
          <View style={styles.detailItem}>
            <AppText color="onPrimary" style={styles.detailLabel} variant="caption">
              Meta restante do período
            </AppText>
            <AppText
              adjustsFontSizeToFit
              color="onPrimary"
              minimumFontScale={0.8}
              numberOfLines={1}
              variant="bodyMedium"
            >
              {formatBrazilianCurrency(goal.remainingPeriodGoal)}
            </AppText>
          </View>
          <View style={[styles.detailItem, styles.detailItemBorder]}>
            <AppText color="onPrimary" style={styles.detailLabel} variant="caption">
              Dias úteis restantes
            </AppText>
            <AppText color="onPrimary" variant="bodyMedium">
              {goal.remainingBusinessDays}
            </AppText>
          </View>
        </View>
      ) : (
        <AppText color="onPrimary" style={styles.compactSupportingText} variant="caption">
          {goal.remainingBusinessDays} dias úteis restantes
        </AppText>
      )}

      {onSeeDetails ? (
        <AppButton label="Ver minhas metas" variant="secondary" onPress={onSeeDetails} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.card,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    gap: spacing.lg,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  compactSupportingText: {
    opacity: 0.9,
  },
  dailyAmount: {
    fontSize: 32,
    letterSpacing: 0,
    lineHeight: 40,
  },
  dailyGoal: {
    gap: spacing.xs,
  },
  detailItem: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  detailItemBorder: {
    borderLeftColor: 'rgba(255,255,255,0.28)',
    borderLeftWidth: 1,
  },
  detailLabel: {
    opacity: 0.82,
  },
  details: {
    flexDirection: 'row',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headingCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  iconContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  roleLabel: {
    opacity: 0.86,
  },
  unavailableCard: {
    ...shadows.panel,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  unavailableCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  unavailableIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
});
