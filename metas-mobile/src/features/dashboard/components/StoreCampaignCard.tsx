import { StyleSheet, View } from 'react-native';

import type { Campaign } from '@/features/campaigns/types/campaign.types';
import { calculateCampaignMetrics } from '@/features/campaigns/utils/campaign.utils';
import { formatCampaignDaySummary } from '@/features/campaigns/utils/campaignDates';
import { GoalProgressBar } from '@/features/dashboard/components/GoalProgressBar';
import { formatPercentage } from '@/features/dashboard/utils/formatters';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { formatCentsAsBrl } from '@/shared/utils/brlCurrency';

interface StoreCampaignCardProps {
  campaign: Campaign;
  contributedQuantity?: number;
}

export function StoreCampaignCard({ campaign, contributedQuantity }: StoreCampaignCardProps) {
  const metrics = calculateCampaignMetrics(campaign);
  const daySummary = formatCampaignDaySummary(campaign.startDate, campaign.endDate);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.campaignCopy}>
          <AppText numberOfLines={2} variant="bodyMedium">
            {campaign.name}
          </AppText>
          <AppText color="textMuted" variant="caption">
            {formatCentsAsBrl(metrics.soldAmountCents)} de{' '}
            {formatCentsAsBrl(metrics.targetAmountCents)}
          </AppText>
          <AppText color="textMuted" variant="caption">
            {metrics.quantity
              ? `${metrics.quantity.soldQuantity} / ${metrics.quantity.targetQuantity} unidades da loja`
              : 'Sem controle por quantidade'}
          </AppText>
        </View>
        <AppText color="primary" variant="bodyMedium">
          {formatPercentage(metrics.financialProgress, 0)}
        </AppText>
      </View>

      <GoalProgressBar
        label={`Progresso financeiro da campanha ${campaign.name}: ${formatPercentage(metrics.financialProgress, 0)}`}
        progress={metrics.financialProgress}
      />

      <AppText color="textMuted" variant="caption">
        Objetivo coletivo da loja
      </AppText>
      {daySummary ? (
        <AppText color="textMuted" variant="caption">
          {daySummary}
        </AppText>
      ) : null}

      {metrics.quantity && contributedQuantity !== undefined ? (
        <View style={styles.contribution}>
          <AppText color="textMuted" variant="caption">
            Sua contribuição
          </AppText>
          <AppText color="primary" variant="bodyMedium">
            {contributedQuantity} {contributedQuantity === 1 ? 'unidade' : 'unidades'}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  campaignCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  card: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  contribution: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
});
