import { z } from 'zod';

const publicConfigSchema = z.object({
  VITE_GOOGLE_ADMIN_CLIENT_ID: z.string().trim().min(20).max(512),
});

export const loadPublicConfig = (): { googleAdminClientId: string } => {
  const parsed = publicConfigSchema.parse(import.meta.env);
  return { googleAdminClientId: parsed.VITE_GOOGLE_ADMIN_CLIENT_ID };
};
