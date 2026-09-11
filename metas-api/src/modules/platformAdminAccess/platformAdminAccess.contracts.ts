import { z } from 'zod';

export const platformAdminInvitationInputSchema = z
  .object({
    displayName: z.string().trim().min(2).max(160),
    email: z.email().trim().toLowerCase().max(320),
  })
  .strict();

export const platformAdminAccessEntrySchema = z
  .object({
    id: z.uuid(),
    displayName: z.string(),
    email: z.string(),
    status: z.enum(['ACTIVE', 'AWAITING_FIRST_ACCESS', 'AWAITING_DEVICE_APPROVAL', 'DISABLED']),
    invitationId: z.uuid().nullable(),
    enrollmentRequestId: z.uuid().nullable(),
    lastAccessAt: z.string().nullable(),
  })
  .strict();

export const platformAdminAccessListSchema = z
  .object({ items: z.array(platformAdminAccessEntrySchema) })
  .strict();

export const platformAdminAccessMutationSchema = z.object({ id: z.uuid() }).strict();

export type PlatformAdminAccessEntry = z.infer<typeof platformAdminAccessEntrySchema>;
export type PlatformAdminInvitationInput = z.infer<typeof platformAdminInvitationInputSchema>;
export type PlatformAdminAccessList = z.infer<typeof platformAdminAccessListSchema>;
