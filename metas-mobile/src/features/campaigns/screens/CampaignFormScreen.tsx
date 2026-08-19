import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { appRoutes } from '@/config/routes';
import { CampaignForm } from '@/features/campaigns/components/CampaignForm';
import { useCampaigns } from '@/features/campaigns/context/CampaignsContext';
import type { CampaignFormValues, CampaignInput } from '@/features/campaigns/types/campaign.types';
import { formatCampaignDate } from '@/features/campaigns/utils/campaignDates';
import { ManagerBottomNavigation } from '@/features/dashboard/components/ManagerBottomNavigation';
import { AppButton, AppScreenHeader, AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';
import { formatCentsForBrlInput } from '@/shared/utils/brlCurrency';

interface CampaignFormScreenProps {
  mode: 'create' | 'edit';
}

const newCampaignInitialValues: CampaignFormValues = {
  endDate: '',
  name: '',
  startDate: '',
  targetAmount: '',
  targetQuantity: '',
};

function getCampaignId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function CampaignFormScreen({ mode }: CampaignFormScreenProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ campaignId?: string | string[] }>();
  const { campaigns, createCampaign, updateCampaign } = useCampaigns();
  const campaignId = getCampaignId(params.campaignId);
  const campaign = campaigns.find((item) => item.id === campaignId);
  const horizontalPadding = Math.max(spacing.md, (width - 680) / 2);
  const initialValues = useMemo<CampaignFormValues>(() => {
    if (mode === 'edit' && campaign) {
      return {
        endDate: formatCampaignDate(campaign.endDate),
        name: campaign.name,
        startDate: formatCampaignDate(campaign.startDate),
        targetAmount: formatCentsForBrlInput(campaign.targetAmountCents),
        targetQuantity: String(campaign.targetQuantity),
      };
    }

    return newCampaignInitialValues;
  }, [campaign, mode]);

  if (mode === 'edit' && !campaign) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={[styles.notFound, { paddingHorizontal: horizontalPadding }]}>
          <AppScreenHeader title="Campanha não encontrada" onBack={() => router.back()} />
          <AppText color="textMuted">Não foi possível abrir esta campanha para edição.</AppText>
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

  function handleSubmit(input: CampaignInput) {
    if (mode === 'edit' && campaign) {
      updateCampaign(campaign.id, input);
      Alert.alert('Campanha atualizada', 'As alterações foram salvas localmente nesta sessão.');
      router.replace(appRoutes.managerCampaignDetails(campaign.id));
      return;
    }

    const newCampaign = createCampaign(input);
    Alert.alert('Campanha criada', 'A campanha foi salva localmente para demonstração.');
    router.replace(appRoutes.managerCampaignDetails(newCampaign.id));
  }

  const title = mode === 'create' ? 'Nova campanha' : 'Editar campanha';
  const subtitle =
    mode === 'create'
      ? 'Defina o produto em foco e a meta em unidades'
      : 'Atualize a meta e o período da campanha';

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AppScreenHeader title={title} subtitle={subtitle} onBack={() => router.back()} />
          <CampaignForm
            initialValues={initialValues}
            submitLabel={mode === 'create' ? 'Criar campanha' : 'Salvar alterações'}
            onSubmit={handleSubmit}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <ManagerBottomNavigation activeTab="campaigns" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  notFound: {
    alignSelf: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    maxWidth: 680,
    width: '100%',
  },
  scrollContent: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.xl,
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
});
