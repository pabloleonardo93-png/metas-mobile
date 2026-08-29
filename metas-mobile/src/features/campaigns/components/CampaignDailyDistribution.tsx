import { StyleSheet, View } from 'react-native';

import type { CampaignDailyDistributionResult } from '@/features/campaigns/utils/calculateCampaignDistribution';
import { TEAM_ROLE_LABELS } from '@/features/metas/config/teamRoles';
import { formatDecimal } from '@/features/metas/utils/formatCurrency';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface CampaignDailyDistributionProps {
  result: CampaignDailyDistributionResult;
  statusMessage?: string;
}

const quantityFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

function formatQuantity(value: number): string {
  return quantityFormatter.format(Number.isFinite(value) && value >= 0 ? value : 0);
}

export function CampaignDailyDistribution({
  result,
  statusMessage,
}: CampaignDailyDistributionProps) {
  const message = statusMessage ?? result.message;

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title">
          Distribuição diária
        </AppText>
        <AppText color="textMuted" variant="caption">
          Quantidade necessária por cargo e funcionário
        </AppText>
      </View>

      {result.status !== 'success' || message ? (
        <View accessibilityLiveRegion="polite" style={styles.statusCard}>
          <View style={styles.statusDot} />
          <AppText style={styles.statusText} variant="bodyMedium">
            {message ?? 'A distribuição diária não está disponível.'}
          </AppText>
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.storeGoal}>
            <View style={styles.storeGoalCopy}>
              <AppText color="textMuted" variant="label">
                Meta diária da loja
              </AppText>
              <AppText color="textMuted" variant="caption">
                {formatQuantity(result.remainingAmount)} unidades restantes
              </AppText>
            </View>
            <View style={styles.storeGoalValue}>
              <AppText color="primary" variant="title">
                {formatQuantity(result.dailyStoreGoal)}
              </AppText>
              <AppText color="textMuted" variant="caption">
                unidades / dia
              </AppText>
            </View>
          </View>

          <View>
            {result.roles.map((role, index) => {
              const labels = TEAM_ROLE_LABELS[role.role];
              const employeeLabel = role.quantity === 1 ? 'funcionário' : 'funcionários';

              return (
                <View key={role.role} style={[styles.roleRow, index > 0 && styles.roleRowBorder]}>
                  <View style={styles.roleCopy}>
                    <AppText variant="bodyMedium">{labels.plural}</AppText>
                    <AppText color="textMuted" variant="caption">
                      {role.quantity} {employeeLabel} · peso {formatDecimal(role.weight)}
                    </AppText>
                    <AppText color="textMuted" variant="caption">
                      {formatQuantity(role.dailyGoalForGroup)} unidades do cargo / dia
                    </AppText>
                  </View>
                  <View style={styles.roleValue}>
                    <AppText color="primary" variant="bodyMedium">
                      {formatQuantity(role.dailyGoalPerEmployee)}
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
      )}
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
    gap: spacing.sm,
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
    maxWidth: 136,
  },
  section: {
    gap: spacing.md,
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
  statusDot: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 9,
    width: 9,
  },
  statusText: {
    flex: 1,
  },
  storeGoal: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  storeGoalCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 150,
  },
  storeGoalValue: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  valueCaption: {
    textAlign: 'right',
  },
});
