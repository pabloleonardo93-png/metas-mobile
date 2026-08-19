import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { appRoutes } from '@/config/routes';
import { CampaignStatusBadge } from '@/features/campaigns/components/CampaignStatusBadge';
import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import { calculateCampaignMetrics } from '@/features/campaigns/utils/campaign.utils';
import { formatCampaignPeriod } from '@/features/campaigns/utils/campaignDates';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import {
  AppButton,
  AppIcon,
  AppProgressBar,
  AppScreenHeader,
  AppText,
  ScreenContainer,
} from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { formatCentsAsBrl } from '@/shared/utils/brlCurrency';
import { formatPercentage } from '@/shared/utils/formatters';

function getCampaignId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function CampaignDetailsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ campaignId?: string | string[] }>();
  const { campaigns } = useCampaigns();
  const campaignId = getCampaignId(params.campaignId);
  const campaign = campaigns.find((item) => item.id === campaignId);
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);

  if (!campaign) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={[styles.notFound, { paddingHorizontal: horizontalPadding }]}>
          <AppScreenHeader title="Campanha não encontrada" onBack={() => router.back()} />
          <AppText color="textMuted">
            A campanha solicitada não está disponível nesta sessão.
          </AppText>
          <AppButton
            label="Voltar para Campanhas"
            variant="secondary"
            onPress={() => router.replace(appRoutes.managerCampaigns)}
          />
        </View>
        <ManagerBottomNavigation activeTab="campaigns" />
      </ScreenContainer>
    );
  }

  const metrics = calculateCampaignMetrics(campaign);

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <AppScreenHeader title="Detalhes da campanha" onBack={() => router.back()} />

        <View style={styles.hero}>
          <View style={styles.heroHeader}>
            <View style={styles.heroCopy}>
              <AppText accessibilityRole="header" style={styles.name} variant="title">
                {campaign.name}
              </AppText>
              <View style={styles.period}>
                <AppIcon color={colors.textMuted} name="calendar" size={18} />
                <AppText color="textMuted" variant="caption">
                  {formatCampaignPeriod(campaign.startDate, campaign.endDate)}
                </AppText>
              </View>
            </View>
            <CampaignStatusBadge status={campaign.status} />
          </View>

          <View style={styles.metricsGrid}>
            <View style={styles.metric}>
              <AppText color="textMuted" variant="caption">
                Meta
              </AppText>
              <AppText variant="bodyMedium">{metrics.targetQuantity} unidades</AppText>
            </View>
            <View style={styles.metric}>
              <AppText color="textMuted" variant="caption">
                Valor da meta
              </AppText>
              <AppText variant="bodyMedium">{formatCentsAsBrl(campaign.targetAmountCents)}</AppText>
            </View>
            <View style={styles.metric}>
              <AppText color="textMuted" variant="caption">
                Vendidas
              </AppText>
              <AppText variant="bodyMedium">{metrics.soldQuantity}</AppText>
            </View>
            <View style={styles.metric}>
              <AppText color="textMuted" variant="caption">
                Faltam
              </AppText>
              <AppText variant="bodyMedium">{metrics.remainingQuantity}</AppText>
            </View>
            <View style={styles.metric}>
              <AppText color="textMuted" variant="caption">
                Progresso
              </AppText>
              <AppText color="primary" variant="bodyMedium">
                {formatPercentage(metrics.progress, 0)}
              </AppText>
            </View>
          </View>

          <AppProgressBar
            label={`Progresso de ${campaign.name}: ${formatPercentage(metrics.progress, 0)}`}
            progress={metrics.progress}
          />
        </View>

        <View style={styles.actions}>
          <AppButton
            label="Editar campanha"
            leftIcon={<AppIcon color={colors.onPrimary} name="edit" size={20} />}
            onPress={() => router.push(appRoutes.managerEditCampaign(campaign.id))}
          />
        </View>
      </ScrollView>

      <ManagerBottomNavigation activeTab="campaigns" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.sm,
  },
  hero: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.md,
  },
  heroCopy: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 0,
  },
  heroHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  metric: {
    flexBasis: '44%',
    flexGrow: 1,
    gap: spacing.xs,
    minHeight: 64,
  },
  metricsGrid: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    padding: spacing.md,
  },
  name: {
    fontSize: 24,
    letterSpacing: 0,
    lineHeight: 32,
  },
  notFound: {
    alignSelf: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    maxWidth: 680,
    width: '100%',
  },
  period: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
});
