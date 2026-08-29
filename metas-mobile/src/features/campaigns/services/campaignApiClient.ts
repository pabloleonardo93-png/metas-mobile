import type {
  Campaign,
  CampaignInput,
  CampaignStatus,
} from '@/features/campaigns/types/campaign.types';

interface CampaignApiResponse {
  createdAt: string;
  endDate: string;
  id: string;
  lockVersion: number;
  name: string;
  soldQuantity: number;
  startDate: string;
  status: CampaignStatus;
  targetAmountCents: string;
  targetQuantity: number | null;
  updatedAt: string;
}

interface CampaignApiRequestOptions {
  body?: unknown;
  method?: 'GET' | 'PATCH' | 'POST';
  sessionToken?: string;
}

export interface CampaignApiRequest {
  <Result>(path: string, options?: CampaignApiRequestOptions): Promise<Result>;
}

export interface CampaignSessionStorage {
  getToken(): Promise<string | null>;
}

export class CampaignSessionUnavailableError extends Error {
  constructor() {
    super('Authenticated session is unavailable');
    this.name = 'CampaignSessionUnavailableError';
  }
}

export class InvalidCampaignResponseError extends Error {
  constructor() {
    super('Campaign API returned invalid money');
    this.name = 'InvalidCampaignResponseError';
  }
}

const toCampaign = (response: CampaignApiResponse): Campaign => {
  const targetAmountCents = Number(response.targetAmountCents);
  if (!Number.isSafeInteger(targetAmountCents) || targetAmountCents <= 0) {
    throw new InvalidCampaignResponseError();
  }

  return { ...response, targetAmountCents };
};

const toRequest = (input: CampaignInput) => ({
  ...input,
  targetAmountCents: String(input.targetAmountCents),
});

export class CampaignApiClient {
  constructor(
    private readonly request: CampaignApiRequest,
    private readonly storage: CampaignSessionStorage,
  ) {}

  async list(isManager: boolean): Promise<Campaign[]> {
    const sessionToken = await this.requireToken();
    const path = isManager ? '/v1/manager/campaigns' : '/v1/campaigns';
    const campaigns = await this.request<CampaignApiResponse[]>(path, { sessionToken });
    return campaigns.map(toCampaign);
  }

  async create(input: CampaignInput): Promise<Campaign> {
    const sessionToken = await this.requireToken();
    return toCampaign(
      await this.request<CampaignApiResponse>('/v1/manager/campaigns', {
        body: toRequest(input),
        method: 'POST',
        sessionToken,
      }),
    );
  }

  async update(campaign: Campaign, input: CampaignInput): Promise<Campaign> {
    const sessionToken = await this.requireToken();
    return toCampaign(
      await this.request<CampaignApiResponse>(`/v1/manager/campaigns/${campaign.id}`, {
        body: { ...toRequest(input), expectedLockVersion: campaign.lockVersion },
        method: 'PATCH',
        sessionToken,
      }),
    );
  }

  async close(campaign: Campaign): Promise<Campaign> {
    const sessionToken = await this.requireToken();
    return toCampaign(
      await this.request<CampaignApiResponse>(`/v1/manager/campaigns/${campaign.id}/close`, {
        body: { expectedLockVersion: campaign.lockVersion },
        method: 'PATCH',
        sessionToken,
      }),
    );
  }

  private async requireToken(): Promise<string> {
    const token = await this.storage.getToken();
    if (!token) {
      throw new CampaignSessionUnavailableError();
    }
    return token;
  }
}
