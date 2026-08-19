import type {
  GoalConfigurationSaveInput,
  PersistedGoalConfiguration,
} from '@/features/metas/types/goalSettings.types';
import type { TeamRole } from '@/features/metas/types/teamDistribution.types';

interface GoalRoleApiResponse {
  employeeCountSnapshot: number;
  role: TeamRole;
  weight: string;
}

interface GoalConfigurationApiResponse {
  id: string | null;
  lockVersion: number | null;
  month: string;
  monthlyTargetCents: string;
  remainingBusinessDays: number;
  roles: GoalRoleApiResponse[];
  soldAmountCents: string;
  totalBusinessDays: number;
}

interface GoalApiRequestOptions {
  body?: unknown;
  method?: 'GET' | 'PUT';
  sessionToken?: string;
}

export interface GoalApiRequest {
  <Result>(path: string, options?: GoalApiRequestOptions): Promise<Result>;
}

export interface GoalSessionStorage {
  getToken(): Promise<string | null>;
}

export class GoalSessionUnavailableError extends Error {
  constructor() {
    super('Authenticated session is unavailable');
    this.name = 'GoalSessionUnavailableError';
  }
}

const parseCents = (value: string): number => {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Invalid cents response');
  }
  const cents = Number(value);
  if (!Number.isSafeInteger(cents)) {
    throw new Error('Unsafe cents response');
  }
  return cents;
};

const toConfiguration = (response: GoalConfigurationApiResponse): PersistedGoalConfiguration => ({
  id: response.id,
  lockVersion: response.lockVersion,
  month: response.month,
  monthlyTargetCents: parseCents(response.monthlyTargetCents),
  remainingBusinessDays: response.remainingBusinessDays,
  soldAmountCents: parseCents(response.soldAmountCents),
  teamDistribution: response.roles.map(({ employeeCountSnapshot, role, weight }) => ({
    quantity: employeeCountSnapshot,
    role,
    weight: Number(weight),
  })),
  totalBusinessDays: response.totalBusinessDays,
});

export class GoalConfigurationApiClient {
  constructor(
    private readonly request: GoalApiRequest,
    private readonly storage: GoalSessionStorage,
  ) {}

  async getConfiguration(): Promise<PersistedGoalConfiguration> {
    const sessionToken = await this.requireToken();
    return toConfiguration(
      await this.request<GoalConfigurationApiResponse>('/v1/manager/goals/configuration', {
        sessionToken,
      }),
    );
  }

  async saveConfiguration(
    input: GoalConfigurationSaveInput,
    expectedLockVersion: number | null,
  ): Promise<PersistedGoalConfiguration> {
    const sessionToken = await this.requireToken();
    return toConfiguration(
      await this.request<GoalConfigurationApiResponse>('/v1/manager/goals/configuration', {
        body: {
          expectedLockVersion,
          monthlyTargetCents: String(input.monthlyTargetCents),
          remainingBusinessDays: input.remainingBusinessDays,
          roleWeights: input.teamDistribution.map(({ role, weight }) => ({
            role,
            weight: String(weight),
          })),
          soldAmountCents: String(input.soldAmountCents),
          totalBusinessDays: input.totalBusinessDays,
        },
        method: 'PUT',
        sessionToken,
      }),
    );
  }

  private async requireToken(): Promise<string> {
    const sessionToken = await this.storage.getToken();
    if (!sessionToken) throw new GoalSessionUnavailableError();
    return sessionToken;
  }
}
