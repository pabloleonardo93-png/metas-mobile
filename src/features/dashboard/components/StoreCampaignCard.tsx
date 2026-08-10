import { StyleSheet, View } from 'react-native';

import type { Campaign } from '@/features/campaigns/types/campaign.types';
import { calculateCampaignMetrics } from '@/features/campaigns/utils/campaign.utils';
import { GoalProgressBar } from '@/features/dashboard/components/GoalProgressBar';
import { formatPercentage } from '@/features/dashboard/utils/formatters';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface StoreCampaignCardProps {
  campaign: Campaign;
}

export function StoreCampaignCard({ campaign }: StoreCampaignCardProps) {
  const metrics = calculateCampaignMetrics(campaign);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.campaignCopy}>
          <AppText numberOfLines={2} variant="bodyMedium">
            {campaign.name}
          </AppText>
          <AppText color="textMuted" variant="caption">
            {metrics.soldQuantity} / {metrics.targetQuantity} unidades da loja
          </AppText>
        </View>
        <AppText color="primary" variant="bodyMedium">
          {formatPercentage(metrics.progress, 0)}
        </AppText>
      </View>

      <GoalProgressBar
        label={`Progresso geral da campanha ${campaign.name}: ${formatPercentage(metrics.progress, 0)}`}
        progress={metrics.progress}
      />

      <AppText color="textMuted" variant="caption">
        Objetivo coletivo da loja
      </AppText>
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
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
});
