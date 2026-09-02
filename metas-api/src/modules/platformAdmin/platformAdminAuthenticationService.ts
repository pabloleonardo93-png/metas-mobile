import { DatabaseError, QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import type { GoogleIdTokenVerifier } from '../auth/auth.types.js';
import {
  GoogleProviderNotConfiguredError,
  InvalidGoogleIdTokenError,
} from '../auth/googleIdTokenVerifier.js';
import {
  generateSessionToken,
  hashSessionToken,
  isValidSessionTokenFormat,
} from '../auth/sessionToken.js';
import { withPlatformAdminDatabaseContext } from '../../shared/database/withPlatformAdminDatabaseContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  PlatformAdminAssuranceLevel,
  PlatformAdminAuthenticationService,
  PlatformAdminLoginResult,
  PlatformAdminMeResult,
  PlatformAdminRequestMetadata,
  PlatformAdminSession,
} from './platformAdmin.types.js';

interface PlatformAdminLoginDatabaseRow {
  assuranceLevel: PlatformAdminAssuranceLevel;
  displayName: string;
  expiresAt: Date;
  platformAdminId: string;
  primaryEmail: string;
  sessionId: string;
}

interface PlatformAdminSessionDatabaseRow {
  assuranceLevel: PlatformAdminAssuranceLevel;
  expiresAt: Date;
  mfaVerifiedAt: Date | null;
  platformAdminId: string;
  sessionId: string;
  stepUpVerifiedAt: Date | null;
}

interface PlatformAdminMeDatabaseRow {
  displayName: string;
  hasWebAuthnCredential: boolean;
  id: string;
  primaryEmail: string;
  status: 'ACTIVE' | 'DISABLED';
}

const accessNotAuthorized = (): AppError =>
  new AppError(
    403,
    'PLATFORM_ADMIN_ACCESS_NOT_AUTHORIZED',
    'Não foi possível autorizar o acesso administrativo.',
  );

const unauthorized = (): AppError =>
  new AppError(401, 'UNAUTHORIZED', 'Autenticação administrativa necessária.');

const databaseErrorContains = (error: unknown, signal: string): boolean =>
  error instanceof DatabaseError && error.parent.message.includes(signal);

export class PostgresPlatformAdminAuthenticationService implements PlatformAdminAuthenticationService {
  public constructor(
    private readonly database: Sequelize,
    private readonly googleVerifier: GoogleIdTokenVerifier,
    private readonly sessionTtlSeconds: number,
    private readonly idleTimeoutSeconds: number,
  ) {}

  public async loginWithGoogle(
    idToken: string,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<PlatformAdminLoginResult> {
    let identity;
    try {
      identity = await this.googleVerifier.verify(idToken);
    } catch (error: unknown) {
      if (error instanceof GoogleProviderNotConfiguredError) {
        throw new AppError(
          503,
          'AUTH_PROVIDER_NOT_CONFIGURED',
          'O provedor de autenticação administrativa não está configurado.',
        );
      }
      if (error instanceof InvalidGoogleIdTokenError) {
        throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Token de autenticação inválido.');
      }
      throw error;
    }

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const now = Date.now();
    const expiresAt = new Date(now + this.sessionTtlSeconds * 1000);
    const idleExpiresAt = new Date(now + this.idleTimeoutSeconds * 1000);

    let rows: PlatformAdminLoginDatabaseRow[];
    try {
      rows = await this.database.query<PlatformAdminLoginDatabaseRow>(
        `SELECT
          platform_admin_id AS "platformAdminId",
          session_id AS "sessionId",
          display_name AS "displayName",
          primary_email AS "primaryEmail",
          assurance_level AS "assuranceLevel",
          expires_at AS "expiresAt"
        FROM metas.authenticate_platform_admin_google(
          :subject,
          :email,
          :tokenHash,
          :expiresAt,
          :idleExpiresAt,
          CAST(:ipAddress AS INET),
          :userAgent,
          CAST(:requestId AS UUID)
        )`,
        {
          replacements: {
            email: identity.email,
            expiresAt,
            idleExpiresAt,
            ipAddress: metadata.ipAddress,
            requestId: metadata.requestId,
            subject: identity.subject,
            tokenHash,
            userAgent: metadata.userAgent,
          },
          type: QueryTypes.SELECT,
        },
      );
    } catch (error: unknown) {
      if (databaseErrorContains(error, 'PLATFORM_ADMIN_ACCESS_DENIED')) {
        throw accessNotAuthorized();
      }
      throw error;
    }

    const login = rows[0];
    if (!login) {
      throw accessNotAuthorized();
    }

    return {
      admin: {
        assuranceLevel: login.assuranceLevel,
        displayName: login.displayName,
        id: login.platformAdminId,
        primaryEmail: login.primaryEmail,
      },
      expiresAt: login.expiresAt.toISOString(),
      sessionToken,
    };
  }

  public async authenticateSession(rawToken: string): Promise<PlatformAdminSession> {
    if (!isValidSessionTokenFormat(rawToken)) {
      throw unauthorized();
    }

    const tokenHash = hashSessionToken(rawToken);
    const rows = await this.database.query<PlatformAdminSessionDatabaseRow>(
      `SELECT
        platform_admin_id AS "platformAdminId",
        session_id AS "sessionId",
        assurance_level AS "assuranceLevel",
        expires_at AS "expiresAt",
        mfa_verified_at AS "mfaVerifiedAt",
        step_up_verified_at AS "stepUpVerifiedAt"
       FROM metas.resolve_platform_admin_session(:tokenHash, :idleTimeoutSeconds)`,
      {
        replacements: { idleTimeoutSeconds: this.idleTimeoutSeconds, tokenHash },
        type: QueryTypes.SELECT,
      },
    );
    const session = rows[0];
    if (!session) {
      throw unauthorized();
    }

    return {
      assuranceLevel: session.assuranceLevel,
      expiresAt: session.expiresAt.toISOString(),
      mfaVerifiedAt: session.mfaVerifiedAt?.toISOString() ?? null,
      platformAdminId: session.platformAdminId,
      sessionId: session.sessionId,
      stepUpVerifiedAt: session.stepUpVerifiedAt?.toISOString() ?? null,
    };
  }

  public async getMe(session: PlatformAdminSession): Promise<PlatformAdminMeResult> {
    const rows = await this.withSessionContext(session, (transaction) =>
      this.database.query<PlatformAdminMeDatabaseRow>(
        `SELECT
          admin.id,
          admin.display_name AS "displayName",
          admin.primary_email AS "primaryEmail",
          admin.status,
          EXISTS (
            SELECT 1 FROM metas.list_platform_admin_webauthn_credentials()
          ) AS "hasWebAuthnCredential"
         FROM metas.get_platform_admin_me() admin`,
        { transaction, type: QueryTypes.SELECT },
      ),
    );
    const admin = rows[0];
    if (!admin) {
      throw unauthorized();
    }
    return { ...admin, assuranceLevel: session.assuranceLevel };
  }

  public async logout(
    session: PlatformAdminSession,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<void> {
    const rows = await this.withSessionContext(session, (transaction) =>
      this.database.query<{ revoked: boolean }>(
        `SELECT metas.revoke_platform_admin_session(
          CAST(:requestId AS UUID),
          CAST(:ipAddress AS INET),
          :userAgent
        ) AS revoked`,
        {
          replacements: {
            ipAddress: metadata.ipAddress,
            requestId: metadata.requestId,
            userAgent: metadata.userAgent,
          },
          transaction,
          type: QueryTypes.SELECT,
        },
      ),
    );
    if (rows[0]?.revoked !== true) {
      throw unauthorized();
    }
  }

  private async withSessionContext<Result>(
    session: PlatformAdminSession,
    callback: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await withPlatformAdminDatabaseContext(
        this.database,
        { platformAdminId: session.platformAdminId, sessionId: session.sessionId },
        callback,
      );
    } catch (error: unknown) {
      if (databaseErrorContains(error, 'PLATFORM_ADMIN_CONTEXT_REQUIRED')) {
        throw unauthorized();
      }
      throw error;
    }
  }
}
