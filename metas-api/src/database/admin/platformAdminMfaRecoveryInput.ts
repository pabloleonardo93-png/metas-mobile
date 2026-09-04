import { z } from 'zod';

const inputSchema = z
  .object({
    approvalTtlSeconds: z.coerce.number().int().min(60).max(300).default(300),
    requestId: z.uuid(),
  })
  .strict();

export interface PlatformAdminMfaRecoveryOperationalInput {
  approvalTtlSeconds: number;
  requestId: string;
}

export const parsePlatformAdminMfaRecoveryOperationalInput = (
  environment: NodeJS.ProcessEnv,
): PlatformAdminMfaRecoveryOperationalInput =>
  inputSchema.parse({
    approvalTtlSeconds: environment.PLATFORM_ADMIN_MFA_RECOVERY_APPROVAL_TTL_SECONDS,
    requestId: environment.PLATFORM_ADMIN_MFA_RECOVERY_REQUEST_ID,
  });
