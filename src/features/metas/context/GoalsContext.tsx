import { createContext, type PropsWithChildren, useContext, useMemo, useState } from 'react';

import { currentGoalMock } from '@/features/metas/mocks/currentGoal.mock';
import { teamDistributionMock } from '@/features/metas/mocks/teamDistribution.mock';
import type { CurrentGoal, GoalGeneralSettings } from '@/features/metas/types/goalSettings.types';
import type { TeamDistribution } from '@/features/metas/types/teamDistribution.types';

interface GoalsContextValue {
  currentGoal: CurrentGoal;
  teamDistribution: TeamDistribution[];
  updateCurrentGoalSettings: (settings: GoalGeneralSettings) => void;
  updateTeamDistribution: (distribution: TeamDistribution[]) => void;
}

const GoalsContext = createContext<GoalsContextValue | null>(null);

export function GoalsProvider({ children }: PropsWithChildren) {
  const [currentGoal, setCurrentGoal] = useState<CurrentGoal>(() => ({ ...currentGoalMock }));
  const [teamDistribution, setTeamDistribution] = useState<TeamDistribution[]>(() =>
    teamDistributionMock.map((role) => ({ ...role })),
  );

  const value = useMemo<GoalsContextValue>(
    () => ({
      currentGoal,
      teamDistribution,
      updateCurrentGoalSettings: (settings) => {
        setCurrentGoal((goal) => ({ ...goal, ...settings }));
      },
      updateTeamDistribution: (distribution) => {
        setTeamDistribution(distribution.map((role) => ({ ...role })));
      },
    }),
    [currentGoal, teamDistribution],
  );

  return <GoalsContext.Provider value={value}>{children}</GoalsContext.Provider>;
}

export function useGoals(): GoalsContextValue {
  const context = useContext(GoalsContext);

  if (!context) {
    throw new Error('useGoals deve ser usado dentro de GoalsProvider.');
  }

  return context;
}
