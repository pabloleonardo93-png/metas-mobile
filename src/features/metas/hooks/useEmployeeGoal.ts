import { useMemo } from 'react';

import { useGoals } from '@/features/metas/context/GoalsContext';
import { calculateDailyGoals } from '@/features/metas/utils/calculateDailyGoals';
import { getEmployeeGoalByRole } from '@/features/metas/utils/getEmployeeGoalByRole';
import type { UserRole } from '@/shared/types/userRole';

export function useEmployeeGoal(role: UserRole) {
  const { currentGoal, teamDistribution } = useGoals();

  return useMemo(() => {
    const calculationResult = calculateDailyGoals(currentGoal, teamDistribution);
    const employeeGoal = getEmployeeGoalByRole(
      calculationResult,
      role,
      currentGoal.remainingBusinessDays,
    );

    return {
      calculationResult,
      employeeGoal,
    };
  }, [currentGoal, role, teamDistribution]);
}
