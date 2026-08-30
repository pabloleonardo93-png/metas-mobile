import { StyleSheet, View } from 'react-native';

import type { CampaignFinancialDistributionResult } from '@/features/campaigns/utils/calculateCampaignDistribution';
import { TEAM_ROLE_LABELS } from '@/features/metas/config/teamRoles';
import { formatDecimal } from '@/features/metas/utils/formatCurrency';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { formatCentsAsBrl } from '@/shared/utils/brlCurrency';

interface CampaignFinancialDistributionProps {
  result: CampaignFinancialDistributionResult;
  statusMessage?: string;
}

export function CampaignFinancialDistribution({
  result,
  statusMessage,
}: CampaignFinancialDistributionProps) {
  const message = statusMessage ?? result.message;

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title">
          Quanto cada funcionário precisa vender
        </AppText>
        <AppText color="textMuted" variant="caption">
          Distribuição financeira pelos mesmos pesos configurados em Metas
        </AppText>
      </View>

      {result.status !== 'success' || message ? (
        <View accessibilityLiveRegion="polite" style={styles.statusCard}>
          <View style={styles.statusDot} />
          <AppText style={styles.statusText} variant="bodyMedium">
            {message ?? 'A distribuição financeira não está disponível.'}
          </AppText>
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.storeGoal}>
            <View style={styles.storeGoalCopy}>
              <AppText color="textMuted" variant="label">
                Necessidade diária da loja
              </AppText>
              <AppText color="textMuted" variant="caption">
                {formatCentsAsBrl(result.remainingAmountCents)} restantes em {result.remainingDays}{' '}
                {result.remainingDays === 1 ? 'dia' : 'dias'}
              </AppText>
            </View>
            <View style={styles.storeGoalValue}>
              <AppText color="primary" variant="title">
                {formatCentsAsBrl(result.dailyStoreAmountCents)}
              </AppText>
              <AppText color="textMuted" variant="caption">
                por dia
              </AppText>
            </View>
          </View>

          <View>
            {result.employees.map((employee, index) => (
              <View
                key={employee.employeeId}
                style={[styles.employeeRow, index > 0 && styles.employeeRowBorder]}
              >
                <View style={styles.employeeCopy}>
                  <AppText variant="bodyMedium">{employee.employeeName}</AppText>
                  <AppText color="textMuted" variant="caption">
                    {TEAM_ROLE_LABELS[employee.role].singular} · peso{' '}
                    {formatDecimal(employee.weight)}
                  </AppText>
                </View>
                <View style={styles.employeeValues}>
                  <AppText color="primary" variant="bodyMedium">
                    {formatCentsAsBrl(employee.remainingAmountCents)} restantes
                  </AppText>
                  <AppText color="textMuted" style={styles.valueCaption} variant="caption">
                    {formatCentsAsBrl(employee.dailyAmountCents)} / dia
                  </AppText>
                </View>
              </View>
            ))}
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
  employeeCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 128,
  },
  employeeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  employeeRowBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  employeeValues: {
    alignItems: 'flex-end',
    flexShrink: 1,
    gap: spacing.xs,
  },
  heading: {
    gap: spacing.xs,
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
