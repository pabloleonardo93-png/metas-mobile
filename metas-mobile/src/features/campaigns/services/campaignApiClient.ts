import type {
  Campaign,
  CampaignInput,
  CampaignProgressEntry,
  CampaignProgressInput,
  CampaignProgressResult,
  CampaignStatus,
} from '@/features/campaigns/types/campaign.types';

interface CampaignApiResponse {
  createdAt: string;
  endDate: string;
  id: string;
  lockVersion: number;
  name: string;
  soldAmountCents: string;
  soldQuantity: number | null;
  startDate: string;
  status: CampaignStatus;
  targetAmountCents: string;
  targetQuantity: number | null;
  updatedAt: string;
}

interface CampaignProgressApiResponse {
  amountCents: string;
  campaignId: string;
  createdAt: string;
  createdByName: string;
  createdByUserId: string;
  id: string;
  quantity: number | null;
}

interface CampaignProgressResultApiResponse {
  campaign: CampaignApiResponse;
  entry: CampaignProgressApiResponse;
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
  const soldAmountCents = Number(response.soldAmountCents);
  const targetAmountCents = Number(response.targetAmountCents);
  if (
    !Number.isSafeInteger(soldAmountCents) ||
    soldAmountCents < 0 ||
    !Number.isSafeInteger(targetAmountCents) ||
    targetAmountCents <= 0
  ) {
    throw new InvalidCampaignResponseError();
  }

  return { ...response, soldAmountCents, targetAmountCents };
};

const toProgressEntry = (response: CampaignProgressApiResponse): CampaignProgressEntry => {
  const amountCents = Number(response.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new InvalidCampaignResponseError();
  }
  return { ...response, amountCents };
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

  async createProgress(
    campaignId: string,
    input: CampaignProgressInput,
  ): Promise<CampaignProgressResult> {
    const sessionToken = await this.requireToken();
    const result = await this.request<CampaignProgressResultApiResponse>(
      `/v1/manager/campaigns/${campaignId}/progress`,
      {
        body: { amountCents: String(input.amountCents), quantity: input.quantity },
        method: 'POST',
        sessionToken,
      },
    );
    return { campaign: toCampaign(result.campaign), entry: toProgressEntry(result.entry) };
  }

  async listProgress(campaignId: string): Promise<CampaignProgressEntry[]> {
    const sessionToken = await this.requireToken();
    const entries = await this.request<CampaignProgressApiResponse[]>(
      `/v1/manager/campaigns/${campaignId}/progress`,
      { sessionToken },
    );
    return entries.map(toProgressEntry);
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
