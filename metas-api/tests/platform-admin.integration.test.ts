import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import request from 'supertest';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { createApp } from '../src/app.js';
import { disconnectDatabase } from '../src/config/database.js';
import {
  assertPlatformAdminRuntimeConnectionSecurity,
  assertRuntimeConnectionSecurity,
} from '../src/database/connectionSecurity.js';
import { createMigrator } from '../src/database/umzug.js';
import type {
  GoogleIdTokenVerifier,
  VerifiedGoogleIdentity,
} from '../src/modules/auth/auth.types.js';
import { hashSessionToken } from '../src/modules/auth/sessionToken.js';
import { PostgresPlatformAdminAuthenticationService } from '../src/modules/platformAdmin/platformAdminAuthenticationService.js';
import type { PlatformAdminWebAuthnAdapter } from '../src/modules/platformAdmin/platformAdminWebAuthnAdapter.js';
import { PostgresPlatformAdminWebAuthnService } from '../src/modules/platformAdmin/platformAdminWebAuthnService.js';
import type {
  PlatformAdminLoginResult,
  PlatformAdminSession,
} from '../src/modules/platformAdmin/platformAdmin.types.js';
import { AppError } from '../src/shared/errors/AppError.js';
import type { Logger } from '../src/shared/logging/logger.js';
import { withPlatformAdminDatabaseContext } from '../src/shared/database/withPlatformAdminDatabaseContext.js';
import { createIntegrationDatabases } from './integrationDatabase.js';

const silentLogger: Logger = { error: () => undefined, info: () => undefined };

class FakeGoogleVerifier implements GoogleIdTokenVerifier {
  public constructor(private readonly identity: VerifiedGoogleIdentity) {}

  public verify(): Promise<VerifiedGoogleIdentity> {
    return Promise.resolve(this.identity);
  }
}

class FakeWebAuthnAdapter implements PlatformAdminWebAuthnAdapter {
  public authenticationChallenge = `authentication-${randomUUID()}`;
  public authenticationChallenges: string[] = [];
  public authenticationUserVerified = true;
  public rejectAuthentication = false;
  public rejectRegistration = false;
  public registrationUserVerified = true;
  private verificationBarrier:
    { arrived: number; expected: number; promise: Promise<void>; release: () => void } | undefined;
  public constructor(
    public readonly credentialId = `integration_${randomUUID().replaceAll('-', '')}`,
  ) {}

  public waitForConcurrentVerifications(expected: number): void {
    let release = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.verificationBarrier = { arrived: 0, expected, promise, release };
  }
  public registrationChallenge = `registration-${randomUUID()}`;

  public generateAuthenticationOptions(
    options: Parameters<PlatformAdminWebAuthnAdapter['generateAuthenticationOptions']>[0],
  ): ReturnType<PlatformAdminWebAuthnAdapter['generateAuthenticationOptions']> {
    assert.equal(options.rpID, 'admin.example.test');
    assert.equal(options.userVerification, 'required');
    this.authenticationChallenges.push(this.authenticationChallenge);
    return Promise.resolve({
      challenge: this.authenticationChallenge,
      rpId: 'admin.example.test',
      userVerification: 'required',
    });
  }

  public generateRegistrationOptions(
    options: Parameters<PlatformAdminWebAuthnAdapter['generateRegistrationOptions']>[0],
  ): ReturnType<PlatformAdminWebAuthnAdapter['generateRegistrationOptions']> {
    assert.equal(options.rpID, 'admin.example.test');
    assert.equal(options.attestationType, 'none');
    assert.equal(options.authenticatorSelection?.userVerification, 'required');
    this.registrationChallenge = `registration-${randomUUID()}`;
    return Promise.resolve({
      attestation: 'none',
      challenge: this.registrationChallenge,
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      rp: { id: 'admin.example.test', name: 'Metas Admin' },
      user: { displayName: 'Admin', id: 'admin-id', name: 'admin@example.test' },
    });
  }

  public async verifyAuthenticationResponse(
    options: Parameters<PlatformAdminWebAuthnAdapter['verifyAuthenticationResponse']>[0],
  ): ReturnType<PlatformAdminWebAuthnAdapter['verifyAuthenticationResponse']> {
    assert.deepEqual(options.expectedOrigin, ['https://admin.example.test']);
    assert.equal(options.expectedRPID, 'admin.example.test');
    assert.equal(options.requireUserVerification, true);
    if (this.verificationBarrier) {
      this.verificationBarrier.arrived += 1;
      if (this.verificationBarrier.arrived === this.verificationBarrier.expected) {
        this.verificationBarrier.release();
      }
      await this.verificationBarrier.promise;
    }
    let challengeValid = false;
    if (typeof options.expectedChallenge === 'function') {
      for (const challenge of this.authenticationChallenges) {
        if (await Promise.resolve(options.expectedChallenge(challenge))) {
          challengeValid = true;
          break;
        }
      }
    } else {
      challengeValid = this.authenticationChallenges.includes(options.expectedChallenge);
    }
    return {
      authenticationInfo: {
        credentialBackedUp: true,
        credentialDeviceType: 'multiDevice',
        credentialID: options.credential.id,
        newCounter: options.credential.counter + 1,
        origin: 'https://admin.example.test',
        rpID: 'admin.example.test',
        userVerified: this.authenticationUserVerified,
      },
      verified: challengeValid && !this.rejectAuthentication,
    };
  }

  public async verifyRegistrationResponse(
    options: Parameters<PlatformAdminWebAuthnAdapter['verifyRegistrationResponse']>[0],
  ): ReturnType<PlatformAdminWebAuthnAdapter['verifyRegistrationResponse']> {
    assert.deepEqual(options.expectedOrigin, ['https://admin.example.test']);
    assert.equal(options.expectedRPID, 'admin.example.test');
    assert.equal(options.requireUserVerification, true);
    if (this.verificationBarrier) {
      this.verificationBarrier.arrived += 1;
      if (this.verificationBarrier.arrived === this.verificationBarrier.expected) {
        this.verificationBarrier.release();
      }
      await this.verificationBarrier.promise;
    }
    const challengeValid =
      typeof options.expectedChallenge === 'function'
        ? await options.expectedChallenge(this.registrationChallenge)
        : options.expectedChallenge === this.registrationChallenge;
    if (!challengeValid || this.rejectRegistration) return { verified: false };
    return {
      registrationInfo: {
        aaguid: randomUUID(),
        attestationObject: Uint8Array.from([1, 2, 3]),
        credential: {
          counter: 0,
          id: this.credentialId,
          publicKey: Uint8Array.from([1, 2, 3, 4]),
          transports: ['internal'],
        },
        credentialBackedUp: true,
        credentialDeviceType: 'multiDevice',
        credentialType: 'public-key',
        fmt: 'none',
        origin: 'https://admin.example.test',
        rpID: 'admin.example.test',
        userVerified: this.registrationUserVerified,
      },
      verified: true,
    };
  }
}

const registrationResponse: RegistrationResponseJSON = {
  clientExtensionResults: {},
  id: 'integration_credential_id',
  rawId: 'integration_credential_id',
  response: {
    attestationObject: 'attestation_object',
    clientDataJSON: 'client_data',
    transports: ['internal'],
  },
  type: 'public-key',
};

const authenticationResponse: AuthenticationResponseJSON = {
  clientExtensionResults: {},
  id: 'integration_credential_id',
  rawId: 'integration_credential_id',
  response: {
    authenticatorData: 'authenticator_data',
    clientDataJSON: 'client_data',
    signature: 'signature',
  },
  type: 'public-key',
};

const withMigrationOwner = async <Result>(
  database: Sequelize,
  callback: (transaction: Transaction) => Promise<Result>,
): Promise<Result> =>
  database.transaction(async (transaction) => {
    await database.query('SET LOCAL ROLE metas_migration_owner', { transaction });
    return callback(transaction);
  });

interface ProvisionedAdmin {
  email: string;
  id: string;
  subject: string;
}

const provisionAdmin = async (database: Sequelize, label: string): Promise<ProvisionedAdmin> => {
  const email = `${label}-${randomUUID()}@example.test`;
  const subject = `google-${label}-${randomUUID()}`;
  const rows = await database.query<{ created: boolean; platformAdminId: string }>(
    `SELECT
      platform_admin_id AS "platformAdminId",
      created
     FROM metas.bootstrap_platform_admin(:displayName, :email, :subject)`,
    {
      replacements: { displayName: `Admin ${label}`, email, subject },
      type: QueryTypes.SELECT,
    },
  );
  assert.equal(rows[0]?.created, true);
  assert.ok(rows[0]?.platformAdminId);
  return { email, id: rows[0].platformAdminId, subject };
};

const createService = (
  database: Sequelize,
  identity: VerifiedGoogleIdentity,
): PostgresPlatformAdminAuthenticationService =>
  new PostgresPlatformAdminAuthenticationService(
    database,
    new FakeGoogleVerifier(identity),
    3_600,
    900,
  );

const login = async (
  database: Sequelize,
  identity: VerifiedGoogleIdentity,
): Promise<PlatformAdminLoginResult> => {
  const response = await request(
    createApp({
      logger: silentLogger,
      platformAdminAuthenticationService: createService(database, identity),
    }),
  )
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'valid-platform-admin-id-token' })
    .expect(200);
  return JSON.parse(response.text) as PlatformAdminLoginResult;
};

const testDatabases = createIntegrationDatabases(3, 2);

if (testDatabases === null) {
  await test('platform admin PostgreSQL tests require dedicated test URLs', {
    skip: 'Dedicated runtime, migration and platform admin test URLs are not configured.',
  });
} else {
  const { migrationDatabase, platformAdminRuntimeDatabase, runtimeDatabase } = testDatabases;

  try {
    await migrationDatabase.authenticate();
    await runtimeDatabase.authenticate();
    await platformAdminRuntimeDatabase.authenticate();
    await assertRuntimeConnectionSecurity(runtimeDatabase);
    await assertPlatformAdminRuntimeConnectionSecurity(platformAdminRuntimeDatabase);
    await createMigrator(migrationDatabase).up();

    await test('platform admin bootstrap is exact, idempotent and conflict-safe', async () => {
      const email = `bootstrap-${randomUUID()}@example.test`;
      const subject = `bootstrap-${randomUUID()}`;
      const replacements = { displayName: 'Admin Bootstrap', email, subject };
      const statement = `SELECT
        platform_admin_id AS "platformAdminId",
        identity_id AS "identityId",
        created
       FROM metas.bootstrap_platform_admin(:displayName, :email, :subject)`;
      const first = await migrationDatabase.query<{
        created: boolean;
        identityId: string;
        platformAdminId: string;
      }>(statement, { replacements, type: QueryTypes.SELECT });
      const second = await migrationDatabase.query<{
        created: boolean;
        identityId: string;
        platformAdminId: string;
      }>(statement, { replacements, type: QueryTypes.SELECT });

      assert.equal(first[0]?.created, true);
      assert.equal(second[0]?.created, false);
      assert.equal(second[0]?.platformAdminId, first[0]?.platformAdminId);
      assert.equal(second[0]?.identityId, first[0]?.identityId);
      await assert.rejects(
        migrationDatabase.query(statement, {
          replacements: { ...replacements, subject: `different-${randomUUID()}` },
          type: QueryTypes.SELECT,
        }),
      );
    });

    await test('concurrent platform admin bootstrap does not create duplicates', async () => {
      const replacements = {
        displayName: 'Admin Concurrente',
        email: `concurrent-${randomUUID()}@example.test`,
        subject: `concurrent-${randomUUID()}`,
      };
      const statement = `SELECT created
        FROM metas.bootstrap_platform_admin(:displayName, :email, :subject)`;
      const results = await Promise.all(
        Array.from({ length: 2 }, () =>
          migrationDatabase.query<{ created: boolean }>(statement, {
            replacements,
            type: QueryTypes.SELECT,
          }),
        ),
      );

      assert.deepEqual(results.map((rows) => rows[0]?.created).sort(), [false, true]);
    });

    await test('a provisioned Google subject creates only a hashed GOOGLE_ONLY session', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'login');
      const result = await login(platformAdminRuntimeDatabase, admin);

      assert.equal(result.admin.id, admin.id);
      assert.equal(result.admin.assuranceLevel, 'GOOGLE_ONLY');
      assert.equal(result.admin.primaryEmail, admin.email);
      assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/u);

      const sessionRows = await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query<{
          assuranceLevel: string;
          mfaVerifiedAt: Date | null;
          tokenHashHex: string;
        }>(
          `SELECT
            assurance_level AS "assuranceLevel",
            mfa_verified_at AS "mfaVerifiedAt",
            encode(token_hash, 'hex') AS "tokenHashHex"
           FROM metas.platform_admin_sessions
           WHERE platform_admin_id = :platformAdminId`,
          {
            replacements: { platformAdminId: admin.id },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      assert.equal(sessionRows[0]?.assuranceLevel, 'GOOGLE_ONLY');
      assert.equal(sessionRows[0]?.mfaVerifiedAt, null);
      assert.equal(
        sessionRows[0]?.tokenHashHex,
        hashSessionToken(result.sessionToken).toString('hex'),
      );
      assert.notEqual(sessionRows[0]?.tokenHashHex, result.sessionToken);
    });

    await test('unprovisioned and disabled admins are denied without account enumeration', async () => {
      const unprovisioned = {
        email: `missing-${randomUUID()}@example.test`,
        subject: `missing-${randomUUID()}`,
      };
      await request(
        createApp({
          logger: silentLogger,
          platformAdminAuthenticationService: createService(
            platformAdminRuntimeDatabase,
            unprovisioned,
          ),
        }),
      )
        .post('/v1/platform-admin/auth/google')
        .send({ idToken: 'valid-but-unprovisioned' })
        .expect(403);

      const disabled = await provisionAdmin(migrationDatabase, 'disabled');
      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admins SET status = 'DISABLED' WHERE id = :id`,
          { replacements: { id: disabled.id }, transaction },
        ),
      );
      await request(
        createApp({
          logger: silentLogger,
          platformAdminAuthenticationService: createService(platformAdminRuntimeDatabase, disabled),
        }),
      )
        .post('/v1/platform-admin/auth/google')
        .send({ idToken: 'valid-but-disabled-token' })
        .expect(403);
    });

    await test('expired, revoked and logged-out platform sessions are denied', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'session-state');
      const service = createService(platformAdminRuntimeDatabase, admin);
      const firstLogin = await login(platformAdminRuntimeDatabase, admin);
      const firstSession = await service.authenticateSession(firstLogin.sessionToken);
      assert.equal('tokenHash' in firstSession, false);

      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET revoked_at = now()
           WHERE id = :sessionId`,
          { replacements: { sessionId: firstSession.sessionId }, transaction },
        ),
      );
      await assert.rejects(service.authenticateSession(firstLogin.sessionToken));

      const secondLogin = await login(platformAdminRuntimeDatabase, admin);
      const secondSession = await service.authenticateSession(secondLogin.sessionToken);
      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET created_at = now() - interval '2 hours',
               expires_at = now() - interval '1 second',
               idle_expires_at = now() - interval '2 seconds'
           WHERE id = :sessionId`,
          { replacements: { sessionId: secondSession.sessionId }, transaction },
        ),
      );
      await assert.rejects(service.authenticateSession(secondLogin.sessionToken));

      const thirdLogin = await login(platformAdminRuntimeDatabase, admin);
      const app = createApp({ logger: silentLogger, platformAdminAuthenticationService: service });
      await request(app)
        .post('/v1/platform-admin/auth/logout')
        .set('Authorization', `Bearer ${thirdLogin.sessionToken}`)
        .expect(204);
      await request(app)
        .get('/v1/platform-admin/me')
        .set('Authorization', `Bearer ${thirdLogin.sessionToken}`)
        .expect(401);
    });

    await test('session activity is renewed without writing on every request', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'session-touch');
      const service = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await service.authenticateSession(loginResult.sessionToken);
      const readLastSeenAt = async (): Promise<Date> => {
        const rows = await withMigrationOwner(migrationDatabase, (transaction) =>
          migrationDatabase.query<{ lastSeenAt: Date }>(
            `SELECT last_seen_at AS "lastSeenAt"
             FROM metas.platform_admin_sessions
             WHERE id = :sessionId`,
            {
              replacements: { sessionId: session.sessionId },
              transaction,
              type: QueryTypes.SELECT,
            },
          ),
        );
        assert.ok(rows[0]);
        return rows[0].lastSeenAt;
      };

      const firstSeenAt = await readLastSeenAt();
      await service.authenticateSession(loginResult.sessionToken);
      assert.equal((await readLastSeenAt()).getTime(), firstSeenAt.getTime());

      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET created_at = created_at - interval '3 minutes',
               last_seen_at = now() - interval '2 minutes'
           WHERE id = :sessionId`,
          { replacements: { sessionId: session.sessionId }, transaction },
        ),
      );
      const staleSeenAt = await readLastSeenAt();
      await service.authenticateSession(loginResult.sessionToken);
      assert.ok((await readLastSeenAt()).getTime() > staleSeenAt.getTime());
    });

    await test('a session revoked after authentication is denied without an internal error', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'revocation-race');
      const service = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await service.authenticateSession(loginResult.sessionToken);

      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET revoked_at = now()
           WHERE id = :sessionId`,
          { replacements: { sessionId: session.sessionId }, transaction },
        ),
      );

      const isUnauthorized = (error: unknown): boolean =>
        error instanceof AppError && error.statusCode === 401 && error.code === 'UNAUTHORIZED';
      await assert.rejects(service.getMe(session), isUnauthorized);
      await assert.rejects(
        service.logout(session, {
          ipAddress: null,
          requestId: randomUUID(),
          userAgent: 'integration-test',
        }),
        isUnauthorized,
      );
    });

    await test('administrative context is transaction-local and tied to an active session', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'context');
      const service = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await service.authenticateSession(loginResult.sessionToken);

      const me = await service.getMe(session);
      assert.equal(me.id, admin.id);
      await assert.rejects(
        platformAdminRuntimeDatabase.query('SELECT * FROM metas.get_platform_admin_me()'),
      );

      await withPlatformAdminDatabaseContext(
        platformAdminRuntimeDatabase,
        { platformAdminId: session.platformAdminId, sessionId: session.sessionId },
        async (transaction) => {
          const rows = await platformAdminRuntimeDatabase.query<{ id: string }>(
            'SELECT id FROM metas.get_platform_admin_me()',
            { transaction, type: QueryTypes.SELECT },
          );
          assert.equal(rows[0]?.id, admin.id);
        },
      );

      await assert.rejects(
        platformAdminRuntimeDatabase.query('SELECT * FROM metas.get_platform_admin_me()'),
      );
      await assert.rejects(
        withPlatformAdminDatabaseContext(
          platformAdminRuntimeDatabase,
          { platformAdminId: randomUUID(), sessionId: randomUUID() },
          (transaction) =>
            platformAdminRuntimeDatabase.query('SELECT * FROM metas.get_platform_admin_me()', {
              transaction,
            }),
        ),
      );
    });

    await test('WebAuthn enrollment, MFA, replay protection and token rotation are enforced', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'webauthn');
      const authenticationService = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const googleOnlySession = await authenticationService.authenticateSession(
        loginResult.sessionToken,
      );
      const adapter = new FakeWebAuthnAdapter();
      const webAuthnService = new PostgresPlatformAdminWebAuthnService(
        platformAdminRuntimeDatabase,
        adapter,
        {
          allowedOrigins: ['https://admin.example.test'],
          challengeTtlSeconds: 300,
          rpId: 'admin.example.test',
          rpName: 'Metas Admin',
          stepUpTtlSeconds: 300,
        },
      );

      await assert.rejects(webAuthnService.createAuthenticationOptions(googleOnlySession));
      const options = await webAuthnService.createRegistrationOptions(googleOnlySession);
      const registration = await webAuthnService.verifyRegistration(
        googleOnlySession,
        options.challengeId,
        registrationResponse,
        'Passkey de integração',
        { ipAddress: null, requestId: randomUUID(), userAgent: 'integration-test' },
      );
      assert.equal(registration.assuranceLevel, 'MFA_VERIFIED');
      await assert.rejects(authenticationService.authenticateSession(loginResult.sessionToken));
      const mfaSession = await authenticationService.authenticateSession(registration.sessionToken);
      assert.equal(mfaSession.assuranceLevel, 'MFA_VERIFIED');
      assert.ok(mfaSession.mfaVerifiedAt);
      assert.ok(mfaSession.stepUpVerifiedAt);

      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET created_at = now() - interval '1 hour',
               mfa_verified_at = now() - interval '10 minutes',
               step_up_verified_at = now() - interval '10 minutes'
           WHERE id = :sessionId`,
          { replacements: { sessionId: mfaSession.sessionId }, transaction },
        ),
      );
      await assert.rejects(webAuthnService.createRegistrationOptions(mfaSession));
      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET mfa_verified_at = now(), step_up_verified_at = now()
           WHERE id = :sessionId`,
          { replacements: { sessionId: mfaSession.sessionId }, transaction },
        ),
      );
      assert.ok((await webAuthnService.createRegistrationOptions(mfaSession)).challengeId);

      const persisted = await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query<{
          challengeHashLength: number;
          credentialCount: string;
          tokenHashMatches: boolean;
          tokenVersion: string;
        }>(
          `SELECT
             (SELECT count(*)::TEXT FROM metas.platform_admin_webauthn_credentials
               WHERE platform_admin_id = :platformAdminId) AS "credentialCount",
             (SELECT octet_length(challenge_hash)
               FROM metas.platform_admin_webauthn_challenges
               WHERE id = :challengeId) AS "challengeHashLength",
             (SELECT token_hash = :tokenHash FROM metas.platform_admin_sessions
               WHERE id = :sessionId) AS "tokenHashMatches",
             (SELECT token_version::TEXT FROM metas.platform_admin_sessions
               WHERE id = :sessionId) AS "tokenVersion"`,
          {
            replacements: {
              challengeId: options.challengeId,
              platformAdminId: admin.id,
              sessionId: mfaSession.sessionId,
              tokenHash: hashSessionToken(registration.sessionToken),
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      assert.deepEqual(persisted[0], {
        challengeHashLength: 32,
        credentialCount: '1',
        tokenHashMatches: true,
        tokenVersion: '1',
      });
      assert.doesNotMatch(JSON.stringify(persisted), /registration-|integration_credential_id/u);

      const nextLogin = await login(platformAdminRuntimeDatabase, admin);
      const nextGoogleOnlySession = await authenticationService.authenticateSession(
        nextLogin.sessionToken,
      );
      adapter.authenticationChallenge = `authentication-${randomUUID()}`;
      const secondFactorOptions =
        await webAuthnService.createAuthenticationOptions(nextGoogleOnlySession);
      assert.equal(secondFactorOptions.purpose, 'AUTHENTICATION');
      const secondFactor = await webAuthnService.verifyAuthentication(
        nextGoogleOnlySession,
        secondFactorOptions.challengeId,
        {
          ...authenticationResponse,
          id: adapter.credentialId,
          rawId: adapter.credentialId,
        },
        { ipAddress: null, requestId: randomUUID(), userAgent: 'integration-test' },
      );
      await assert.rejects(authenticationService.authenticateSession(nextLogin.sessionToken));
      assert.equal(
        (await authenticationService.authenticateSession(secondFactor.sessionToken)).assuranceLevel,
        'MFA_VERIFIED',
      );

      adapter.authenticationChallenge = `authentication-${randomUUID()}`;
      const authenticationOptions = await webAuthnService.createAuthenticationOptions(mfaSession);
      assert.equal(authenticationOptions.purpose, 'STEP_UP');
      const stepUp = await webAuthnService.verifyAuthentication(
        mfaSession,
        authenticationOptions.challengeId,
        {
          ...authenticationResponse,
          id: adapter.credentialId,
          rawId: adapter.credentialId,
        },
        { ipAddress: null, requestId: randomUUID(), userAgent: 'integration-test' },
      );
      await assert.rejects(
        webAuthnService.verifyAuthentication(
          mfaSession,
          authenticationOptions.challengeId,
          {
            ...authenticationResponse,
            id: adapter.credentialId,
            rawId: adapter.credentialId,
          },
          { ipAddress: null, requestId: randomUUID(), userAgent: 'integration-test' },
        ),
      );
      await assert.rejects(authenticationService.authenticateSession(registration.sessionToken));
      assert.equal(
        (await authenticationService.authenticateSession(stepUp.sessionToken)).assuranceLevel,
        'MFA_VERIFIED',
      );
      const auditEvents = await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query<{ action: string; metadata: Record<string, unknown> }>(
          `SELECT action, metadata
           FROM metas.platform_admin_audit_events
           WHERE platform_admin_id = :adminId
           ORDER BY created_at, id`,
          {
            replacements: { adminId: admin.id },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      const actions = auditEvents.map(({ action }) => action);
      assert.ok(actions.includes('WEBAUTHN_CREDENTIAL_REGISTERED'));
      assert.ok(actions.includes('WEBAUTHN_AUTHENTICATION_SUCCESS'));
      assert.ok(actions.includes('WEBAUTHN_STEP_UP_SUCCESS'));
      assert.ok(actions.includes('WEBAUTHN_STEP_UP_FAILURE'));
      assert.doesNotMatch(
        JSON.stringify(auditEvents),
        /challenge|publicKey|sessionToken|tokenHash|authorization/iu,
      );
    });

    await test('WebAuthn challenges are bound to their administrative session', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'webauthn-session-binding');
      const authenticationService = createService(platformAdminRuntimeDatabase, admin);
      const firstLogin = await login(platformAdminRuntimeDatabase, admin);
      const secondLogin = await login(platformAdminRuntimeDatabase, admin);
      const firstSession = await authenticationService.authenticateSession(firstLogin.sessionToken);
      const secondSession = await authenticationService.authenticateSession(
        secondLogin.sessionToken,
      );
      const webAuthnService = new PostgresPlatformAdminWebAuthnService(
        platformAdminRuntimeDatabase,
        new FakeWebAuthnAdapter(),
        {
          allowedOrigins: ['https://admin.example.test'],
          challengeTtlSeconds: 300,
          rpId: 'admin.example.test',
          rpName: 'Metas Admin',
          stepUpTtlSeconds: 300,
        },
      );
      const options = await webAuthnService.createRegistrationOptions(firstSession);
      await assert.rejects(
        webAuthnService.verifyRegistration(
          secondSession,
          options.challengeId,
          registrationResponse,
          null,
          { ipAddress: null, requestId: randomUUID(), userAgent: null },
        ),
      );
    });

    await test('WebAuthn challenge purpose, expiration and concurrent reuse are denied', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'webauthn-challenge');
      const authenticationService = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await authenticationService.authenticateSession(loginResult.sessionToken);
      const adapter = new FakeWebAuthnAdapter();
      const webAuthnService = new PostgresPlatformAdminWebAuthnService(
        platformAdminRuntimeDatabase,
        adapter,
        {
          allowedOrigins: ['https://admin.example.test'],
          challengeTtlSeconds: 300,
          rpId: 'admin.example.test',
          rpName: 'Metas Admin',
          stepUpTtlSeconds: 300,
        },
      );
      const wrongPurpose = await webAuthnService.createRegistrationOptions(session);
      await assert.rejects(
        withPlatformAdminDatabaseContext(
          platformAdminRuntimeDatabase,
          { platformAdminId: session.platformAdminId, sessionId: session.sessionId },
          (transaction) =>
            platformAdminRuntimeDatabase.query(
              `SELECT * FROM metas.consume_platform_admin_webauthn_challenge(
                CAST(:challengeId AS UUID), 'AUTHENTICATION'
              )`,
              {
                replacements: { challengeId: wrongPurpose.challengeId },
                transaction,
              },
            ),
        ),
      );

      const expired = await webAuthnService.createRegistrationOptions(session);
      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_webauthn_challenges
           SET created_at = now() - interval '6 minutes',
               expires_at = now() - interval '1 minute'
           WHERE id = :challengeId`,
          { replacements: { challengeId: expired.challengeId }, transaction },
        ),
      );
      await assert.rejects(
        webAuthnService.verifyRegistration(
          session,
          expired.challengeId,
          registrationResponse,
          null,
          { ipAddress: null, requestId: randomUUID(), userAgent: null },
        ),
      );

      const concurrent = await webAuthnService.createRegistrationOptions(session);
      const attempts = await Promise.allSettled(
        Array.from({ length: 2 }, () =>
          webAuthnService.verifyRegistration(
            session,
            concurrent.challengeId,
            registrationResponse,
            null,
            { ipAddress: null, requestId: randomUUID(), userAgent: null },
          ),
        ),
      );
      assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
      assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
    });

    await test('WebAuthn credential IDs are globally unique without account disclosure', async () => {
      const sharedCredentialId = `shared_${randomUUID().replaceAll('-', '')}`;
      const firstAdmin = await provisionAdmin(migrationDatabase, 'webauthn-unique-a');
      const secondAdmin = await provisionAdmin(migrationDatabase, 'webauthn-unique-b');
      const enroll = async (admin: ProvisionedAdmin): Promise<PromiseSettledResult<unknown>> => {
        const authenticationService = createService(platformAdminRuntimeDatabase, admin);
        const loginResult = await login(platformAdminRuntimeDatabase, admin);
        const session = await authenticationService.authenticateSession(loginResult.sessionToken);
        const service = new PostgresPlatformAdminWebAuthnService(
          platformAdminRuntimeDatabase,
          new FakeWebAuthnAdapter(sharedCredentialId),
          {
            allowedOrigins: ['https://admin.example.test'],
            challengeTtlSeconds: 300,
            rpId: 'admin.example.test',
            rpName: 'Metas Admin',
            stepUpTtlSeconds: 300,
          },
        );
        const options = await service.createRegistrationOptions(session);
        try {
          const value = await service.verifyRegistration(
            session,
            options.challengeId,
            registrationResponse,
            null,
            { ipAddress: null, requestId: randomUUID(), userAgent: null },
          );
          return { status: 'fulfilled', value };
        } catch (reason: unknown) {
          return { reason, status: 'rejected' };
        }
      };

      assert.equal((await enroll(firstAdmin)).status, 'fulfilled');
      const duplicate = await enroll(secondAdmin);
      assert.equal(duplicate.status, 'rejected');
      if (duplicate.status === 'rejected') {
        assert.ok(duplicate.reason instanceof AppError);
        assert.equal(duplicate.reason.code, 'WEBAUTHN_VERIFICATION_DENIED');
        assert.doesNotMatch(duplicate.reason.message, /admin|credential|unique|duplicate/iu);
      }
    });

    await test('concurrent WebAuthn counters cannot overwrite a newer credential state', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'webauthn-counter-race');
      const authenticationService = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const googleOnlySession = await authenticationService.authenticateSession(
        loginResult.sessionToken,
      );
      const adapter = new FakeWebAuthnAdapter();
      const service = new PostgresPlatformAdminWebAuthnService(
        platformAdminRuntimeDatabase,
        adapter,
        {
          allowedOrigins: ['https://admin.example.test'],
          challengeTtlSeconds: 300,
          rpId: 'admin.example.test',
          rpName: 'Metas Admin',
          stepUpTtlSeconds: 300,
        },
      );
      const registrationOptions = await service.createRegistrationOptions(googleOnlySession);
      const enrollment = await service.verifyRegistration(
        googleOnlySession,
        registrationOptions.challengeId,
        registrationResponse,
        null,
        { ipAddress: null, requestId: randomUUID(), userAgent: null },
      );
      const firstMfaSession = await authenticationService.authenticateSession(
        enrollment.sessionToken,
      );
      const secondLogin = await login(platformAdminRuntimeDatabase, admin);
      const secondGoogleOnlySession = await authenticationService.authenticateSession(
        secondLogin.sessionToken,
      );
      adapter.authenticationChallenge = `authentication-${randomUUID()}`;
      const secondFactorOptions =
        await service.createAuthenticationOptions(secondGoogleOnlySession);
      const secondFactor = await service.verifyAuthentication(
        secondGoogleOnlySession,
        secondFactorOptions.challengeId,
        {
          ...authenticationResponse,
          id: adapter.credentialId,
          rawId: adapter.credentialId,
        },
        { ipAddress: null, requestId: randomUUID(), userAgent: null },
      );
      const secondMfaSession = await authenticationService.authenticateSession(
        secondFactor.sessionToken,
      );
      adapter.authenticationChallenge = `authentication-${randomUUID()}`;
      const first = await service.createAuthenticationOptions(firstMfaSession);
      adapter.authenticationChallenge = `authentication-${randomUUID()}`;
      const second = await service.createAuthenticationOptions(secondMfaSession);
      adapter.waitForConcurrentVerifications(2);
      const assertion = {
        ...authenticationResponse,
        id: adapter.credentialId,
        rawId: adapter.credentialId,
      };
      const attempts = await Promise.allSettled([
        service.verifyAuthentication(firstMfaSession, first.challengeId, assertion, {
          ipAddress: null,
          requestId: randomUUID(),
          userAgent: null,
        }),
        service.verifyAuthentication(secondMfaSession, second.challengeId, assertion, {
          ipAddress: null,
          requestId: randomUUID(),
          userAgent: null,
        }),
      ]);
      assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
      assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
    });

    await test('concurrent WebAuthn flows cannot rotate the same session twice', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'webauthn-session-rotation-race');
      const authenticationService = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const googleOnlySession = await authenticationService.authenticateSession(
        loginResult.sessionToken,
      );
      const enrollmentAdapter = new FakeWebAuthnAdapter();
      const configuration = {
        allowedOrigins: ['https://admin.example.test'],
        challengeTtlSeconds: 300,
        rpId: 'admin.example.test',
        rpName: 'Metas Admin',
        stepUpTtlSeconds: 300,
      } as const;
      const enrollmentService = new PostgresPlatformAdminWebAuthnService(
        platformAdminRuntimeDatabase,
        enrollmentAdapter,
        configuration,
      );
      const enrollmentOptions =
        await enrollmentService.createRegistrationOptions(googleOnlySession);
      const enrollment = await enrollmentService.verifyRegistration(
        googleOnlySession,
        enrollmentOptions.challengeId,
        registrationResponse,
        null,
        { ipAddress: null, requestId: randomUUID(), userAgent: null },
      );
      const mfaSession = await authenticationService.authenticateSession(enrollment.sessionToken);

      const concurrentAdapter = new FakeWebAuthnAdapter();
      const concurrentService = new PostgresPlatformAdminWebAuthnService(
        platformAdminRuntimeDatabase,
        concurrentAdapter,
        configuration,
      );
      const registrationOptions = await concurrentService.createRegistrationOptions(mfaSession);
      concurrentAdapter.authenticationChallenge = `authentication-${randomUUID()}`;
      const authenticationOptions = await concurrentService.createAuthenticationOptions(mfaSession);
      concurrentAdapter.waitForConcurrentVerifications(2);

      const attempts = await Promise.allSettled([
        concurrentService.verifyRegistration(
          mfaSession,
          registrationOptions.challengeId,
          registrationResponse,
          null,
          { ipAddress: null, requestId: randomUUID(), userAgent: null },
        ),
        concurrentService.verifyAuthentication(
          mfaSession,
          authenticationOptions.challengeId,
          {
            ...authenticationResponse,
            id: enrollmentAdapter.credentialId,
            rawId: enrollmentAdapter.credentialId,
          },
          { ipAddress: null, requestId: randomUUID(), userAgent: null },
        ),
      ]);

      assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
      assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
      const successful = attempts.find((result) => result.status === 'fulfilled');
      assert.equal(successful?.status, 'fulfilled');
      if (!successful || successful.status !== 'fulfilled') {
        throw new Error('Expected one successful WebAuthn session rotation.');
      }
      await assert.rejects(authenticationService.authenticateSession(enrollment.sessionToken));
      assert.equal(
        (await authenticationService.authenticateSession(successful.value.sessionToken))
          .assuranceLevel,
        'MFA_VERIFIED',
      );
    });

    await test('disabled admin and revoked session cannot complete WebAuthn', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'webauthn-revocation');
      const authenticationService = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await authenticationService.authenticateSession(loginResult.sessionToken);
      const adapter = new FakeWebAuthnAdapter();
      const service = new PostgresPlatformAdminWebAuthnService(
        platformAdminRuntimeDatabase,
        adapter,
        {
          allowedOrigins: ['https://admin.example.test'],
          challengeTtlSeconds: 300,
          rpId: 'admin.example.test',
          rpName: 'Metas Admin',
          stepUpTtlSeconds: 300,
        },
      );
      const options = await service.createRegistrationOptions(session);
      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admins SET status = 'DISABLED' WHERE id = :adminId`,
          { replacements: { adminId: admin.id }, transaction },
        ),
      );
      await assert.rejects(
        service.verifyRegistration(session, options.challengeId, registrationResponse, null, {
          ipAddress: null,
          requestId: randomUUID(),
          userAgent: null,
        }),
      );

      await withMigrationOwner(migrationDatabase, async (transaction) => {
        await migrationDatabase.query(
          `UPDATE metas.platform_admins SET status = 'ACTIVE' WHERE id = :adminId`,
          { replacements: { adminId: admin.id }, transaction },
        );
        await migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions SET revoked_at = now() WHERE id = :sessionId`,
          { replacements: { sessionId: session.sessionId }, transaction },
        );
      });
      await assert.rejects(service.createRegistrationOptions(session));
    });

    await test('revoked credentials are excluded from WebAuthn authentication', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'webauthn-revoked-credential');
      const authenticationService = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await authenticationService.authenticateSession(loginResult.sessionToken);
      const adapter = new FakeWebAuthnAdapter();
      const service = new PostgresPlatformAdminWebAuthnService(
        platformAdminRuntimeDatabase,
        adapter,
        {
          allowedOrigins: ['https://admin.example.test'],
          challengeTtlSeconds: 300,
          rpId: 'admin.example.test',
          rpName: 'Metas Admin',
          stepUpTtlSeconds: 300,
        },
      );
      const options = await service.createRegistrationOptions(session);
      const enrollment = await service.verifyRegistration(
        session,
        options.challengeId,
        registrationResponse,
        null,
        { ipAddress: null, requestId: randomUUID(), userAgent: null },
      );
      const elevatedSession = await authenticationService.authenticateSession(
        enrollment.sessionToken,
      );
      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_webauthn_credentials
           SET revoked_at = now()
           WHERE platform_admin_id = :adminId`,
          { replacements: { adminId: admin.id }, transaction },
        ),
      );
      await assert.rejects(service.createAuthenticationOptions(elevatedSession));
    });

    await test('failed origin, RP ID or missing user verification never elevates assurance', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'webauthn-invalid-assertion');
      const authenticationService = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await authenticationService.authenticateSession(loginResult.sessionToken);
      const adapter = new FakeWebAuthnAdapter();
      adapter.rejectRegistration = true;
      const service = new PostgresPlatformAdminWebAuthnService(
        platformAdminRuntimeDatabase,
        adapter,
        {
          allowedOrigins: ['https://admin.example.test'],
          challengeTtlSeconds: 300,
          rpId: 'admin.example.test',
          rpName: 'Metas Admin',
          stepUpTtlSeconds: 300,
        },
      );
      const options = await service.createRegistrationOptions(session);
      await assert.rejects(
        service.verifyRegistration(session, options.challengeId, registrationResponse, null, {
          ipAddress: null,
          requestId: randomUUID(),
          userAgent: null,
        }),
      );
      assert.equal(
        (await authenticationService.authenticateSession(loginResult.sessionToken)).assuranceLevel,
        'GOOGLE_ONLY',
      );

      adapter.rejectRegistration = false;
      adapter.registrationUserVerified = false;
      const registrationWithoutUserVerification = await service.createRegistrationOptions(session);
      await assert.rejects(
        service.verifyRegistration(
          session,
          registrationWithoutUserVerification.challengeId,
          registrationResponse,
          null,
          { ipAddress: null, requestId: randomUUID(), userAgent: null },
        ),
      );
      assert.equal(
        (await authenticationService.authenticateSession(loginResult.sessionToken)).assuranceLevel,
        'GOOGLE_ONLY',
      );

      adapter.registrationUserVerified = true;
      const validRegistrationOptions = await service.createRegistrationOptions(session);
      await service.verifyRegistration(
        session,
        validRegistrationOptions.challengeId,
        registrationResponse,
        null,
        { ipAddress: null, requestId: randomUUID(), userAgent: null },
      );
      const secondLogin = await login(platformAdminRuntimeDatabase, admin);
      const secondGoogleOnlySession = await authenticationService.authenticateSession(
        secondLogin.sessionToken,
      );
      adapter.authenticationUserVerified = false;
      adapter.authenticationChallenge = `authentication-${randomUUID()}`;
      const authenticationWithoutUserVerification =
        await service.createAuthenticationOptions(secondGoogleOnlySession);
      await assert.rejects(
        service.verifyAuthentication(
          secondGoogleOnlySession,
          authenticationWithoutUserVerification.challengeId,
          {
            ...authenticationResponse,
            id: adapter.credentialId,
            rawId: adapter.credentialId,
          },
          { ipAddress: null, requestId: randomUUID(), userAgent: null },
        ),
      );
      assert.equal(
        (await authenticationService.authenticateSession(secondLogin.sessionToken)).assuranceLevel,
        'GOOGLE_ONLY',
      );
    });

    await test('platform admin role, RLS, function grants and audit log remain least-privileged', async () => {
      const roles = await migrationDatabase.query<{
        bypassRls: boolean;
        canCreateDatabase: boolean;
        canCreateRole: boolean;
        canLogin: boolean;
        canReplicate: boolean;
        isSuperuser: boolean;
      }>(
        `SELECT
          rolsuper AS "isSuperuser",
          rolcreatedb AS "canCreateDatabase",
          rolcreaterole AS "canCreateRole",
          rolcanlogin AS "canLogin",
          rolreplication AS "canReplicate",
          rolbypassrls AS "bypassRls"
         FROM pg_roles
         WHERE rolname = 'metas_platform_admin_runtime'`,
        { type: QueryTypes.SELECT },
      );
      assert.deepEqual(roles[0], {
        bypassRls: false,
        canCreateDatabase: false,
        canCreateRole: false,
        canLogin: true,
        canReplicate: false,
        isSuperuser: false,
      });

      const tables = await migrationDatabase.query<{
        forceRls: boolean;
        owner: string;
        rls: boolean;
        tableName: string;
      }>(
        `SELECT
          relation.relname AS "tableName",
          owner.rolname AS owner,
          relation.relrowsecurity AS rls,
          relation.relforcerowsecurity AS "forceRls"
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         JOIN pg_roles owner ON owner.oid = relation.relowner
         WHERE namespace.nspname = 'metas'
           AND relation.relname LIKE 'platform_admin%'
           AND relation.relkind = 'r'
         ORDER BY relation.relname`,
        { type: QueryTypes.SELECT },
      );
      assert.equal(tables.length, 6);
      assert.ok(
        tables.every(
          ({ forceRls, owner, rls }) => forceRls && rls && owner === 'metas_migration_owner',
        ),
      );

      for (const table of [
        'platform_admins',
        'platform_admin_identities',
        'platform_admin_sessions',
        'platform_admin_audit_events',
        'platform_admin_webauthn_challenges',
        'platform_admin_webauthn_credentials',
      ]) {
        await assert.rejects(platformAdminRuntimeDatabase.query(`SELECT * FROM metas.${table}`));
      }
      await assert.rejects(
        platformAdminRuntimeDatabase.query(
          `UPDATE metas.platform_admin_audit_events SET outcome = 'FAILURE'`,
        ),
      );
      await assert.rejects(
        platformAdminRuntimeDatabase.query('DELETE FROM metas.platform_admin_audit_events'),
      );
      await assert.rejects(
        runtimeDatabase.query(
          `SELECT * FROM metas.resolve_platform_admin_session(:tokenHash, 900)`,
          { replacements: { tokenHash: randomBytes(32) } },
        ),
      );

      const functions = await migrationDatabase.query<{
        appCanExecute: boolean;
        functionName: string;
        migrationCanExecute: boolean;
        owner: string;
        platformCanExecute: boolean;
        publicCanExecute: boolean;
        searchPath: string[] | null;
      }>(
        `SELECT
          procedure.proname AS "functionName",
          owner.rolname AS owner,
          has_function_privilege('public', procedure.oid, 'EXECUTE') AS "publicCanExecute",
          has_function_privilege(
            'metas_app_runtime', procedure.oid, 'EXECUTE'
          ) AS "appCanExecute",
          has_function_privilege(
            'metas_platform_admin_runtime', procedure.oid, 'EXECUTE'
          ) AS "platformCanExecute",
          has_function_privilege(
            'metas_migration_runner', procedure.oid, 'EXECUTE'
          ) AS "migrationCanExecute",
          procedure.proconfig AS "searchPath"
         FROM pg_proc procedure
         JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
         JOIN pg_roles owner ON owner.oid = procedure.proowner
         WHERE namespace.nspname = 'metas'
           AND procedure.proname IN (
             'authenticate_platform_admin_google',
             'bootstrap_platform_admin',
             'resolve_platform_admin_session',
             'require_platform_admin_context',
             'get_platform_admin_me',
             'revoke_platform_admin_session',
             'list_platform_admin_webauthn_credentials',
             'create_platform_admin_webauthn_challenge',
             'consume_platform_admin_webauthn_challenge',
             'register_platform_admin_webauthn_credential',
             'complete_platform_admin_webauthn_authentication',
             'record_platform_admin_webauthn_failure'
           )
         ORDER BY procedure.proname`,
        { type: QueryTypes.SELECT },
      );
      assert.equal(functions.length, 12);
      assert.ok(
        functions.every(
          ({ appCanExecute, owner, publicCanExecute, searchPath }) =>
            !appCanExecute &&
            owner === 'metas_migration_owner' &&
            !publicCanExecute &&
            searchPath?.includes('search_path=pg_catalog') === true,
        ),
      );
      const byName = new Map(functions.map((item) => [item.functionName, item]));
      assert.equal(byName.get('bootstrap_platform_admin')?.migrationCanExecute, true);
      assert.equal(byName.get('bootstrap_platform_admin')?.platformCanExecute, false);
      assert.equal(byName.get('require_platform_admin_context')?.migrationCanExecute, false);
      assert.equal(byName.get('require_platform_admin_context')?.platformCanExecute, false);
      for (const functionName of [
        'authenticate_platform_admin_google',
        'get_platform_admin_me',
        'resolve_platform_admin_session',
        'revoke_platform_admin_session',
        'list_platform_admin_webauthn_credentials',
        'create_platform_admin_webauthn_challenge',
        'consume_platform_admin_webauthn_challenge',
        'register_platform_admin_webauthn_credential',
        'complete_platform_admin_webauthn_authentication',
        'record_platform_admin_webauthn_failure',
      ]) {
        assert.equal(byName.get(functionName)?.platformCanExecute, true);
        assert.equal(byName.get(functionName)?.migrationCanExecute, false);
      }
    });

    await test('successful authentication events are append-only and sanitized', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'audit');
      const result = await login(platformAdminRuntimeDatabase, admin);
      const service = createService(platformAdminRuntimeDatabase, admin);
      const session: PlatformAdminSession = await service.authenticateSession(result.sessionToken);
      await service.logout(session, {
        ipAddress: null,
        requestId: randomUUID(),
        userAgent: 'integration-test',
      });

      const events = await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query<{ action: string; metadata: Record<string, unknown> }>(
          `SELECT action, metadata
           FROM metas.platform_admin_audit_events
           WHERE platform_admin_id = :platformAdminId
           ORDER BY created_at, id`,
          {
            replacements: { platformAdminId: admin.id },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      assert.deepEqual(
        events.map(({ action }) => action),
        ['PLATFORM_ADMIN_LOGIN', 'PLATFORM_ADMIN_LOGOUT'],
      );
      assert.doesNotMatch(JSON.stringify(events), /token|password|secret|google-id/u);
    });
  } finally {
    await Promise.all([
      disconnectDatabase(platformAdminRuntimeDatabase),
      disconnectDatabase(runtimeDatabase),
      disconnectDatabase(migrationDatabase),
    ]);
  }
}
