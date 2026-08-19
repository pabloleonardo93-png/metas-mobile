import type { AuthenticatedSession } from '../auth/auth.types.js';

export type GoalRole = 'BALCONISTA' | 'CAIXA' | 'FARMACEUTICO';

export interface GoalRoleConfigurationDto {
  employeeCountSnapshot: number;
  role: GoalRole;
  weight: string;
}

export interface ManagerGoalConfigurationDto {
  id: string | null;
  lockVersion: number | null;
  month: string;
  monthlyTargetCents: string;
  remainingBusinessDays: number;
  roles: GoalRoleConfigurationDto[];
  soldAmountCents: string;
  totalBusinessDays: number;
}

export interface GoalRoleWeightInput {
  role: GoalRole;
  weight: string;
}

export interface SaveManagerGoalConfigurationInput {
  expectedLockVersion: number | null;
  monthlyTargetCents: string;
  remainingBusinessDays: number;
  roleWeights: GoalRoleWeightInput[];
  soldAmountCents: string;
  totalBusinessDays: number;
}

export interface GoalService {
  getConfiguration(session: AuthenticatedSession): Promise<ManagerGoalConfigurationDto>;
  saveConfiguration(
    session: AuthenticatedSession,
    input: SaveManagerGoalConfigurationInput,
  ): Promise<ManagerGoalConfigurationDto>;
}
