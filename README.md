# Metas

O Metas é um aplicativo para acompanhar metas de vendas, campanhas e equipes de uma loja. O repositório reúne o aplicativo Expo/React Native e uma API privada em Node.js, conectada ao PostgreSQL.

Gestores podem manter funcionários, configurar metas por cargo e administrar campanhas. Funcionários consultam os objetivos e o progresso correspondente ao próprio perfil. Alterações relevantes são propagadas por WebSocket para que as telas atualizem os dados sem depender de uma nova autenticação.

## Estrutura do repositório

```text
.
├── metas-mobile/       # aplicativo Expo e React Native
├── metas-api/          # API HTTP, WebSocket e migrations PostgreSQL
├── metas-admin/        # produto administrativo
│   ├── frontend/       # interface Vite, React e TypeScript
│   └── bff/            # sessão web segura e comunicação com a API
├── AGENTS.md           # orientações de desenvolvimento do repositório
└── README.md
```

Cada pacote possui seu próprio `package.json`, `package-lock.json`, testes e configuração TypeScript. Os comandos deste documento devem ser executados dentro do pacote indicado.

## Tecnologias

No aplicativo:

- Expo SDK 57 e Expo Router;
- React 19 e React Native 0.86;
- TypeScript;
- Expo SecureStore para a sessão local;
- EAS Build e EAS Update.

Na API:

- Node.js 20.18 ou superior;
- Express 5 e TypeScript;
- PostgreSQL 13 ou superior;
- Sequelize para acesso ao banco e Umzug para migrations;
- Zod para validação;
- WebSocket com o pacote `ws`;
- autenticação Google no servidor.

No painel administrativo:

- React 19, Vite e TypeScript;
- React Router e SimpleWebAuthn para o fluxo de passkeys;
- BFF Express separado, responsável pela sessão web e pela comunicação com a API;
- nenhuma conexão direta do navegador com o PostgreSQL ou com a `metas-api`.

O PostgreSQL precisa das extensões `citext` e `btree_gist`.

## Como o sistema está organizado

O aplicativo separa as funcionalidades por domínio, como autenticação, funcionários, metas e campanhas. Contextos React mantêm os dados compartilhados, enquanto os clientes de API concentram as chamadas HTTP. O Expo Router organiza a navegação entre as áreas de gestor e funcionário.

A API expõe rotas autenticadas e isola os dados por loja. O identificador da loja vem da sessão validada no servidor. O contexto da conexão PostgreSQL e as políticas de Row-Level Security reforçam esse isolamento no banco.

A autenticação começa com um ID token do Google. A API valida esse token e emite uma sessão própria. No aplicativo, o token da sessão fica no SecureStore e também autentica a conexão WebSocket. Ele não é enviado na URL da conexão.

No painel web, o navegador chama apenas rotas same-origin em `/api`. O BFF mantém o token administrativo em cookie `HttpOnly`, envia o bearer somente à `metas-api` e aplica validação exata de Origin/Host, CSRF assinado e vinculado à sessão, CSP e respostas `no-store`. O frontend nunca persiste bearer em `localStorage` ou `sessionStorage`.

Os eventos realtime cobrem mudanças em funcionários, configurações de metas e campanhas. O aplicativo agrupa invalidações repetidas, recarrega somente os dados necessários e tenta restabelecer a conexão quando volta ao primeiro plano.

## Metas e campanhas

As metas usam a quantidade de funcionários ativos e o peso configurado para cada cargo. Balconistas, farmacêuticos e caixas participam do cálculo; gestores ficam fora da distribuição individual. Os pesos padrão são `1`, `0,7` e `0,3`, respectivamente, e podem ser alterados na configuração da loja.

Metas e Campanhas reutilizam o mesmo núcleo de distribuição proporcional. Para uma necessidade diária da loja, a parcela de cada funcionário é calculada assim:

```text
parcela diária = necessidade diária da loja × peso do cargo ÷ peso total da equipe
```

Nas campanhas, a necessidade diária considera a quantidade ainda não vendida e os dias restantes do período. O cálculo usa a equipe e os pesos atuais, por isso acompanha vendas, alterações de cargo, entradas, saídas e mudanças de peso. A precisão é mantida durante o cálculo; o arredondamento ocorre apenas na apresentação.

Campanhas concluídas, períodos encerrados, equipes vazias e pesos totais iguais a zero são tratados sem gerar valores negativos ou divisões inválidas.

## Configuração local

Instale as dependências em cada pacote:

```powershell
cd metas-api
npm ci

cd ..\metas-mobile
npm ci

cd ..\metas-admin\frontend
npm ci

cd ..\bff
npm ci
```

Os arquivos locais de ambiente são ignorados pelo Git. Não adicione senhas, tokens, URLs privadas ou credenciais ao repositório.

### Aplicativo

O aplicativo lê estas variáveis públicas do Expo:

```env
EXPO_PUBLIC_API_BASE_URL=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
```

Depois de configurá-las, inicie o Metro a partir de `metas-mobile/`:

```powershell
npm start
```

Também estão disponíveis `npm run android`, `npm run ios` e `npm run web`.

### API

As principais variáveis de runtime são:

```env
NODE_ENV=
HOST=
PORT=
TRUST_PROXY_HOPS=
DATABASE_URL=
DATABASE_SSL=
DATABASE_SSL_SERVERNAME=
CORS_ORIGINS=
GOOGLE_ALLOWED_CLIENT_IDS=
SESSION_TTL_SECONDS=
```

Migrations e tarefas administrativas usam conexões separadas:

```env
MIGRATION_DATABASE_URL=
PLATFORM_ADMIN_OPERATOR_DATABASE_URL=
ADMIN_DATABASE_URL=
```

Para iniciar a API em desenvolvimento, execute em `metas-api/`:

```powershell
npm run dev
```

O build compilado usa:

```powershell
npm run build
npm start
```

### Painel administrativo e BFF

Em desenvolvimento, configure somente o Client ID público em `metas-admin/frontend/.env`. As configurações privadas ficam em `metas-admin/bff/.env`. Use os respectivos arquivos `.env.example` como referência e inicie os processos separadamente:

```powershell
cd metas-admin\bff
npm run dev

cd ..\frontend
npm run dev
```

O Vite encaminha `/api` ao BFF local. Em produção, frontend e BFF compartilham uma origem HTTPS: a Vercel serve o build de `metas-admin/frontend/dist` e encaminha somente `/api/*` para uma Function Node que reutiliza o Express. O BFF continua sendo o único consumidor do bearer administrativo. O cookie de produção usa o prefixo `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` e não define `Domain`.

O primeiro enrollment e o recovery de MFA exigem solicitação pela sessão `GOOGLE_ONLY` e aprovação temporária fora do HTTP público pela role dedicada `metas_platform_admin_operator`. O recovery substitui as passkeys antigas, encerra as demais sessões administrativas e só promove a sessão após verificar uma nova passkey. Se a cerimônia for interrompida ou expirar, uma nova solicitação de recovery invalida o challenge anterior e exige nova aprovação; credenciais e sessões revogadas nunca são restauradas. O rate limiter administrativo usa Redis/Valkey compartilhado em produção e falha fechado; o modo em memória fica restrito a desenvolvimento/testes.

Antes de ativar o Admin em produção ainda são obrigatórios: aplicar e inspecionar a migration 016 pelo fluxo manual, configurar Redis/Valkey com TLS, ensaiar as aprovações por canal independente, validar BFF/cookie/CSRF no ambiente final, estabelecer identidade individual do operador e executar E2E com navegador/autenticador real. Esta fase não habilita o Admin nem acessa produção.

### Hospedagem do Admin na Vercel

O projeto Vercel deve usar `metas-admin` como **Root Directory**, Node.js 24 e o preset/configuração versionada em `metas-admin/vercel.json`. O build raiz valida o adaptador serverless e gera o frontend; `metas-admin/api/[...path].ts` instancia o BFF sem chamar `app.listen()`. O fallback da SPA exclui `/api`, portanto uma rota BFF ausente retorna JSON/404 e nunca `index.html`. Assets versionados podem ser armazenados em cache; HTML e toda resposta `/api/*` usam `no-store`.

Use uma origem fixa e exata no domínio gratuito do projeto, sem wildcard:

```text
origem pública: https://<PROJETO>.vercel.app
Host esperado:    <PROJETO>.vercel.app
WebAuthn RP ID:   <PROJETO>.vercel.app
```

Configure as variáveis abaixo somente no ambiente **Production** da Vercel:

| Variável                      | Componente | Segredo | Origem do valor                                        |
| ----------------------------- | ---------- | ------- | ------------------------------------------------------ |
| `VITE_GOOGLE_ADMIN_CLIENT_ID` | frontend   | não     | Client ID Web administrativo do Google                 |
| `METAS_API_BASE_URL`          | BFF        | não     | origem HTTPS da `metas-api` no Northflank              |
| `METAS_ADMIN_PUBLIC_ORIGIN`   | BFF        | não     | `https://<PROJETO>.vercel.app`                         |
| `METAS_ADMIN_EXPECTED_HOST`   | BFF        | não     | `<PROJETO>.vercel.app`                                 |
| `METAS_ADMIN_CSRF_SECRET`     | BFF        | sim     | valor aleatório exclusivo com pelo menos 32 caracteres |
| `METAS_ADMIN_API_TIMEOUT_MS`  | BFF        | não     | opcional; padrão `8000`                                |

`PORT` não deve ser configurada para a Function. `NODE_ENV` é fornecida pela plataforma. Nenhum valor privado pode usar prefixo `VITE_`; toda variável Vite fica incorporada ao JavaScript público.

Na `metas-api`, quando a ativação for autorizada em uma etapa posterior, configure a mesma origem/RP e o mesmo Client ID Web com os nomes reais:

| Variável                                  | Valor futuro                                     |
| ----------------------------------------- | ------------------------------------------------ |
| `GOOGLE_ADMIN_ALLOWED_CLIENT_IDS`         | Client ID Web administrativo usado pelo frontend |
| `PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS` | `https://<PROJETO>.vercel.app`                   |
| `PLATFORM_ADMIN_WEBAUTHN_RP_ID`           | `<PROJETO>.vercel.app`                           |
| `PLATFORM_ADMIN_WEBAUTHN_RP_NAME`         | nome exibido nas cerimônias de passkey           |

Não é necessário adicionar a origem do Admin a `CORS_ORIGINS`: o navegador fala apenas com o BFF same-origin e o BFF chama a API server-side. `PLATFORM_ADMIN_AUTH_ENABLED` permanece `false` até a liberação operacional completa.

No Google Cloud, o Client ID deve ser do tipo **Web application** e receber exatamente `https://<PROJETO>.vercel.app` em **Authorized JavaScript origins**. O fluxo atual usa callback JavaScript e popup, portanto não exige redirect URI. A CSP permite somente os endpoints oficiais do Google Identity Services usados pelo script, iframe, stylesheet e conexões.

Preview e Production não compartilham confiança. Não configure os secrets do BFF nem as variáveis administrativas de produção no escopo **Preview**, não derive Origin/RP ID de `VERCEL_URL` e não use `*.vercel.app`. No plano Hobby, habilite Vercel Authentication com Standard Protection para restringir previews. O desenvolvimento continua usando os valores locais dos arquivos `.env.example` e o proxy do Vite.

Checklist de publicação futura:

1. criar um único projeto Vercel com Root Directory `metas-admin` e Production Branch `main`;
2. confirmar Node.js 24 e manter os comandos de install/build do `vercel.json`;
3. definir a origem final fixa e configurar as variáveis apenas em Production;
4. cadastrar a origem exata no Client ID Web do Google;
5. configurar RP ID/origin/Client ID correspondentes na API, mantendo a feature flag desligada;
6. publicar e validar headers, `/api`, cookies, CSRF, Host e respostas `no-store`;
7. executar E2E real de Google, first enrollment, autenticação, step-up, recovery e logout;
8. somente depois concluir o checklist operacional e avaliar a ativação da feature flag.

Em rollback, mantenha `PLATFORM_ADMIN_AUTH_ENABLED=false`, reverta/promova o deployment Vercel anterior, não altere RP ID de credentials já emitidas e valide novamente a origem fixa antes de reabrir o acesso.

## Banco de dados e migrations

A API mantém migrations TypeScript numeradas em `metas-api/src/database/migrations/`. Elas criam o schema, as identidades, as sessões, as políticas RLS e as estruturas de funcionários, metas e campanhas.

Use uma credencial própria para migrations, sem reaproveitar a credencial de runtime:

```powershell
cd metas-api
npm run db:migrate:status
npm run db:migrate
```

O bootstrap administrativo e os fluxos específicos de Northflank estão descritos em [`metas-api/README.md`](metas-api/README.md). Esses comandos exigem credenciais próprias e não devem usar o login da aplicação.

## Testes e verificações

No aplicativo:

```powershell
cd metas-mobile
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo export --platform all
```

Na API:

```powershell
cd metas-api
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
npm run format:check
```

No painel e no BFF:

```powershell
cd metas-admin\frontend
npm test
npm run typecheck
npm run lint
npm run build
npm run format:check

cd ..\bff
npm test
npm run typecheck
npm run lint
npm run build
npm run format:check
```

Os testes de integração da API precisam de um PostgreSQL exclusivo para testes e das variáveis `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL`, `TEST_PLATFORM_ADMIN_DATABASE_URL`, `TEST_PLATFORM_ADMIN_OPERATOR_DATABASE_URL` e `TEST_ADMIN_DATABASE_URL`. As opções de SSL para esse ambiente são `TEST_DATABASE_SSL` e `TEST_DATABASE_SSL_SERVERNAME`.

## Integração contínua

O workflow `.github/workflows/ci.yml` executa o CI em Pull Requests para `main` e em pushes para `develop`. Os checks possuem nomes estáveis para uso nas regras de proteção da branch:

- `Mobile CI` valida testes, TypeScript, ESLint, formatação dos arquivos alterados e o export Android do Expo;
- `API CI` valida testes unitários e HTTP, TypeScript, ESLint, formatação e o build;
- `PostgreSQL Integration` cria um PostgreSQL descartável, prepara os roles de teste, aplica todas as migrations e executa a integração real com RLS e menor privilégio;
- `Admin CI` valida testes, TypeScript, ESLint, formatação e builds do painel e do BFF.

O CI usa somente credenciais descartáveis do próprio runner e não depende de secrets, Northflank, EAS ou bancos externos. Na API, a formatação é verificada por completo. No mobile, enquanto o passivo histórico de Prettier não for corrigido, a verificação é incremental nos arquivos modificados, sem ocultar novos problemas.

O fluxo normal segue `develop → push → Pull Request automático → CI → merge automático → main`. Um novo push para `develop` cria ou atualiza o Pull Request e, depois que os quatro checks passam, alterações sem migration podem ser integradas automaticamente por Merge, mantendo a `develop` permanente.

Quando algum arquivo em `metas-api/src/database/migrations/` é adicionado, alterado ou removido, o Pull Request continua aberto e o merge automático é bloqueado. O merge deve ocorrer manualmente somente depois do backup, da consulta de status, da aplicação administrativa da migration e da validação do ambiente.

## Branches

A `main` representa a versão estável. O desenvolvimento do dia a dia acontece em `develop`, e os novos trabalhos devem entrar primeiro nessa branch. A `main` é atualizada depois, quando uma versão estiver pronta.

## Expo e EAS

O arquivo `metas-mobile/eas.json` define os perfis `development`, `preview` e `production`. O perfil `preview` gera um APK de distribuição interna, usa o canal `preview` e carrega o EAS Environment `preview`.

As configurações públicas necessárias ao aplicativo devem existir no ambiente remoto, sem duplicação no `eas.json`:

- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- `EXPO_PUBLIC_API_BASE_URL`

Para conferir as variáveis configuradas, sem copiar valores para o repositório:

```powershell
cd metas-mobile
eas env:list --environment preview
```

Para criar um build Android de preview:

```powershell
eas build --platform android --profile preview
```

Esse perfil usa automaticamente as variáveis do EAS Environment `preview`.

Para publicar uma atualização compatível com a versão nativa instalada, use o script do projeto:

```powershell
npm run update:preview -- --message "feat: descrição da atualização"
```

O script informa o canal e o ambiente `preview`, evitando publicações sem a configuração remota necessária. O `runtimeVersion` segue a versão do aplicativo. Mudanças nativas exigem um novo EAS Build; o EAS Update atende alterações compatíveis em JavaScript e assets.

## Segurança e desenvolvimento

- Não versione arquivos `.env`, chaves privadas, certificados, tokens ou credenciais de banco.
- Mantenha separadas as credenciais administrativas, de migration, de runtime e de testes.
- Preserve a autenticação, o escopo da loja e as políticas RLS ao criar endpoints.
- Reutilize o cálculo ponderado compartilhado ao alterar Metas ou Campanhas.
- Execute testes, typecheck, lint e build nos dois pacotes antes de publicar.
