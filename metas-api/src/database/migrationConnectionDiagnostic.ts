const nodeNetworkCodes = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

const tlsCodes = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export type MigrationConnectionDiagnosticCategory =
  | 'autenticacao_ou_pg_hba'
  | 'autenticacao_usuario_ou_senha'
  | 'banco_inexistente'
  | 'configuracao_de_ambiente'
  | 'conexao_e_role_de_migration_validos'
  | 'dns_host_nao_encontrado'
  | 'dns_indisponivel_temporariamente'
  | 'erro_de_conexao_nao_classificado'
  | 'permissao_postgresql'
  | 'politica_do_role_de_migration'
  | 'rede_conexao_interrompida'
  | 'rede_conexao_recusada'
  | 'rede_host_inacessivel'
  | 'rede_timeout'
  | 'tls_ou_certificado';

export interface MigrationConnectionDiagnostic {
  category: MigrationConnectionDiagnosticCategory;
  code: string | null;
  errorType: string | null;
}

const readProperty = (value: unknown, property: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, property) : undefined;

const errorChain = (error: unknown): readonly unknown[] =>
  [
    error,
    readProperty(error, 'parent'),
    readProperty(error, 'original'),
    readProperty(error, 'cause'),
  ].filter((value) => value !== undefined && value !== null);

const safeErrorType = (error: unknown): string => {
  const name = readProperty(error, 'name');
  return typeof name === 'string' &&
    /^(?:AggregateError|Error|TypeError|Sequelize[A-Za-z]+Error)$/u.test(name)
    ? name
    : 'UnknownError';
};

const safeErrorCode = (chain: readonly unknown[]): string | null => {
  const code = chain
    .map((error) => readProperty(error, 'code'))
    .find((value): value is string => typeof value === 'string');

  if (!code) {
    return null;
  }
  if (/^[0-9A-Z]{5}$/u.test(code) || nodeNetworkCodes.has(code) || tlsCodes.has(code)) {
    return code;
  }
  return null;
};

const internalMessages = (chain: readonly unknown[]): string =>
  chain
    .map((error) => readProperty(error, 'message'))
    .filter((message): message is string => typeof message === 'string')
    .join(' ')
    .toLowerCase();

export const successfulMigrationConnectionDiagnostic = (): MigrationConnectionDiagnostic => ({
  errorType: null,
  code: null,
  category: 'conexao_e_role_de_migration_validos',
});

export const classifyMigrationConnectionError = (error: unknown): MigrationConnectionDiagnostic => {
  const chain = errorChain(error);
  const code = safeErrorCode(chain);
  const errorType = safeErrorType(error);
  const messages = internalMessages(chain);

  let category: MigrationConnectionDiagnosticCategory;
  if (code === '28P01') {
    category = 'autenticacao_usuario_ou_senha';
  } else if (code === '28000') {
    category = 'autenticacao_ou_pg_hba';
  } else if (code === '3D000') {
    category = 'banco_inexistente';
  } else if (code === '42501') {
    category = 'permissao_postgresql';
  } else if (messages.includes('invalid environment configuration')) {
    category = 'configuracao_de_ambiente';
  } else if (
    messages.includes('migration login does not satisfy the required least privilege policy')
  ) {
    category = 'politica_do_role_de_migration';
  } else if (errorType === 'SequelizeConnectionRefusedError' || code === 'ECONNREFUSED') {
    category = 'rede_conexao_recusada';
  } else if (errorType === 'SequelizeHostNotFoundError' || code === 'ENOTFOUND') {
    category = 'dns_host_nao_encontrado';
  } else if (code === 'EAI_AGAIN') {
    category = 'dns_indisponivel_temporariamente';
  } else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    category = 'rede_host_inacessivel';
  } else if (errorType === 'SequelizeConnectionTimedOutError' || code === 'ETIMEDOUT') {
    category = 'rede_timeout';
  } else if (code === 'ECONNRESET') {
    category = 'rede_conexao_interrompida';
  } else if (
    (code !== null && tlsCodes.has(code)) ||
    messages.includes('certificate') ||
    messages.includes('tls') ||
    messages.includes('ssl')
  ) {
    category = 'tls_ou_certificado';
  } else {
    category = 'erro_de_conexao_nao_classificado';
  }

  return { errorType, code, category };
};
