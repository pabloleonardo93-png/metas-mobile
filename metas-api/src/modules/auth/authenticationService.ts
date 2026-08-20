import { DatabaseError, QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';

import { withDatabaseContext } from '../../shared/database/withDatabaseContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  AuthenticatedSession,
  AuthenticationService,
  GoogleIdTokenVerifier,
  LoginMetadata,
  LoginResult,
  MeResult,
  UserRole,
} from './auth.types.js';
import {
  GoogleProviderNotConfiguredError,
  InvalidGoogleIdTokenError,
} from './googleIdTokenVerifier.js';
import {
  generateSessionToken,
  hashSessionToken,
  isValidSessionTokenFormat,
} from './sessionToken.js';

interface LoginDatabaseRow {
  employeeId: string;
  employeeStatus: 'ATIVO' | 'INATIVO';
  expiresAt: Date;
  fullName: string;
  joinedOn: string;
  primaryEmail: string;
  role: UserRole;
  storeId: string;
  userId: string;
}

interface SessionDatabaseRow {
  employeeId: string;
  role: UserRole;
  storeId: string;
  userId: string;
}

interface MeDatabaseRow {
  email: string;
  id: string;
  joinedOn: string;
  name: string;
  role: UserRole;
  status: 'ATIVO' | 'INATIVO';
}

const accessNotAuthorized = (): AppError =>
  new AppError(403, 'ACCESS_NOT_AUTHORIZED', 'Não foi possível autorizar o acesso desta conta.');

const unauthorized = (): AppError => new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');

const databaseErrorContains = (error: unknown, signal: string): boolean =>
  error instanceof DatabaseError && error.parent.message.includes(signal);

const mapLoginDatabaseError = (error: unknown): never => {
  if (databaseErrorContains(error, 'EMPLOYEE_SELECTION_REQUIRED')) {
    throw new AppError(
      409,
      'EMPLOYEE_SELECTION_REQUIRED',
      'É necessário selecionar um vínculo para continuar.',
    );
  }
  if (
    error instanceof UniqueConstraintError ||
    databaseErrorContains(error, 'AUTH_ACCESS_DENIED') ||
    databaseErrorContains(error, 'AUTH_IDENTITY_CONFLICT')
  ) {
    throw accessNotAuthorized();
  }
  throw error;
};

export class PostgresAuthenticationService implements AuthenticationService {
  public constructor(
    private readonly database: Sequelize,
    private readonly googleVerifier: GoogleIdTokenVerifier,
    private readonly sessionTtlSeconds: number,
  ) {}

  public async loginWithGoogle(idToken: string, metadata: LoginMetadata): Promise<LoginResult> {
    let identity;
    try {
      identity = await this.googleVerifier.verify(idToken);
    } catch (error: unknown) {
      if (error instanceof GoogleProviderNotConfiguredError) {
        throw new AppError(
          503,
          'AUTH_PROVIDER_NOT_CONFIGURED',
          'O provedor de autenticação não está configurado.',
        );
      }
      if (error instanceof InvalidGoogleIdTokenError) {
        throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Token de autenticação inválido.');
      }
      throw error;
    }

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1000);

    let rows: LoginDatabaseRow[];
    try {
      rows = await this.database.query<LoginDatabaseRow>(
        `SELECT
          user_id AS "userId",
          employee_id AS "employeeId",
          store_id AS "storeId",
          role,
          full_name AS "fullName",
          primary_email AS "primaryEmail",
          employee_status AS "employeeStatus",
          joined_on AS "joinedOn",
          expires_at AS "expiresAt"
        FROM metas.authenticate_google_identity(
          :subject,
          :email,
          :tokenHash,
          :expiresAt,
          CAST(:ipAddress AS INET),
          :userAgent
        )`,
        {
          replacements: {
            email: identity.email,
            expiresAt,
            ipAddress: metadata.ipAddress,
            subject: identity.subject,
            tokenHash,
            userAgent: metadata.userAgent,
          },
          type: QueryTypes.SELECT,
        },
      );
    } catch (error: unknown) {
      return mapLoginDatabaseError(error);
    }

    const login = rows[0];
    if (!login) {
      throw accessNotAuthorized();
    }

    return {
      expiresAt: login.expiresAt.toISOString(),
      sessionToken,
      user: {
        id: login.userId,
        name: login.fullName,
        role: login.role,
      },
    };
  }

  public async authenticateSession(rawToken: string): Promise<AuthenticatedSession> {
    if (!isValidSessionTokenFormat(rawToken)) {
      throw unauthorized();
    }

    return this.resolveSession(hashSessionToken(rawToken));
  }

  public async refreshSession(session: AuthenticatedSession): Promise<AuthenticatedSession> {
    return this.resolveSession(session.tokenHash);
  }

  private async resolveSession(tokenHash: Buffer): Promise<AuthenticatedSession> {
    const rows = await this.database.query<SessionDatabaseRow>(
      `SELECT
        user_id AS "userId",
        employee_id AS "employeeId",
        store_id AS "storeId",
        role
       FROM metas.resolve_session(:tokenHash)`,
      {
        replacements: { tokenHash },
        type: QueryTypes.SELECT,
      },
    );
    const session = rows[0];
    if (!session) {
      throw unauthorized();
    }

    return { ...session, tokenHash };
  }

  public async getMe(session: AuthenticatedSession): Promise<MeResult> {
    const rows = await withDatabaseContext(
      this.database,
      {
        employeeId: session.employeeId,
        storeId: session.storeId,
        userId: session.userId,
      },
      async (transaction) =>
        this.database.query<MeDatabaseRow>(
          `SELECT
          app_user.id,
          app_user.full_name AS name,
          COALESCE(identity.provider_email::TEXT, app_user.primary_email::TEXT) AS email,
          employee.role::TEXT AS role,
          employee.status,
          employee.joined_on AS "joinedOn"
         FROM metas.users app_user
         JOIN metas.employees employee ON employee.user_id = app_user.id
         LEFT JOIN metas.auth_identities identity
           ON identity.user_id = app_user.id
          AND identity.provider = 'GOOGLE'
          AND identity.disabled_at IS NULL
         WHERE app_user.id = :userId
           AND employee.id = :employeeId`,
          {
            replacements: {
              employeeId: session.employeeId,
              userId: session.userId,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
    );
    const profile = rows[0];
    if (!profile) {
      throw unauthorized();
    }
    return profile;
  }

  public async logout(session: AuthenticatedSession): Promise<void> {
    const rows = await this.database.query<{ revoked: boolean }>(
      `SELECT metas.revoke_session(
        :tokenHash,
        :userId,
        :employeeId
      ) AS revoked`,
      {
        replacements: {
          employeeId: session.employeeId,
          tokenHash: session.tokenHash,
          userId: session.userId,
        },
        type: QueryTypes.SELECT,
      },
    );
    if (rows[0]?.revoked !== true) {
      throw unauthorized();
    }
  }
}
