import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { CampaignCard } from '@/features/campaigns/components/CampaignCard';
import { CampaignFilters } from '@/features/campaigns/components/CampaignFilters';
import { CampaignSearch } from '@/features/campaigns/components/CampaignSearch';
import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import type { CampaignFilter } from '@/features/campaigns/types/campaign.types';
import { countActiveCampaigns, filterCampaigns } from '@/features/campaigns/utils/campaign.utils';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { AppButton, AppIcon, AppScreenHeader, AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

export function CampaignsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { campaigns, errorMessage, isLoading, refreshCampaigns } = useCampaigns();
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
  const emptyTitle =
    statusFilter === 'ATIVA'
      ? 'Nenhuma campanha ativa'
      : statusFilter === 'AGENDADA'
        ? 'Nenhuma campanha agendada'
        : statusFilter === 'ENCERRADA'
          ? 'Nenhuma campanha encerrada'
          : hasCampaigns
            ? 'Nenhuma campanha encontrada'
            : 'Nenhuma campanha cadastrada';

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
            {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
            {!isLoading ? <AppIcon color={colors.textMuted} name="target" size={34} /> : null}
            <AppText color={errorMessage ? 'error' : undefined} variant="bodyMedium">
              {errorMessage ?? (isLoading ? 'Carregando campanhas...' : emptyTitle)}
            </AppText>
            {!isLoading && !errorMessage ? (
              <AppText color="textMuted" style={styles.emptyText} variant="caption">
                {hasCampaigns
                  ? 'Ajuste a busca ou selecione outro status.'
                  : 'Crie a primeira campanha para acompanhar os objetivos da loja.'}
              </AppText>
            ) : null}
            {errorMessage ? (
              <AppButton
                label="Tentar novamente"
                variant="secondary"
                onPress={() => void refreshCampaigns()}
              />
            ) : null}
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
            <AppButton
              label="Nova campanha"
              leftIcon={<AppIcon color={colors.onPrimary} name="plus" size={20} />}
              onPress={() => router.push(appRoutes.managerNewCampaign)}
            />
            {errorMessage && hasCampaigns ? (
              <View style={styles.inlineError}>
                <AppText color="error" variant="caption">
                  {errorMessage}
                </AppText>
                <AppButton
                  fullWidth={false}
                  label="Tentar novamente"
                  variant="secondary"
                  onPress={() => void refreshCampaigns()}
                />
              </View>
            ) : null}
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
        refreshing={isLoading && hasCampaigns}
        showsVerticalScrollIndicator={false}
        onRefresh={() => void refreshCampaigns()}
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
  inlineError: {
    alignItems: 'flex-start',
    gap: spacing.sm,
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
