import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { CAMPAIGN_STATUS_LABELS } from '@/features/campaigns/config/campaignStatus';
import type { CampaignFilter } from '@/features/campaigns/types/campaign.types';
import { AppText } from '@/shared/components';
import { colors, radius, spacing } from '@/shared/theme';

interface CampaignFiltersProps {
  selectedFilter: CampaignFilter;
  onSelect: (filter: CampaignFilter) => void;
}

const FILTERS: readonly { label: string; value: CampaignFilter }[] = [
  { label: 'Todas', value: 'ALL' },
  { label: `${CAMPAIGN_STATUS_LABELS.ATIVA}s`, value: 'ATIVA' },
  { label: `${CAMPAIGN_STATUS_LABELS.AGENDADA}s`, value: 'AGENDADA' },
  { label: `${CAMPAIGN_STATUS_LABELS.ENCERRADA}s`, value: 'ENCERRADA' },
];

export function CampaignFilters({ onSelect, selectedFilter }: CampaignFiltersProps) {
  return (
    <ScrollView
      horizontal
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator={false}
    >
      {FILTERS.map((filter) => {
        const isSelected = filter.value === selectedFilter;

        return (
          <Pressable
            key={filter.value}
            accessibilityLabel={filter.label}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            style={({ pressed }) => [
              styles.filter,
              isSelected && styles.filterSelected,
              pressed && styles.filterPressed,
            ]}
            onPress={() => onSelect(filter.value)}
          >
            <AppText color={isSelected ? 'onPrimary' : 'textMuted'} variant="label">
              {filter.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  filter: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  filterPressed: {
    opacity: 0.72,
  },
  filterSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
