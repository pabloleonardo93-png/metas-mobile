# Metas

O Metas é um aplicativo para acompanhar metas de vendas, campanhas e equipes de uma loja. O repositório reúne o aplicativo Expo/React Native e uma API privada em Node.js, conectada ao PostgreSQL.

Gestores podem manter funcionários, configurar metas por cargo e administrar campanhas. Funcionários consultam os objetivos e o progresso correspondente ao próprio perfil. Alterações relevantes são propagadas por WebSocket para que as telas atualizem os dados sem depender de uma nova autenticação.

## Estrutura do repositório

```text
.
├── metas-mobile/   # aplicativo Expo e React Native
├── metas-api/      # API HTTP, WebSocket e migrations PostgreSQL
├── AGENTS.md       # orientações de desenvolvimento do repositório
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

O PostgreSQL precisa das extensões `citext` e `btree_gist`.

## Como o sistema está organizado

O aplicativo separa as funcionalidades por domínio, como autenticação, funcionários, metas e campanhas. Contextos React mantêm os dados compartilhados, enquanto os clientes de API concentram as chamadas HTTP. O Expo Router organiza a navegação entre as áreas de gestor e funcionário.

A API expõe rotas autenticadas e isola os dados por loja. O identificador da loja vem da sessão validada no servidor. O contexto da conexão PostgreSQL e as políticas de Row-Level Security reforçam esse isolamento no banco.

A autenticação começa com um ID token do Google. A API valida esse token e emite uma sessão própria. No aplicativo, o token da sessão fica no SecureStore e também autentica a conexão WebSocket. Ele não é enviado na URL da conexão.

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

Os testes de integração da API precisam de um PostgreSQL exclusivo para testes e das variáveis `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL` e `TEST_ADMIN_DATABASE_URL`. As opções de SSL para esse ambiente são `TEST_DATABASE_SSL` e `TEST_DATABASE_SSL_SERVERNAME`.

## Integração contínua

O workflow `.github/workflows/ci.yml` executa o CI em Pull Requests para `main` e em pushes para `develop`. Os checks possuem nomes estáveis para uso nas regras de proteção da branch:

- `Mobile CI` valida testes, TypeScript, ESLint, formatação dos arquivos alterados e o export Android do Expo;
- `API CI` valida testes unitários e HTTP, TypeScript, ESLint, formatação e o build;
- `PostgreSQL Integration` cria um PostgreSQL descartável, prepara os roles de teste, aplica todas as migrations e executa a integração real com RLS e menor privilégio.

O CI usa somente credenciais descartáveis do próprio runner e não depende de secrets, Northflank, EAS ou bancos externos. Na API, a formatação é verificada por completo. No mobile, enquanto o passivo histórico de Prettier não for corrigido, a verificação é incremental nos arquivos modificados, sem ocultar novos problemas.

O fluxo normal segue `develop → push → Pull Request automático → CI → merge automático → main`. Um novo push para `develop` cria ou atualiza o Pull Request e, depois que os três checks passam, alterações sem migration podem ser integradas automaticamente por Merge, mantendo a `develop` permanente.

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
