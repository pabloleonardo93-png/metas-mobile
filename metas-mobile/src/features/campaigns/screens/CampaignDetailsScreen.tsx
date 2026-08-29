import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { appRoutes } from '@/config/routes';
import { CampaignDailyDistribution } from '@/features/campaigns/components/CampaignDailyDistribution';
import { CampaignStatusBadge } from '@/features/campaigns/components/CampaignStatusBadge';
import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import type { Campaign } from '@/features/campaigns/types/campaign.types';
import { getCampaignApiErrorMessage } from '@/features/campaigns/utils/campaignApiError';
import { calculateCampaignMetrics } from '@/features/campaigns/utils/campaign.utils';
import { calculateCampaignDailyDistribution } from '@/features/campaigns/utils/calculateCampaignDistribution';
import { formatCampaignPeriod } from '@/features/campaigns/utils/campaignDates';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { useEmployees } from '@/features/employees/context/EmployeesContext';
import { useGoals } from '@/features/metas/context/GoalsContext';
import {
  AppButton,
  AppIcon,
  AppProgressBar,
  AppScreenHeader,
  AppText,
  ScreenContainer,
} from '@/shared/components';
import { colors, radius, shadows, spacing } from '@/shared/theme';
import { useToast } from '@/shared/toast/ToastContext';
import { formatCentsAsBrl } from '@/shared/utils/brlCurrency';
import { formatPercentage } from '@/shared/utils/formatters';
import { calculatePeriodDayCounts } from '@/shared/utils/datePeriods';

function getCampaignId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function getNextLocalDayDelay(now: Date): number {
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 1, 0);
  return Math.max(nextDay.getTime() - now.getTime(), 1_000);
}

export function CampaignDetailsScreen() {
  const { hideToast, showToast } = useToast();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ campaignId?: string | string[] }>();
  const { campaigns, closeCampaign, errorMessage, isLoading, refreshCampaigns } = useCampaigns();
  const {
    employees,
    errorMessage: employeesErrorMessage,
    isLoading: isLoadingEmployees,
  } = useEmployees();
  const {
    errorMessage: goalsErrorMessage,
    isLoading: isLoadingGoals,
    teamDistribution,
  } = useGoals();
  const [isClosing, setIsClosing] = useState(false);
  const [calculationDate, setCalculationDate] = useState(() => new Date());
  const campaignId = getCampaignId(params.campaignId);
  const campaign = campaigns.find((item) => item.id === campaignId);
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);
  const dailyDistribution = useMemo(
    () =>
      campaign
        ? calculateCampaignDailyDistribution(
            campaign,
            employees,
            teamDistribution,
            calculationDate,
          )
        : null,
    [calculationDate, campaign, employees, teamDistribution],
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setCalculationDate(new Date());
      void refreshCampaigns();
    }, getNextLocalDayDelay(calculationDate));

    return () => clearTimeout(timeout);
  }, [calculationDate, refreshCampaigns]);

  if (isLoading || errorMessage) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={[styles.notFound, { paddingHorizontal: horizontalPadding }]}>
          <AppScreenHeader title="Detalhes da campanha" onBack={() => router.back()} />
          {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {errorMessage ? <AppText color="error">{errorMessage}</AppText> : null}
          {errorMessage ? (
            <AppButton label="Tentar novamente" onPress={() => void refreshCampaigns()} />
          ) : null}
        </View>
        <ManagerBottomNavigation activeTab="campaigns" />
      </ScreenContainer>
    );
  }

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
  const dayCounts = calculatePeriodDayCounts(campaign.startDate, campaign.endDate);

  function handleClose(campaignToClose: Campaign) {
    Alert.alert('Encerrar campanha', 'Esta ação encerra a campanha para toda a loja.', [
      { style: 'cancel', text: 'Cancelar' },
      {
        style: 'destructive',
        text: 'Encerrar',
        onPress: () => {
          hideToast();
          setIsClosing(true);
          void closeCampaign(campaignToClose)
            .then(() => {
              showToast({ message: 'Campanha encerrada com sucesso.', type: 'success' });
            })
            .catch((error: unknown) => {
              showToast({ message: getCampaignApiErrorMessage(error), type: 'error' });
            })
            .finally(() => setIsClosing(false));
        },
      },
    ]);
  }

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
            {metrics ? (
              <View style={styles.metric}>
                <AppText color="textMuted" variant="caption">
                  Meta
                </AppText>
                <AppText variant="bodyMedium">{metrics.targetQuantity} unidades</AppText>
              </View>
            ) : null}
            <View style={styles.metric}>
              <AppText color="textMuted" variant="caption">
                Valor da meta
              </AppText>
              <AppText variant="bodyMedium">{formatCentsAsBrl(campaign.targetAmountCents)}</AppText>
            </View>
            {metrics ? (
              <>
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
              </>
            ) : (
              <View style={styles.metric}>
                <AppText color="textMuted" variant="caption">
                  Quantidade
                </AppText>
                <AppText variant="bodyMedium">Sem controle</AppText>
              </View>
            )}
            <View style={styles.metric}>
              <AppText color="textMuted" variant="caption">
                Dias da campanha
              </AppText>
              <AppText variant="bodyMedium">{dayCounts?.totalDays ?? '--'}</AppText>
            </View>
            <View style={styles.metric}>
              <AppText color="textMuted" variant="caption">
                Dias restantes
              </AppText>
              <AppText variant="bodyMedium">{dayCounts?.remainingDays ?? '--'}</AppText>
            </View>
          </View>

          {metrics ? (
            <AppProgressBar
              label={`Progresso de ${campaign.name}: ${formatPercentage(metrics.progress, 0)}`}
              progress={metrics.progress}
            />
          ) : null}
        </View>

        {dailyDistribution ? (
          <CampaignDailyDistribution
            result={dailyDistribution}
            statusMessage={
              isLoadingEmployees || isLoadingGoals
                ? 'Carregando equipe e pesos da meta...'
                : employeesErrorMessage || goalsErrorMessage
                  ? 'Não foi possível carregar a equipe e os pesos da meta.'
                  : undefined
            }
          />
        ) : null}

        {campaign.status !== 'ENCERRADA' ? (
          <View style={styles.actions}>
            <AppButton
              label="Editar campanha"
              leftIcon={<AppIcon color={colors.onPrimary} name="edit" size={20} />}
              onPress={() => router.push(appRoutes.managerEditCampaign(campaign.id))}
            />
            <AppButton
              label="Encerrar campanha"
              loading={isClosing}
              variant="secondary"
              onPress={() => handleClose(campaign)}
            />
          </View>
        ) : null}
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
