import { mutation, request } from './adminApi';
import {
  platformAdminAccessListSchema,
  platformAdminAccessMutationSchema,
  platformAdminInvitationInputSchema,
  type PlatformAdminInvitationInput,
} from './platformAdminAccess.contracts';

export const platformAdminAccessApi = {
  async list(signal?: AbortSignal) {
    return platformAdminAccessListSchema.parse(
      await request('/api/administrators', signal ? { signal } : {}),
    );
  },
  async invite(input: PlatformAdminInvitationInput) {
    return platformAdminAccessMutationSchema.parse(
      await mutation('/api/administrators', platformAdminInvitationInputSchema.parse(input)),
    );
  },
  async cancel(invitationId: string) {
    return platformAdminAccessMutationSchema.parse(
      await mutation(`/api/administrators/${invitationId}/cancel`, {}),
    );
  },
  async approve(enrollmentRequestId: string) {
    return platformAdminAccessMutationSchema.parse(
      await mutation(`/api/administrators/first-enrollment/${enrollmentRequestId}/approve`, {}),
    );
  },
};
