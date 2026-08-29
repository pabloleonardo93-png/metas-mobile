import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyMigrationConnectionError,
  successfulMigrationConnectionDiagnostic,
  type MigrationConnectionDiagnosticCategory,
} from '../src/database/migrationConnectionDiagnostic.js';

const connectionError = (code: string, message = 'private connection details'): Error => {
  const parent = Object.assign(new Error(message), { code });
  const error = new Error(message);
  error.name = 'SequelizeConnectionError';
  return Object.assign(error, { original: parent, parent });
};

await test('reports a successful connection without diagnostic details', () => {
  assert.deepEqual(successfulMigrationConnectionDiagnostic(), {
    category: 'conexao_e_role_de_migration_validos',
    code: null,
    errorType: null,
  });
});

const cases: ReadonlyArray<{
  category: MigrationConnectionDiagnosticCategory;
  code: string;
  label: string;
}> = [
  { category: 'autenticacao_usuario_ou_senha', code: '28P01', label: 'invalid credentials' },
  { category: 'autenticacao_ou_pg_hba', code: '28000', label: 'pg_hba authentication' },
  { category: 'banco_inexistente', code: '3D000', label: 'missing database' },
  { category: 'permissao_postgresql', code: '42501', label: 'database permission' },
  { category: 'rede_conexao_recusada', code: 'ECONNREFUSED', label: 'refused connection' },
  { category: 'dns_host_nao_encontrado', code: 'ENOTFOUND', label: 'unknown DNS host' },
  { category: 'rede_timeout', code: 'ETIMEDOUT', label: 'connection timeout' },
  {
    category: 'tls_ou_certificado',
    code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    label: 'TLS certificate error',
  },
];

for (const testCase of cases) {
  await test(`classifies ${testCase.label}`, () => {
    assert.deepEqual(classifyMigrationConnectionError(connectionError(testCase.code)), {
      category: testCase.category,
      code: testCase.code,
      errorType: 'SequelizeConnectionError',
    });
  });
}

await test('classifies an unknown error without exposing its message', () => {
  const error = new Error(
    'host=private.internal user=private password=private DATABASE_URL=postgresql://private',
  );
  const diagnostic = classifyMigrationConnectionError(error);

  assert.deepEqual(diagnostic, {
    category: 'erro_de_conexao_nao_classificado',
    code: null,
    errorType: 'Error',
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|DATABASE_URL|postgresql/u);
});

await test('sanitizes untrusted error names and codes before writing the diagnostic', () => {
  const error = new Error('password=private');
  error.name = 'private-host.internal';
  Object.assign(error, {
    parent: {
      code: 'PASSWORD_PRIVATE',
      message: 'postgresql://private',
    },
  });

  const diagnostic = classifyMigrationConnectionError(error);

  assert.deepEqual(diagnostic, {
    category: 'erro_de_conexao_nao_classificado',
    code: null,
    errorType: 'UnknownError',
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|password|postgresql/iu);
});

await test('uses messages only in memory to classify environment and role policy errors', () => {
  assert.equal(
    classifyMigrationConnectionError(
      new Error('Invalid environment configuration: NORTHFLANK_MIGRATION_DB_PASSWORD'),
    ).category,
    'configuracao_de_ambiente',
  );
  assert.equal(
    classifyMigrationConnectionError(
      new Error('PostgreSQL migration login does not satisfy the required least privilege policy.'),
    ).category,
    'politica_do_role_de_migration',
  );
});
