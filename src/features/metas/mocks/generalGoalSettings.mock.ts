import type { GoalGeneralSettings } from '@/features/metas/types/goalSettings.types';

export const generalGoalSettingsMock = {
  monthlyTarget: 500_000,
  remainingBusinessDays: 20,
  totalBusinessDays: 26,
  soldAmount: 120_000,
} satisfies GoalGeneralSettings;
