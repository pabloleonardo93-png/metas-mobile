import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { goalsApi } from '@/features/metas/api/goalsApi';
import { ROLE_WEIGHTS, TEAM_ROLES } from '@/features/metas/config/teamRoles';
import type {
  CurrentGoal,
  GoalConfigurationSaveInput,
  GoalGeneralSettings,
  PersistedGoalConfiguration,
} from '@/features/metas/types/goalSettings.types';
import type { TeamDistribution } from '@/features/metas/types/teamDistribution.types';
import { getGoalLoadErrorMessage } from '@/features/metas/utils/goalApiError';
import { centsToReais } from '@/shared/utils/brlCurrency';
import { calculateMonthDayCounts } from '@/shared/utils/datePeriods';
import { useRealtime } from '@/realtime/RealtimeContext';

interface GoalsContextValue {
  currentGoal: CurrentGoal;
  errorMessage: string | null;
  isLoading: boolean;
  isSaving: boolean;
  refreshGoalConfiguration(): Promise<void>;
  saveGoalConfiguration(input: GoalConfigurationSaveInput): Promise<void>;
  teamDistribution: TeamDistribution[];
  updateCurrentGoalSettings(settings: GoalGeneralSettings): void;
  updateTeamDistribution(distribution: TeamDistribution[]): void;
}

const GoalsContext = createContext<GoalsContextValue | null>(null);

const formatMonth = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  const value = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1)),
  );
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const getCurrentMonth = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const createEmptyCurrentGoal = (): CurrentGoal => {
  const month = getCurrentMonth();
  const dayCounts = calculateMonthDayCounts(month) ?? { remainingDays: 0, totalDays: 0 };
  return {
    id: `goal-draft-${month}`,
    month: formatMonth(month),
    monthlyTarget: 0,
    periodMonth: month,
    remainingBusinessDays: dayCounts.remainingDays,
    soldAmount: 0,
    status: 'EM_ANDAMENTO',
    totalBusinessDays: dayCounts.totalDays,
  };
};

const createEmptyTeamDistribution = (): TeamDistribution[] =>
  TEAM_ROLES.map((role) => ({ quantity: 0, role, weight: ROLE_WEIGHTS[role] }));

export function GoalsProvider({ children }: PropsWithChildren) {
  const { status: authStatus, user } = useAuth();
  const { subscribe } = useRealtime();
  const [currentGoal, setCurrentGoal] = useState<CurrentGoal>(createEmptyCurrentGoal);
  const [teamDistribution, setTeamDistribution] = useState<TeamDistribution[]>(
    createEmptyTeamDistribution,
  );
  const [lockVersion, setLockVersion] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const applyConfiguration = useCallback((configuration: PersistedGoalConfiguration) => {
    const dayCounts = calculateMonthDayCounts(configuration.month) ?? {
      remainingDays: 0,
      totalDays: 0,
    };
    setLockVersion(configuration.lockVersion);
    setCurrentGoal({
      id: configuration.id ?? `goal-draft-${configuration.month}`,
      month: formatMonth(configuration.month),
      monthlyTarget: centsToReais(configuration.monthlyTargetCents),
      periodMonth: configuration.month,
      remainingBusinessDays: dayCounts.remainingDays,
      soldAmount: centsToReais(configuration.soldAmountCents),
      status: 'EM_ANDAMENTO',
      totalBusinessDays: dayCounts.totalDays,
    });
    setTeamDistribution(configuration.teamDistribution.map((role) => ({ ...role })));
  }, []);

  const loadGoalConfiguration = useCallback(
    (showLoading: boolean): Promise<void> => {
      if (loadPromiseRef.current) {
        return loadPromiseRef.current;
      }

      if (showLoading) {
        setIsLoading(true);
      }
      setErrorMessage(null);
      const request = goalsApi
        .getConfiguration()
        .then(applyConfiguration)
        .catch((error: unknown) => setErrorMessage(getGoalLoadErrorMessage(error)))
        .finally(() => {
          setIsLoading(false);
          loadPromiseRef.current = null;
        });
      loadPromiseRef.current = request;
      return request;
    },
    [applyConfiguration],
  );

  const refreshGoalConfiguration = useCallback(
    () => loadGoalConfiguration(true),
    [loadGoalConfiguration],
  );

  useEffect(() => {
    if (authStatus === 'authenticated' && user?.role === 'GESTOR') {
      const timeout = setTimeout(() => void refreshGoalConfiguration(), 0);
      return () => clearTimeout(timeout);
    }

    if (authStatus !== 'restoring') {
      const timeout = setTimeout(() => {
        setCurrentGoal(createEmptyCurrentGoal());
        setTeamDistribution(createEmptyTeamDistribution());
        setLockVersion(null);
        setErrorMessage(null);
      }, 0);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [authStatus, refreshGoalConfiguration, user?.role]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || user?.role !== 'GESTOR') {
      return undefined;
    }
    return subscribe('goal.configuration.changed', () => loadGoalConfiguration(false));
  }, [authStatus, loadGoalConfiguration, subscribe, user?.role]);

  const saveGoalConfiguration = useCallback(
    async (input: GoalConfigurationSaveInput) => {
      if (isSaving) return;
      setIsSaving(true);
      setErrorMessage(null);
      try {
        applyConfiguration(await goalsApi.saveConfiguration(input, lockVersion));
      } finally {
        setIsSaving(false);
      }
    },
    [applyConfiguration, isSaving, lockVersion],
  );

  const value = useMemo<GoalsContextValue>(
    () => ({
      currentGoal,
      errorMessage,
      isLoading,
      isSaving,
      refreshGoalConfiguration,
      saveGoalConfiguration,
      teamDistribution,
      updateCurrentGoalSettings: (settings) => {
        setCurrentGoal((goal) => ({ ...goal, ...settings }));
      },
      updateTeamDistribution: (distribution) => {
        setTeamDistribution(distribution.map((role) => ({ ...role })));
      },
    }),
    [
      currentGoal,
      errorMessage,
      isLoading,
      isSaving,
      refreshGoalConfiguration,
      saveGoalConfiguration,
      teamDistribution,
    ],
  );

  return <GoalsContext.Provider value={value}>{children}</GoalsContext.Provider>;
}

export function useGoals(): GoalsContextValue {
  const context = useContext(GoalsContext);
  if (!context) throw new Error('useGoals deve ser usado dentro de GoalsProvider.');
  return context;
}
