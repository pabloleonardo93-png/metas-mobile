import { StyleSheet, View } from 'react-native';

import type { Campaign } from '@/features/campaigns/types/campaign.types';
import { StoreCampaignCard } from '@/features/dashboard/components/StoreCampaignCard';
import type { EmployeeCampaignContribution } from '@/features/employees/types/employee.types';
import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

interface EmployeeCampaignsSectionProps {
  campaigns: readonly Campaign[];
  contributions: readonly EmployeeCampaignContribution[];
}

export function EmployeeCampaignsSection({
  campaigns,
  contributions,
}: EmployeeCampaignsSectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title">
          Campanhas em foco
        </AppText>
        <AppText color="textMuted" variant="caption">
          Objetivos coletivos da loja
        </AppText>
      </View>

      {campaigns.length > 0 ? (
        <View style={styles.list}>
          {campaigns.map((campaign) => {
            const contribution = contributions.find((item) => item.campaignId === campaign.id);

            return (
              <StoreCampaignCard
                key={campaign.id}
                campaign={campaign}
                contributedQuantity={contribution?.contributedQuantity}
              />
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <AppText variant="bodyMedium">Nenhuma campanha ativa</AppText>
          <AppText color="textMuted" variant="caption">
            As campanhas em foco da loja aparecerão aqui.
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
