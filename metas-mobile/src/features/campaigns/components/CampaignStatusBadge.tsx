import { StyleSheet, View } from 'react-native';

import { CAMPAIGN_STATUS_LABELS } from '@/features/campaigns/config/campaignStatus';
import type { CampaignStatus } from '@/features/campaigns/types/campaign.types';
import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

interface CampaignStatusBadgeProps {
  status: CampaignStatus;
}

export function CampaignStatusBadge({ status }: CampaignStatusBadgeProps) {
  const isActive = status === 'ATIVA';
  const isScheduled = status === 'AGENDADA';

  return (
    <View
      style={[
        styles.badge,
        isActive ? styles.activeBadge : isScheduled ? styles.scheduledBadge : styles.endedBadge,
      ]}
    >
      <View
        style={[
          styles.dot,
          isActive ? styles.activeDot : isScheduled ? styles.scheduledDot : styles.endedDot,
        ]}
      />
      <AppText
        color={isActive ? 'success' : isScheduled ? 'primary' : 'textMuted'}
        style={styles.label}
        variant="caption"
      >
        {CAMPAIGN_STATUS_LABELS[status]}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  activeBadge: {
    backgroundColor: colors.successSubtle,
  },
  activeDot: {
    backgroundColor: colors.success,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dot: {
    borderRadius: radius.pill,
    height: 6,
    width: 6,
  },
  endedBadge: {
    backgroundColor: colors.background,
  },
  endedDot: {
    backgroundColor: colors.textMuted,
  },
  label: {
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 16,
  },
  scheduledBadge: {
    backgroundColor: colors.primarySubtle,
  },
  scheduledDot: {
    backgroundColor: colors.primary,
  },
});
