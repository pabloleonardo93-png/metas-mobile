import { z } from 'zod';

const inputSchema = z
  .object({
    approvalTtlSeconds: z.coerce.number().int().min(60).max(300).default(300),
    requestId: z.uuid(),
  })
  .strict();

export interface PlatformAdminFirstEnrollmentOperationalInput {
  approvalTtlSeconds: number;
  requestId: string;
}

export const parsePlatformAdminFirstEnrollmentOperationalInput = (
  environment: NodeJS.ProcessEnv,
): PlatformAdminFirstEnrollmentOperationalInput =>
  inputSchema.parse({
    approvalTtlSeconds: environment.PLATFORM_ADMIN_FIRST_ENROLLMENT_APPROVAL_TTL_SECONDS,
    requestId: environment.PLATFORM_ADMIN_FIRST_ENROLLMENT_REQUEST_ID,
  });
