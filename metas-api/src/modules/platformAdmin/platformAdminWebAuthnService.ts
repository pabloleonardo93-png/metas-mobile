import { createHash, timingSafeEqual } from 'node:crypto';

import type {
  AuthenticatorTransportFuture,
  CredentialDeviceType,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import { BaseError, DatabaseError, QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { generateSessionToken, hashSessionToken } from '../auth/sessionToken.js';
import { withPlatformAdminDatabaseContext } from '../../shared/database/withPlatformAdminDatabaseContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  PlatformAdminMeResult,
  PlatformAdminRequestMetadata,
  PlatformAdminSession,
} from './platformAdmin.types.js';
import type { PlatformAdminWebAuthnAdapter } from './platformAdminWebAuthnAdapter.js';
import type {
  PlatformAdminWebAuthnAuthenticationOptionsResult,
  PlatformAdminWebAuthnOptionsResult,
  PlatformAdminWebAuthnPurpose,
  PlatformAdminWebAuthnService,
  PlatformAdminWebAuthnVerificationResult,
} from './platformAdminWebAuthn.types.js';

interface StoredCredentialRow {
  backedUp: boolean;
  credentialId: string;
  deviceType: CredentialDeviceType;
  publicKey: Buffer;
  signCount: string;
  transports: AuthenticatorTransportFuture[];
}

interface ConsumedChallengeRow {
  challengeHash: Buffer;
  purpose: PlatformAdminWebAuthnPurpose;
}

interface VerificationDatabaseRow {
  assuranceLevel: 'MFA_VERIFIED';
  mfaVerifiedAt: Date;
  stepUpVerifiedAt: Date;
}

export interface PlatformAdminWebAuthnConfiguration {
  allowedOrigins: readonly string[];
  challengeTtlSeconds: number;
  rpId: string;
  rpName: string;
  stepUpTtlSeconds: number;
}

const unauthorized = (): AppError =>
  new AppError(401, 'UNAUTHORIZED', 'Autenticação administrativa necessária.');

const verificationDenied = (): AppError =>
  new AppError(401, 'WEBAUTHN_VERIFICATION_DENIED', 'Não foi possível validar a passkey.');

const databaseErrorContains = (error: unknown, signal: string): boolean =>
  error instanceof DatabaseError && error.parent.message.includes(signal);

const challengeHash = (challenge: string): Buffer =>
  createHash('sha256').update(challenge, 'utf8').digest();

const uuidBytes = (uuid: string): Uint8Array<ArrayBuffer> => {
  const result = new Uint8Array(new ArrayBuffer(16));
  result.set(Buffer.from(uuid.replaceAll('-', ''), 'hex'));
  return result;
};

const safeCounter = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Não foi possível processar a credencial.');
  }
  return parsed;
};

const matchesChallengeHash =
  (expectedHash: Buffer) =>
  (candidate: string): boolean => {
    const candidateHash = challengeHash(candidate);
    return (
      candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash)
    );
  };

export class PostgresPlatformAdminWebAuthnService implements PlatformAdminWebAuthnService {
  public constructor(
    private readonly database: Sequelize,
    private readonly adapter: PlatformAdminWebAuthnAdapter,
    private readonly configuration: PlatformAdminWebAuthnConfiguration,
  ) {}

  public async createRegistrationOptions(
    session: PlatformAdminSession,
  ): Promise<
    PlatformAdminWebAuthnOptionsResult<
      Awaited<ReturnType<PlatformAdminWebAuthnAdapter['generateRegistrationOptions']>>
    >
  > {
    const [admin, credentials] = await this.withSessionContext(session, async (transaction) => {
      const adminRows = await this.database.query<PlatformAdminMeResult>(
        `SELECT id, display_name AS "displayName", primary_email AS "primaryEmail", status
         FROM metas.get_platform_admin_me()`,
        { transaction, type: QueryTypes.SELECT },
      );
      const credentialRows = await this.listCredentials(transaction);
      return [adminRows[0], credentialRows] as const;
    });
    if (!admin) {
      throw unauthorized();
    }

    const options = await this.adapter.generateRegistrationOptions({
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      rpID: this.configuration.rpId,
      rpName: this.configuration.rpName,
      timeout: this.configuration.challengeTtlSeconds * 1000,
      userDisplayName: admin.displayName,
      userID: uuidBytes(admin.id),
      userName: admin.primaryEmail,
    });
    const challengeId = await this.storeChallenge(session, 'REGISTRATION', options.challenge);
    return { challengeId, options };
  }

  public async createAuthenticationOptions(
    session: PlatformAdminSession,
  ): Promise<PlatformAdminWebAuthnAuthenticationOptionsResult> {
    const credentials = await this.withSessionContext(session, (transaction) =>
      this.listCredentials(transaction),
    );
    if (credentials.length === 0) {
      throw new AppError(409, 'WEBAUTHN_CREDENTIAL_REQUIRED', 'Nenhuma passkey está cadastrada.');
    }

    const purpose = session.assuranceLevel === 'GOOGLE_ONLY' ? 'AUTHENTICATION' : 'STEP_UP';
    const options = await this.adapter.generateAuthenticationOptions({
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      rpID: this.configuration.rpId,
      timeout: this.configuration.challengeTtlSeconds * 1000,
      userVerification: 'required',
    });
    const challengeId = await this.storeChallenge(session, purpose, options.challenge);
    return { challengeId, options, purpose };
  }

  public async verifyRegistration(
    session: PlatformAdminSession,
    requestedChallengeId: string,
    response: Parameters<PlatformAdminWebAuthnService['verifyRegistration']>[2],
    friendlyName: string | null,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<PlatformAdminWebAuthnVerificationResult> {
    const challenge = await this.consumeChallengeOrRecordFailure(
      session,
      requestedChallengeId,
      'REGISTRATION',
      metadata,
    );
    try {
      const verification = await this.adapter.verifyRegistrationResponse({
        expectedChallenge: matchesChallengeHash(challenge.challengeHash),
        expectedOrigin: [...this.configuration.allowedOrigins],
        expectedRPID: this.configuration.rpId,
        requireUserPresence: true,
        requireUserVerification: true,
        response,
      });
      if (!verification.verified || !verification.registrationInfo?.userVerified) {
        throw verificationDenied();
      }

      const sessionToken = generateSessionToken();
      const info = verification.registrationInfo;
      const rows = await this.withSessionContext(session, (transaction) =>
        this.database.query<VerificationDatabaseRow>(
          `SELECT
             assurance_level AS "assuranceLevel",
             mfa_verified_at AS "mfaVerifiedAt",
             step_up_verified_at AS "stepUpVerifiedAt"
           FROM metas.register_platform_admin_webauthn_credential(
             CAST(:challengeId AS UUID), :credentialId, :publicKey, :signCount,
             string_to_array(:transports, ','), :deviceType, :backedUp, :friendlyName,
             :tokenHash, :stepUpTtlSeconds, CAST(:requestId AS UUID),
             CAST(:ipAddress AS INET), :userAgent
           )`,
          {
            replacements: {
              backedUp: info.credentialBackedUp,
              challengeId: requestedChallengeId,
              credentialId: info.credential.id,
              deviceType: info.credentialDeviceType,
              friendlyName,
              ipAddress: metadata.ipAddress,
              publicKey: Buffer.from(info.credential.publicKey),
              requestId: metadata.requestId,
              signCount: info.credential.counter,
              stepUpTtlSeconds: this.configuration.stepUpTtlSeconds,
              tokenHash: hashSessionToken(sessionToken),
              transports: (response.response.transports ?? []).join(','),
              userAgent: metadata.userAgent,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      return this.verificationResult(rows[0], sessionToken);
    } catch (error: unknown) {
      await this.recordFailure(session, requestedChallengeId, metadata);
      if (
        error instanceof AppError ||
        error instanceof BaseError ||
        databaseErrorContains(error, 'WEBAUTHN_')
      ) {
        throw verificationDenied();
      }
      throw error;
    }
  }

  public async verifyAuthentication(
    session: PlatformAdminSession,
    requestedChallengeId: string,
    response: Parameters<PlatformAdminWebAuthnService['verifyAuthentication']>[2],
    metadata: PlatformAdminRequestMetadata,
  ): Promise<PlatformAdminWebAuthnVerificationResult> {
    const expectedPurpose = session.assuranceLevel === 'GOOGLE_ONLY' ? 'AUTHENTICATION' : 'STEP_UP';
    const challenge = await this.consumeChallengeOrRecordFailure(
      session,
      requestedChallengeId,
      expectedPurpose,
      metadata,
    );
    try {
      const credential = await this.findCredential(session, response.id);
      if (!credential) {
        throw verificationDenied();
      }
      const storedCounter = safeCounter(credential.signCount);
      const webAuthnCredential: WebAuthnCredential = {
        counter: storedCounter,
        id: credential.credentialId,
        publicKey: Uint8Array.from(credential.publicKey),
        transports: credential.transports,
      };
      const verification = await this.adapter.verifyAuthenticationResponse({
        credential: webAuthnCredential,
        expectedChallenge: matchesChallengeHash(challenge.challengeHash),
        expectedOrigin: [...this.configuration.allowedOrigins],
        expectedRPID: this.configuration.rpId,
        requireUserVerification: true,
        response,
      });
      if (!verification.verified || !verification.authenticationInfo.userVerified) {
        throw verificationDenied();
      }

      const sessionToken = generateSessionToken();
      const info = verification.authenticationInfo;
      const rows = await this.withSessionContext(session, (transaction) =>
        this.database.query<VerificationDatabaseRow>(
          `SELECT
             assurance_level AS "assuranceLevel",
             mfa_verified_at AS "mfaVerifiedAt",
             step_up_verified_at AS "stepUpVerifiedAt"
           FROM metas.complete_platform_admin_webauthn_authentication(
             CAST(:challengeId AS UUID), :credentialId, :expectedSignCount,
             :verifiedSignCount, :deviceType, :backedUp, :tokenHash,
             CAST(:requestId AS UUID), CAST(:ipAddress AS INET), :userAgent
           )`,
          {
            replacements: {
              backedUp: info.credentialBackedUp,
              challengeId: requestedChallengeId,
              credentialId: credential.credentialId,
              deviceType: info.credentialDeviceType,
              expectedSignCount: storedCounter,
              ipAddress: metadata.ipAddress,
              requestId: metadata.requestId,
              tokenHash: hashSessionToken(sessionToken),
              userAgent: metadata.userAgent,
              verifiedSignCount: info.newCounter,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      return this.verificationResult(rows[0], sessionToken);
    } catch (error: unknown) {
      await this.recordFailure(session, requestedChallengeId, metadata);
      if (
        error instanceof AppError ||
        error instanceof BaseError ||
        databaseErrorContains(error, 'WEBAUTHN_') ||
        error instanceof Error
      ) {
        throw verificationDenied();
      }
      throw error;
    }
  }

  private async storeChallenge(
    session: PlatformAdminSession,
    purpose: PlatformAdminWebAuthnPurpose,
    rawChallenge: string,
  ): Promise<string> {
    const expiresAt = new Date(Date.now() + this.configuration.challengeTtlSeconds * 1000);
    const rows = await this.withSessionContext(session, (transaction) =>
      this.database.query<{ challengeId: string }>(
        `SELECT metas.create_platform_admin_webauthn_challenge(
          :purpose, :challengeHash, :expiresAt, :stepUpTtlSeconds
        ) AS "challengeId"`,
        {
          replacements: {
            challengeHash: challengeHash(rawChallenge),
            expiresAt,
            purpose,
            stepUpTtlSeconds: this.configuration.stepUpTtlSeconds,
          },
          transaction,
          type: QueryTypes.SELECT,
        },
      ),
    );
    const challengeId = rows[0]?.challengeId;
    if (!challengeId) {
      throw unauthorized();
    }
    return challengeId;
  }

  private async consumeChallenge(
    session: PlatformAdminSession,
    challengeId: string,
    purpose: PlatformAdminWebAuthnPurpose,
  ): Promise<ConsumedChallengeRow> {
    try {
      const rows = await this.withSessionContext(session, (transaction) =>
        this.database.query<ConsumedChallengeRow>(
          `SELECT challenge_hash AS "challengeHash", purpose
           FROM metas.consume_platform_admin_webauthn_challenge(
             CAST(:challengeId AS UUID), :purpose
           )`,
          {
            replacements: { challengeId, purpose },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      const challenge = rows[0];
      if (!challenge) {
        throw verificationDenied();
      }
      return challenge;
    } catch (error: unknown) {
      if (databaseErrorContains(error, 'WEBAUTHN_CHALLENGE_NOT_AVAILABLE')) {
        throw verificationDenied();
      }
      throw error;
    }
  }

  private async consumeChallengeOrRecordFailure(
    session: PlatformAdminSession,
    challengeId: string,
    purpose: PlatformAdminWebAuthnPurpose,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<ConsumedChallengeRow> {
    try {
      return await this.consumeChallenge(session, challengeId, purpose);
    } catch (error: unknown) {
      await this.recordFailure(session, challengeId, metadata);
      throw error;
    }
  }

  private async listCredentials(transaction: Transaction): Promise<StoredCredentialRow[]> {
    return this.database.query<StoredCredentialRow>(
      `SELECT
         credential_id AS "credentialId", public_key AS "publicKey",
         sign_count AS "signCount", transports, device_type AS "deviceType",
         backed_up AS "backedUp"
       FROM metas.list_platform_admin_webauthn_credentials()`,
      { transaction, type: QueryTypes.SELECT },
    );
  }

  private async findCredential(
    session: PlatformAdminSession,
    credentialId: string,
  ): Promise<StoredCredentialRow | undefined> {
    const credentials = await this.withSessionContext(session, (transaction) =>
      this.listCredentials(transaction),
    );
    return credentials.find((credential) => credential.credentialId === credentialId);
  }

  private async recordFailure(
    session: PlatformAdminSession,
    challengeId: string,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<void> {
    await this.withSessionContext(session, (transaction) =>
      this.database.query(
        `SELECT metas.record_platform_admin_webauthn_failure(
          CAST(:challengeId AS UUID), CAST(:requestId AS UUID),
          CAST(:ipAddress AS INET), :userAgent
        )`,
        {
          replacements: {
            challengeId,
            ipAddress: metadata.ipAddress,
            requestId: metadata.requestId,
            userAgent: metadata.userAgent,
          },
          transaction,
          type: QueryTypes.SELECT,
        },
      ),
    ).catch(() => undefined);
  }

  private verificationResult(
    row: VerificationDatabaseRow | undefined,
    sessionToken: string,
  ): PlatformAdminWebAuthnVerificationResult {
    if (!row) {
      throw verificationDenied();
    }
    return {
      assuranceLevel: 'MFA_VERIFIED',
      mfaVerifiedAt: row.mfaVerifiedAt.toISOString(),
      sessionToken,
      stepUpVerifiedAt: row.stepUpVerifiedAt.toISOString(),
    };
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
