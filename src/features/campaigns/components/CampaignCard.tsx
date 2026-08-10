import { Pressable, StyleSheet, View } from 'react-native';

import { CampaignStatusBadge } from '@/features/campaigns/components/CampaignStatusBadge';
import type { Campaign } from '@/features/campaigns/types/campaign.types';
import { calculateCampaignMetrics } from '@/features/campaigns/utils/campaign.utils';
import { formatCampaignPeriod } from '@/features/campaigns/utils/campaignDates';
import { AppIcon, AppProgressBar, AppText } from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { formatPercentage } from '@/shared/utils/formatters';

interface CampaignCardProps {
  campaign: Campaign;
  onPress: () => void;
}

export function CampaignCard({ campaign, onPress }: CampaignCardProps) {
  const metrics = calculateCampaignMetrics(campaign);
  const remainingLabel =
    metrics.remainingQuantity === 0
      ? 'Meta em unidades atingida'
      : `Faltam ${metrics.remainingQuantity} ${metrics.remainingQuantity === 1 ? 'unidade' : 'unidades'}`;

  return (
    <Pressable
      accessibilityLabel={`Abrir campanha ${campaign.name}`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.header}>
        <AppText numberOfLines={2} style={styles.name} variant="bodyMedium">
          {campaign.name}
        </AppText>
        <CampaignStatusBadge status={campaign.status} />
      </View>

      <View style={styles.progressHeader}>
        <AppText color="textMuted" variant="caption">
          {metrics.soldQuantity} de {metrics.targetQuantity} unidades
        </AppText>
        <AppText color="primary" variant="bodyMedium">
          {formatPercentage(metrics.progress, 0)}
        </AppText>
      </View>

      <AppProgressBar
        label={`Progresso de ${campaign.name}: ${formatPercentage(metrics.progress, 0)}`}
        progress={metrics.progress}
      />

      <View style={styles.footer}>
        <View style={styles.footerCopy}>
          <AppText color="textMuted" variant="caption">
            {remainingLabel}
          </AppText>
          <View style={styles.period}>
            <AppIcon color={colors.textMuted} name="calendar" size={16} />
            <AppText color="textMuted" variant="caption">
              {formatCampaignPeriod(campaign.startDate, campaign.endDate)}
            </AppText>
          </View>
        </View>
        <AppIcon color={colors.textMuted} name="chevron-right" size={22} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  cardPressed: {
    backgroundColor: colors.primarySubtle,
    opacity: 0.84,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  footerCopy: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 0,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  period: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  progressHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
});
