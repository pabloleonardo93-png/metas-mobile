export {};

import type { AuthenticatedSession } from '../modules/auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      authSession?: AuthenticatedSession;
      requestId: string;
    }
  }
}
