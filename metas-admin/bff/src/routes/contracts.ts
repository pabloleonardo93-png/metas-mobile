import { z } from 'zod';

const base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/u)
  .min(1)
  .max(65_536);
const authenticatorAttachmentSchema = z.enum(['cross-platform', 'platform']).optional();
const transportsSchema = z
  .array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']))
  .max(7)
  .optional();
const clientExtensionResultsSchema = z.record(z.string(), z.unknown());

const registrationResponseSchema = z
  .object({
    authenticatorAttachment: authenticatorAttachmentSchema,
    clientExtensionResults: clientExtensionResultsSchema,
    id: base64UrlSchema,
    rawId: base64UrlSchema,
    response: z
      .object({
        attestationObject: base64UrlSchema,
        authenticatorData: base64UrlSchema.optional(),
        clientDataJSON: base64UrlSchema,
        publicKey: base64UrlSchema.optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        transports: transportsSchema,
      })
      .strict(),
    type: z.literal('public-key'),
  })
  .strict();

const authenticationResponseSchema = z
  .object({
    authenticatorAttachment: authenticatorAttachmentSchema,
    clientExtensionResults: clientExtensionResultsSchema,
    id: base64UrlSchema,
    rawId: base64UrlSchema,
    response: z
      .object({
        authenticatorData: base64UrlSchema,
        clientDataJSON: base64UrlSchema,
        signature: base64UrlSchema,
        userHandle: base64UrlSchema.optional(),
      })
      .strict(),
    type: z.literal('public-key'),
  })
  .strict();

export const googleLoginSchema = z.object({ credential: z.string().min(20).max(16_384) }).strict();
export const emptyBodySchema = z.object({}).strict();
export const registrationVerificationSchema = z
  .object({
    challengeId: z.uuid(),
    friendlyName: z.string().trim().min(1).max(100).nullable().optional(),
    response: registrationResponseSchema,
  })
  .strict();
export const authenticationVerificationSchema = z
  .object({ challengeId: z.uuid(), response: authenticationResponseSchema })
  .strict();

export const adminMeSchema = z
  .object({
    assuranceLevel: z.enum(['GOOGLE_ONLY', 'MFA_VERIFIED']),
    displayName: z.string().min(1).max(200),
    hasWebAuthnCredential: z.boolean(),
    hasWebAuthnCredentialHistory: z.boolean(),
    id: z.uuid(),
    primaryEmail: z.email(),
    status: z.enum(['ACTIVE', 'DISABLED']),
  })
  .strict();

export const loginResponseSchema = z
  .object({
    admin: z
      .object({
        assuranceLevel: z.enum(['GOOGLE_ONLY', 'MFA_VERIFIED']),
        displayName: z.string().min(1).max(200),
        id: z.uuid(),
        primaryEmail: z.email(),
      })
      .strict(),
    expiresAt: z.iso.datetime(),
    sessionToken: z.string().min(32).max(1_024),
  })
  .strict();

export const registrationOptionsResponseSchema = z
  .object({ challengeId: z.uuid(), options: z.record(z.string(), z.unknown()) })
  .strict();
export const firstEnrollmentRequestResponseSchema = z
  .object({
    approvalExpiresAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime(),
    requestId: z.uuid(),
    status: z.enum(['APPROVED', 'PENDING']),
  })
  .strict();
export const mfaRecoveryRequestResponseSchema = z
  .object({
    approvalExpiresAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime(),
    requestId: z.uuid(),
    status: z.enum(['APPROVED', 'ENROLLMENT_STARTED', 'PENDING']),
  })
  .strict();
export const authenticationOptionsResponseSchema = z
  .object({
    challengeId: z.uuid(),
    options: z.record(z.string(), z.unknown()),
    purpose: z.enum(['AUTHENTICATION', 'STEP_UP']),
  })
  .strict();
export const verificationResponseSchema = z
  .object({
    assuranceLevel: z.literal('MFA_VERIFIED'),
    mfaVerifiedAt: z.iso.datetime(),
    sessionToken: z.string().min(32).max(1_024),
    stepUpVerifiedAt: z.iso.datetime(),
  })
  .strict();
