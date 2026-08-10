export interface GoalGeneralSettings {
  monthlyTarget: number;
  remainingBusinessDays: number;
  soldAmount: number;
  totalBusinessDays: number;
}

export type GoalGeneralSettingsErrors = Partial<Record<keyof GoalGeneralSettings, string>>;
