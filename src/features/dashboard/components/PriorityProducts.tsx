import { StyleSheet, View } from 'react-native';

import type { Campaign } from '@/features/campaigns/types/campaign.types';
import { calculateCampaignMetrics } from '@/features/campaigns/utils/campaign.utils';
import { DashboardSectionHeader } from '@/features/dashboard/components/DashboardSectionHeader';
import { GoalProgressBar } from '@/features/dashboard/components/GoalProgressBar';
import { formatPercentage } from '@/features/dashboard/utils/formatters';
import { AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';

interface PriorityProductsProps {
  campaigns: readonly Campaign[];
  onSeeAll: () => void;
}

export function PriorityProducts({ campaigns, onSeeAll }: PriorityProductsProps) {
  return (
    <View style={styles.section}>
      <DashboardSectionHeader
        actionLabel="Ver todos"
        title="Campanhas em destaque"
        onAction={onSeeAll}
      />

      <View style={styles.card}>
        {campaigns.map((campaign, index) => {
          const metrics = calculateCampaignMetrics(campaign);

          return (
            <View key={campaign.id} style={[styles.row, index > 0 && styles.rowWithDivider]}>
              <View style={styles.rowHeader}>
                <View style={styles.copy}>
                  <AppText numberOfLines={2} variant="bodyMedium">
                    {campaign.name}
                  </AppText>
                  <AppText color="textMuted" variant="caption">
                    {metrics.soldQuantity} / {metrics.targetQuantity} unidades
                  </AppText>
                </View>
                <AppText color="primary" variant="bodyMedium">
                  {formatPercentage(metrics.progress, 0)}
                </AppText>
              </View>

              <GoalProgressBar
                label={`Progresso de ${campaign.name}: ${formatPercentage(metrics.progress, 0)}`}
                progress={metrics.progress}
              />
            </View>
          );
        })}
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
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  row: {
    gap: spacing.md,
    padding: spacing.md,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  rowWithDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  section: {
    gap: spacing.md,
  },
});
