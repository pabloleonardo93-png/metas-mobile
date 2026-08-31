import { z } from 'zod';

const bootstrapInputSchema = z
  .object({
    displayName: z.string().trim().min(2).max(160),
    googleSubject: z.string().min(1).max(255),
    primaryEmail: z
      .email()
      .max(320)
      .transform((email) => email.trim().toLowerCase()),
  })
  .strict();

export interface PlatformAdminBootstrapInput {
  displayName: string;
  googleSubject: string;
  primaryEmail: string;
}

export const parsePlatformAdminBootstrapInput = (
  environment: NodeJS.ProcessEnv,
): PlatformAdminBootstrapInput =>
  bootstrapInputSchema.parse({
    displayName: environment.PLATFORM_ADMIN_BOOTSTRAP_DISPLAY_NAME,
    googleSubject: environment.PLATFORM_ADMIN_BOOTSTRAP_GOOGLE_SUBJECT,
    primaryEmail: environment.PLATFORM_ADMIN_BOOTSTRAP_EMAIL,
  });
