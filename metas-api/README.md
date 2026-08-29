# Metas API

Backend privado do aplicativo de metas. O projeto usa Express, TypeScript strict, Sequelize e PostgreSQL sem sincronização automática de schema.

## Requisitos

- Node.js 20.18 ou superior
- npm
- PostgreSQL 13 ou superior
- extensões PostgreSQL `citext` e `btree_gist`

## Instalação

```bash
npm install
```

Crie o arquivo local `.env` a partir de `.env.example`. O `.env` não é versionado e os exemplos não são credenciais reais.

## Credenciais do banco

Cada finalidade utiliza um login PostgreSQL diferente:

```text
DATABASE_URL             API em runtime
MIGRATION_DATABASE_URL   execução de migrations
ADMIN_DATABASE_URL       bootstrap explícito da infraestrutura PostgreSQL
```

`metas_migration_owner` é `NOLOGIN` e proprietário do schema e dos objetos. `metas_migration_runner` e `metas_app_runtime` são os logins separados usados, respectivamente, por migrations e pela API. O bootstrap não define senhas; credenciais e permissão de conexão são configuradas localmente pela administração do PostgreSQL e nunca ficam no repositório.

O bootstrap remove atributos elevados desses logins. A API e o migrator também verificam na conexão real o nome exato do role, `LOGIN`, ausência de superuser, `BYPASSRLS`, criação de roles/bancos e replicação, além das memberships incompatíveis.

O provisionamento externo também deve conceder `CONNECT` somente no banco apropriado. O login de migrations herda apenas os privilégios diretos do runner e usa `SET LOCAL ROLE metas_migration_owner` dentro de cada transação de migration para executar DDL.

A API lê somente `DATABASE_URL`. O bootstrap administrativo e as migrations nunca são executados durante a inicialização HTTP.

## Bootstrap administrativo

Com uma conexão administrativa explícita configurada em `ADMIN_DATABASE_URL`:

```bash
npm run db:admin:bootstrap
```

Esse comando prepara:

- role `NOLOGIN` de ownership e roles `LOGIN` separados para migrations e runtime;
- extensões `citext` e `btree_gist` no schema `public`;
- schema `metas`;
- tabela de controle `metas.schema_migrations`;
- grants fundamentais e default privileges.

Ele cria os roles PostgreSQL, mas não define senhas, não cria bancos nem tabelas de negócio e não roda automaticamente. O comando exige privilégios administrativos e falha sem eles.

Somente `CREATE` é revogado de `PUBLIC` no schema `public`; `USAGE` é preservado para os objetos das extensões. No schema `metas`, `CREATE` e `USAGE` de `PUBLIC` são revogados e concedidos explicitamente aos roles necessários.

## Migrations

As migrations TypeScript são executadas pelo Umzug e registradas em `metas.schema_migrations`:

```bash
npm run db:migrate
npm run db:migrate:status
```

No Northflank, o diagnóstico seguro valida somente a conexão e o role de migration. A consulta de status também é somente leitura; apenas o comando de aplicação executa migrations:

```bash
npm run db:migrate:diagnose:northflank
npm run db:migrate:status:northflank
npm run db:migrate:northflank
```

Não há scripts de reset, drop ou force. O projeto não usa `sequelize.sync()`, `sync({ force: true })` ou `sync({ alter: true })`.

O schema inicial contém:

```text
stores
users
auth_identities
employees
sessions
```

## RLS

As cinco tabelas usam `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`.

O role `metas_app_runtime` é `NOBYPASSRLS`, não é owner das tabelas e recebe somente `SELECT` nesta etapa. As escritas de autenticação serão concedidas apenas quando seus fluxos forem implementados.

Operações tenant-scoped usam `withDatabaseContext`, que abre uma transação e configura localmente:

```text
app.current_user_id
app.current_employee_id
app.current_store_id
```

Sem contexto válido e vínculo ativo, as policies não retornam linhas. Como os settings são locais à transação, uma conexão reutilizada pelo pool não herda o contexto anterior.

O futuro fluxo pré-login não utilizará `BYPASSRLS`; uma função limitada será definida na etapa de autenticação.

## Testes PostgreSQL

Os testes de integração exigem banco dedicado e conexões com privilégios separados:

```text
NODE_ENV diferente de production
TEST_DATABASE_URL
TEST_MIGRATION_DATABASE_URL
TEST_ADMIN_DATABASE_URL
TEST_DATABASE_SSL
```

O nome do banco nas duas URLs deve conter `test`, e as URLs não podem apontar para o mesmo host/porta/database das URLs normais correspondentes.

Antes da primeira execução no banco de teste, um administrador deve criar `metas_test`, configurar localmente as credenciais dos roles e executar:

```bash
npm run db:admin:bootstrap:test
npm run db:migrate:test
npm run test:integration
```

Sem as URLs de teste, a suíte PostgreSQL é marcada como não executada. Nenhum banco temporário ou credencial é inventado.

## Desenvolvimento

```bash
npm run dev
```

O servidor valida o ambiente, autentica a conexão PostgreSQL e somente depois abre a porta HTTP. Uma falha de conexão encerra a inicialização sem revelar a URL.

O endpoint público de infraestrutura é:

```http
GET /health
```

Ele retorna apenas `{ "status": "ok" }`. Os testes HTTP importam `app.ts` sem abrir uma porta ou conectar ao PostgreSQL.

## Deploy no Northflank

Use os comandos de producao:

```bash
npm run build
npm start
```

O servico HTTP escuta em `HOST=0.0.0.0` e na porta definida por `PORT`. Configure o port HTTP do servico com o mesmo valor e use `GET /health` para readiness/liveness. O proxy HTTPS do Northflank termina TLS na borda; `TRUST_PROXY_HOPS=1` permite ao Express considerar somente o salto do ingress ao interpretar o IP do cliente e aplicar o rate limit.

Variaveis de runtime do servico:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT
TRUST_PROXY_HOPS=1
DATABASE_URL
DATABASE_SSL=true
DATABASE_SSL_SERVERNAME (opcional, somente quando o hostname TLS difere do host da URL)
CORS_ORIGINS (opcional para origens web; o aplicativo nativo nao envia Origin)
GOOGLE_ALLOWED_CLIENT_IDS
SESSION_TTL_SECONDS
```

`DATABASE_URL` deve autenticar exclusivamente como `metas_app_runtime`. Variaveis administrativas e de migration nao pertencem ao servico HTTP. Em producao, a validacao de ambiente exige TLS do PostgreSQL, ao menos um Client ID Google, `HOST=0.0.0.0` e um proxy confiavel configurado.

O startup executa apenas a validacao do ambiente, a conexao com o banco e a verificacao de menor privilegio do runtime. Migrations e bootstrap administrativo permanecem comandos explicitos e nunca sao executados por `npm start`.

## Scripts

```text
npm run dev                 servidor em modo watch
npm run build               gera JavaScript em dist/
npm start                   executa dist/server.js
npm run lint                valida ESLint
npm run typecheck           valida TypeScript strict
npm test                    executa testes sem PostgreSQL
npm run test:integration    executa testes PostgreSQL reais
npm run db:admin:bootstrap  prepara infraestrutura administrativa
npm run db:admin:bootstrap:test prepara infraestrutura no banco exclusivo de teste
npm run db:migrate          aplica migrations pendentes
npm run db:migrate:status   lista migrations executadas/pendentes
npm run db:migrate:test     aplica migrations no banco de teste
npm run db:migrate:diagnose:northflank valida conexão e role de migration sem aplicar migrations
npm run db:migrate:status:northflank lista migrations sem aplicá-las
npm run db:migrate:northflank aplica migrations pendentes no Northflank
npm run format              formata arquivos
npm run format:check        verifica formatação
```

## Estrutura

```text
src/config            ambiente e conexão PostgreSQL
src/database/admin    bootstrap administrativo explícito
src/database/migrations migrations autoritativas
src/middleware        request ID, logging, 404 e erros
src/routes            rotas de infraestrutura
src/shared/database   contexto transacional para RLS
src/shared/errors     erros da aplicação
src/shared/logging    log técnico sanitizado
src/app.ts            configuração testável do Express
src/server.ts         conexão runtime, porta e encerramento
tests                 testes HTTP, unitários e PostgreSQL
```

Integração com o aplicativo mobile e endpoints de metas, campanhas e resultados ainda não fazem parte desta etapa.

## Autenticação HTTP

O backend valida Google ID Tokens com a biblioteca oficial `google-auth-library`. Configure os Client IDs públicos permitidos, separados por vírgula, sem Client Secret:

```text
GOOGLE_ALLOWED_CLIENT_IDS
SESSION_TTL_SECONDS
```

O TTL padrão da sessão é 604800 segundos (sete dias), limitado pela validação de ambiente. Sem Client IDs configurados, o endpoint retorna um erro controlado e não tenta aceitar tokens.

Rotas disponíveis:

```text
POST /v1/auth/google
POST /v1/auth/logout
GET  /v1/me
```

O login aceita somente `idToken`. O Google verifica assinatura, issuer, audience e expiração; o adapter exige ainda `sub`, e-mail e `email_verified`. Uma conta precisa ter sido previamente cadastrada. No primeiro acesso, o vínculo por e-mail verificado cria a identidade Google; depois disso, `provider_subject` é a identidade principal.

As sessões são opacas. O token aleatório de 32 bytes é retornado uma única vez, enquanto o PostgreSQL guarda somente seu hash SHA-256. Tokens são enviados exclusivamente em `Authorization: Bearer`. `last_seen_at` não é atualizado por request nesta etapa para evitar amplificação de escritas.

As operações anteriores ao contexto RLS usam funções `SECURITY DEFINER` específicas, pertencentes a `metas_migration_owner`, com `search_path` fixo, retorno mínimo, `EXECUTE` revogado de `PUBLIC` e concedido somente a `metas_app_runtime`. O runtime continua sem acesso global às tabelas e sem `BYPASSRLS`.

O login possui rate limit em memória adequado ao processo único do MVP. Antes de executar múltiplas instâncias, esse armazenamento deverá ser substituído por um mecanismo compartilhado.
