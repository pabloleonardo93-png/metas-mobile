import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { DailyGoalsResult } from '@/features/metas/components/DailyGoalsResult';
import { GeneralGoalSettingsForm } from '@/features/metas/components/GeneralGoalSettingsForm';
import { TeamDistributionSection } from '@/features/metas/components/TeamDistributionSection';
import { useGoals } from '@/features/metas/context/GoalsContext';
import type {
  GoalConfigurationSaveInput,
  GoalGeneralSettings,
} from '@/features/metas/types/goalSettings.types';
import type { DailyGoalsCalculationResult } from '@/features/metas/types/teamDistribution.types';
import { calculateDailyGoals } from '@/features/metas/utils/calculateDailyGoals';
import { AppButton, AppText, ScreenContainer } from '@/shared/components';
import { colors, spacing } from '@/shared/theme';

export function GeneralGoalSettingsScreen() {
  const {
    configurationVersionKey,
    currentGoal,
    errorMessage,
    isLoading,
    isSaving,
    refreshGoalConfiguration,
    saveGoalConfiguration,
    teamDistribution,
    updateCurrentGoalSettings,
    updateTeamDistribution,
  } = useGoals();
  const [calculationResult, setCalculationResult] = useState<DailyGoalsCalculationResult | null>(
    null,
  );

  function handleSettingsChange(nextSettings: GoalGeneralSettings) {
    updateCurrentGoalSettings(nextSettings);
    setCalculationResult((currentResult) =>
      currentResult ? calculateDailyGoals(nextSettings, teamDistribution) : null,
    );
  }

  function handleTeamChange(nextDistribution: typeof teamDistribution) {
    updateTeamDistribution(nextDistribution);
    setCalculationResult((currentResult) =>
      currentResult ? calculateDailyGoals(currentGoal, nextDistribution) : null,
    );
  }

  function handleCalculate() {
    setCalculationResult(calculateDailyGoals(currentGoal, teamDistribution));
  }

  async function handleSave(
    input: Omit<GoalConfigurationSaveInput, 'teamDistribution'>,
  ): Promise<void> {
    await saveGoalConfiguration({ ...input, teamDistribution });
    setCalculationResult(null);
  }

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={styles.headerAccent} />
              <AppText accessibilityRole="header" style={styles.title} variant="title">
                Configuração Geral
              </AppText>
            </View>

            {isLoading ? (
              <View accessibilityLiveRegion="polite" style={styles.loadingState}>
                <ActivityIndicator color={colors.primary} />
                <AppText color="textMuted">Carregando configuração...</AppText>
              </View>
            ) : errorMessage ? (
              <View style={styles.errorState}>
                <AppText color="error">{errorMessage}</AppText>
                <AppButton
                  label="Tentar novamente"
                  variant="secondary"
                  onPress={() => void refreshGoalConfiguration()}
                />
              </View>
            ) : (
              <>
                <GeneralGoalSettingsForm
                  key={configurationVersionKey}
                  initialValues={currentGoal}
                  isSaving={isSaving}
                  onChange={handleSettingsChange}
                  onSave={handleSave}
                />

                <TeamDistributionSection
                  distribution={teamDistribution}
                  onChange={handleTeamChange}
                />

                <AppButton label="Calcular metas diárias" onPress={handleCalculate} />

                {calculationResult ? <DailyGoalsResult result={calculationResult} /> : null}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    gap: spacing.lg,
    maxWidth: 680,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerAccent: {
    backgroundColor: colors.primary,
    borderRadius: 2,
    height: 28,
    width: 4,
  },
  keyboardView: {
    flex: 1,
  },
  errorState: {
    gap: spacing.md,
  },
  loadingState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.lg,
  },
  title: {
    flex: 1,
  },
});
