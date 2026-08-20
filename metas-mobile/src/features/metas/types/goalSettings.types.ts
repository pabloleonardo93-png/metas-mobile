export interface GoalGeneralSettings {
  monthlyTarget: number;
  remainingBusinessDays: number;
  soldAmount: number;
  totalBusinessDays: number;
}

export interface GoalConfigurationSaveInput {
  monthlyTargetCents: number;
  remainingBusinessDays: number;
  soldAmountCents: number;
  teamDistribution: import('./teamDistribution.types').TeamDistribution[];
  totalBusinessDays: number;
}

export interface PersistedGoalConfiguration {
  id: string | null;
  lockVersion: number | null;
  month: string;
  monthlyTargetCents: number;
  remainingBusinessDays: number;
  soldAmountCents: number;
  teamDistribution: import('./teamDistribution.types').TeamDistribution[];
  totalBusinessDays: number;
}

export type GoalStatus = 'CONCLUIDA' | 'EM_ANDAMENTO';

export interface CurrentGoal extends GoalGeneralSettings {
  id: string;
  month: string;
  periodMonth: string;
  status: Extract<GoalStatus, 'EM_ANDAMENTO'>;
}

export interface CurrentGoalMetrics {
  dailyTarget: number;
  progress: number;
  remaining: number;
  remainingBusinessDays: number;
  sold: number;
  target: number;
}

export interface GoalHistoryItem {
  id: string;
  month: string;
  sold: number;
  status: GoalStatus;
  target: number;
}

export type GoalGeneralSettingsErrors = Partial<Record<keyof GoalGeneralSettings, string>>;
