import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { CampaignCard } from '@/features/campaigns/components/CampaignCard';
import { CampaignFilters } from '@/features/campaigns/components/CampaignFilters';
import { CampaignSearch } from '@/features/campaigns/components/CampaignSearch';
import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import type { CampaignFilter } from '@/features/campaigns/types/campaign.types';
import { countActiveCampaigns, filterCampaigns } from '@/features/campaigns/utils/campaign.utils';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { AppIcon, AppScreenHeader, AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

export function CampaignsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { campaigns } = useCampaigns();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CampaignFilter>('ALL');
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);
  const activeCount = useMemo(() => countActiveCampaigns(campaigns), [campaigns]);
  const filteredCampaigns = useMemo(
    () => filterCampaigns(campaigns, search, statusFilter),
    [campaigns, search, statusFilter],
  );
  const activeCountLabel = `${activeCount} ${activeCount === 1 ? 'campanha ativa' : 'campanhas ativas'}`;
  const hasCampaigns = campaigns.length > 0;

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <FlatList
        contentContainerStyle={[styles.listContent, { paddingHorizontal: horizontalPadding }]}
        data={filteredCampaigns}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(campaign) => campaign.id}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <AppIcon color={colors.textMuted} name="target" size={34} />
            <AppText variant="bodyMedium">
              {hasCampaigns ? 'Nenhuma campanha encontrada' : 'Nenhuma campanha cadastrada'}
            </AppText>
            <AppText color="textMuted" style={styles.emptyText} variant="caption">
              {hasCampaigns
                ? 'Ajuste a busca ou selecione outro status.'
                : 'As campanhas reais da loja aparecerão aqui quando a integração estiver disponível.'}
            </AppText>
          </View>
        }
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <AppScreenHeader
              title="Campanhas"
              subtitle="Acompanhe os produtos e marcas em foco da loja."
            />
            <AppText color="textMuted" variant="label">
              {activeCountLabel}
            </AppText>
            <CampaignSearch value={search} onChangeText={setSearch} />
            <CampaignFilters selectedFilter={statusFilter} onSelect={setStatusFilter} />
            <AppText accessibilityRole="header" style={styles.sectionTitle} variant="title">
              Campanhas da loja
            </AppText>
          </View>
        }
        renderItem={({ item }) => (
          <CampaignCard
            campaign={item}
            onPress={() => router.push(appRoutes.managerCampaignDetails(item.id))}
          />
        )}
        showsVerticalScrollIndicator={false}
      />

      <ManagerBottomNavigation activeTab="campaigns" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    maxWidth: 360,
    textAlign: 'center',
  },
  headerContent: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  listContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
  sectionTitle: {
    fontSize: 20,
    letterSpacing: 0,
    lineHeight: 28,
    marginTop: spacing.sm,
  },
  separator: {
    height: spacing.sm,
  },
});
