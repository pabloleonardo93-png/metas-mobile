import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { goalsApi } from '@/features/metas/api/goalsApi';
import { currentGoalMock } from '@/features/metas/mocks/currentGoal.mock';
import { teamDistributionMock } from '@/features/metas/mocks/teamDistribution.mock';
import type {
  CurrentGoal,
  GoalConfigurationSaveInput,
  GoalGeneralSettings,
  PersistedGoalConfiguration,
} from '@/features/metas/types/goalSettings.types';
import type { TeamDistribution } from '@/features/metas/types/teamDistribution.types';
import { getGoalLoadErrorMessage } from '@/features/metas/utils/goalApiError';
import { centsToReais } from '@/shared/utils/brlCurrency';

interface GoalsContextValue {
  configurationVersionKey: string;
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

export function GoalsProvider({ children }: PropsWithChildren) {
  const { status: authStatus, user } = useAuth();
  const [currentGoal, setCurrentGoal] = useState<CurrentGoal>(() => ({ ...currentGoalMock }));
  const [teamDistribution, setTeamDistribution] = useState<TeamDistribution[]>(() =>
    teamDistributionMock.map((role) => ({ ...role })),
  );
  const [configurationId, setConfigurationId] = useState<string | null>(null);
  const [lockVersion, setLockVersion] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const applyConfiguration = useCallback((configuration: PersistedGoalConfiguration) => {
    setConfigurationId(configuration.id);
    setLockVersion(configuration.lockVersion);
    setCurrentGoal({
      id: configuration.id ?? `goal-draft-${configuration.month}`,
      month: formatMonth(configuration.month),
      monthlyTarget: centsToReais(configuration.monthlyTargetCents),
      remainingBusinessDays: configuration.remainingBusinessDays,
      soldAmount: centsToReais(configuration.soldAmountCents),
      status: 'EM_ANDAMENTO',
      totalBusinessDays: configuration.totalBusinessDays,
    });
    setTeamDistribution(configuration.teamDistribution.map((role) => ({ ...role })));
  }, []);

  const refreshGoalConfiguration = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      applyConfiguration(await goalsApi.getConfiguration());
    } catch (error: unknown) {
      setErrorMessage(getGoalLoadErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [applyConfiguration]);

  useEffect(() => {
    if (authStatus === 'authenticated' && user?.role === 'GESTOR') {
      const timeout = setTimeout(() => void refreshGoalConfiguration(), 0);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [authStatus, refreshGoalConfiguration, user?.role]);

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
      configurationVersionKey: `${configurationId ?? 'draft'}:${lockVersion ?? 0}`,
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
      configurationId,
      currentGoal,
      errorMessage,
      isLoading,
      isSaving,
      lockVersion,
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
