import { StyleSheet, View } from 'react-native';

import type { Campaign } from '@/features/campaigns/types/campaign.types';
import { StoreCampaignCard } from '@/features/dashboard/components/StoreCampaignCard';
import type { EmployeeCampaignContribution } from '@/features/employees/types/employee.types';
import { resolveCampaignContributions } from '@/features/results/utils/resolveCampaignContributions';
import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

interface CampaignContributionsSectionProps {
  campaigns: readonly Campaign[];
  contributions: readonly EmployeeCampaignContribution[];
}

export function CampaignContributionsSection({
  campaigns,
  contributions,
}: CampaignContributionsSectionProps) {
  const resolvedContributions = resolveCampaignContributions(campaigns, contributions);

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title">
          Contribuição em campanhas
        </AppText>
        <AppText color="textMuted" variant="caption">
          Unidades vendidas por você em objetivos coletivos
        </AppText>
      </View>

      {resolvedContributions.length > 0 ? (
        <View style={styles.list}>
          {resolvedContributions.map(({ campaign, contributedQuantity }) => (
            <StoreCampaignCard
              key={campaign.id}
              campaign={campaign}
              contributedQuantity={contributedQuantity}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <AppText variant="bodyMedium">Nenhuma contribuição em campanhas ainda</AppText>
          <AppText color="textMuted" variant="caption">
            As unidades registradas pelo funcionário aparecerão aqui.
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  heading: {
    gap: spacing.xs,
  },
  list: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
});
