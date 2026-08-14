import type {
  DailyGoalsCalculationResult,
  EmployeeFinancialGoal,
} from '@/features/metas/types/teamDistribution.types';
import type { EmployeeRole, UserRole } from '@/shared/types/userRole';

function isEmployeeRole(role: UserRole): role is EmployeeRole {
  return role !== 'GESTOR';
}

export function getEmployeeGoalByRole(
  result: DailyGoalsCalculationResult,
  role: UserRole,
  remainingBusinessDays: number,
): EmployeeFinancialGoal | null {
  if (
    result.status !== 'success' ||
    !isEmployeeRole(role) ||
    !Number.isInteger(remainingBusinessDays) ||
    remainingBusinessDays <= 0
  ) {
    return null;
  }

  const roleGoal = result.roles.find((item) => item.role === role);

  if (!roleGoal || roleGoal.quantity <= 0 || roleGoal.weight <= 0) {
    return null;
  }

  const dailyGoal = roleGoal.dailyGoalPerEmployee;
  const remainingPeriodGoal = dailyGoal * remainingBusinessDays;

  if (
    !Number.isFinite(dailyGoal) ||
    dailyGoal < 0 ||
    !Number.isFinite(remainingPeriodGoal) ||
    remainingPeriodGoal < 0
  ) {
    return null;
  }

  return {
    dailyGoal,
    remainingBusinessDays,
    remainingPeriodGoal,
    role,
  };
}
