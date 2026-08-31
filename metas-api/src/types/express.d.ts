export {};

import type { AuthenticatedSession } from '../modules/auth/auth.types.js';
import type { PlatformAdminSession } from '../modules/platformAdmin/platformAdmin.types.js';

declare global {
  namespace Express {
    interface Request {
      authSession?: AuthenticatedSession;
      platformAdminSession?: PlatformAdminSession;
      requestId: string;
    }
  }
}
