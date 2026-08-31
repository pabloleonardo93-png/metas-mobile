import { AppError } from '../../shared/errors/AppError.js';
import type { PlatformAdminSession } from './platformAdmin.types.js';

export const requireRecentPlatformAdminStepUp = (
  session: PlatformAdminSession,
  maximumAgeSeconds: number,
  now: Date = new Date(),
): void => {
  const verifiedAt = session.stepUpVerifiedAt ? Date.parse(session.stepUpVerifiedAt) : Number.NaN;
  const isRecent =
    session.assuranceLevel === 'MFA_VERIFIED' &&
    Number.isFinite(verifiedAt) &&
    verifiedAt <= now.getTime() &&
    now.getTime() - verifiedAt <= maximumAgeSeconds * 1000;

  if (!isRecent) {
    throw new AppError(
      403,
      'PLATFORM_ADMIN_STEP_UP_REQUIRED',
      'Confirme sua passkey novamente para continuar.',
    );
  }
};
