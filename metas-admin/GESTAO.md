# Gestão administrativa: farmácias e pessoas

Esta etapa acrescenta gestão ao painel autenticado sem modificar Google, passkey, MFA, bootstrap ou aprovação operacional.

## Preparação para disponibilização

A migration aditiva `017-add-platform-management.ts` deve ser revisada e aplicada pelo fluxo normal de migrations **antes** da versão da API que disponibiliza as novas rotas. Não execute comandos administrativos no runtime. Nesta implementação, a migration foi exercitada somente em um PostgreSQL descartável local.

Ela adiciona controle de versão às farmácias e autoria Platform Admin aos novos vínculos. Não recria tabelas de domínio. A origem `PLATFORM_ADMIN` distingue corretamente um vínculo criado pelo administrador de um vínculo criado pelo gestor da loja.

A regra existente que protege o último gestor ativo é preservada. A função de trigger é ampliada somente para reconhecer essa origem e manter seu autor imutável. Não há DELETE nas APIs de gestão.

O runtime `metas_platform_admin_runtime` recebe somente EXECUTE nas duas novas funções de gestão. Nenhum acesso direto às tabelas é concedido. As funções SECURITY DEFINER usam search_path fixo, validam a sessão administrativa existente e exigem MFA_VERIFIED no banco. O operator não recebe essas capacidades.

## Funcionalidades

- Farmácias: busca por nome/slug, status, paginação, detalhes, criação, edição e ativação/desativação.
- Pessoas: usuários já presentes em vínculos, busca por nome/e-mail, filtro por função/status, detalhes, edição do nome e da função, ativação/desativação e criação de um vínculo adicional com outra farmácia.
- Auditoria: listagem paginada das operações de gestão, com administrador, operação, resultado e data.
- Configurações: somente consulta da identidade da sessão; não simula preferências editáveis.
- Home: atalhos de trabalho e estado MFA da sessão, sem métricas inventadas.

As funções de funcionário continuam `GESTOR`, `BALCONISTA`, `CAIXA` e `FARMACEUTICO`. Platform Admin não é uma função de funcionário.

O nome pertence ao usuário e sua edição afeta todos os vínculos. O e-mail/identidade de acesso não é alterado por esta interface. Criar uma conta nova ou provisionar alguém sem qualquer vínculo continua fora desta etapa; esta tela gerencia pessoas existentes. Uma farmácia vazia pode receber um usuário existente como primeiro gestor.

Vincular não transfere nem encerra automaticamente o vínculo anterior: cria outro registro, com autoria administrativa explícita. Para transferir operacionalmente, crie o vínculo de destino e desative o anterior, respeitando a necessidade de outro gestor ativo na origem. Se o vínculo de destino já existir, edite/reative esse vínculo; não há duplicação nem troca do store_id histórico.

Desativar um vínculo encerra suas sessões e impede acesso por ele. Outros vínculos e a conta global não são desabilitados. Uma conta DISABLED/PENDING continua sujeita às regras de autenticação existentes mesmo se um vínculo for reativado.

Desativar uma farmácia encerra as sessões de seus funcionários e impede acesso àquela unidade pelas regras existentes de autenticação. Histórico e cadastros permanecem. Alterar função encerra as sessões daquele vínculo. Reativar não restaura sessões revogadas.

Edições usam versões de registro para evitar sobrescrita silenciosa de alterações concorrentes. Em caso de conflito, atualize a lista e reabra o cadastro.

## Contratos

Todas as chamadas do navegador são same-origin via BFF:

| Método | BFF                                | API                                              |
| ------ | ---------------------------------- | ------------------------------------------------ |
| GET    | /api/management/pharmacies         | /v1/platform-admin/management/pharmacies         |
| POST   | /api/management/pharmacies         | /v1/platform-admin/management/pharmacies         |
| POST   | /api/management/pharmacies/:id     | /v1/platform-admin/management/pharmacies/:id     |
| GET    | /api/management/employees          | /v1/platform-admin/management/employees          |
| POST   | /api/management/employees/:id      | /v1/platform-admin/management/employees/:id      |
| POST   | /api/management/employees/:id/link | /v1/platform-admin/management/employees/:id/link |
| GET    | /api/management/audit              | /v1/platform-admin/management/audit              |

GET aceita q, status (ALL/ACTIVE/INACTIVE), role, storeId, page e pageSize (máximo 50), conforme recurso. Detalhes usam o registro retornado na listagem; versões impedem gravação obsoleta. UUIDs, funções, versões e campos de formulários são validados. Campos adicionais são rejeitados nas entradas.

Os contratos Zod ficam em cada workspace, sem dependência do build do mobile. O teste de paridade protege esses três arquivos contra divergência.

Cookies HttpOnly, CSRF, Origin/Host, CSP e sessão não foram substituídos. O BFF valida e projeta respostas conhecidas, não encaminha objetos de erro brutos. Falhas de domínio usam códigos/mensagens públicos allowlisted.

## Auditoria e limites

Cada gravação bem-sucedida insere em `metas.platform_admin_audit_events` na mesma transação. Se o evento não puder ser gravado, a alteração é revertida. Mudanças de função/status também guardam os estados anteriores e novos em metadata; o frontend não expõe metadata, IP, tokens ou dados técnicos de autenticação.

A listagem desta etapa cobre somente eventos associados a store/employee. Não é um console completo de segurança: exportação, filtros avançados e registro transacional de tentativas negadas de gestão não foram adicionados.

## Visual e acessibilidade

Os tokens espelham os valores reais de `metas-mobile/src/shared/theme/colors.ts`: vermelho #F21F26, ação pressionada #D9161D, fundo #FFF9F8, superfície #FFFFFF, texto #1D1717, texto secundário #796968, borda #E8D8D6, sucesso #147D64 e erro #B42318. Não há nova fonte, imagem, logo ou dependência visual.

Sidebar desktop, menu expansível em telas menores, tabelas que se reorganizam como listas abaixo de 900px, foco visível, labels e nomes de ações explícitos, estados textuais e diálogos nativos com Escape/foco restaurado. A cor não é o único indicador de estado.

## Validação local

Em cada workspace, execute os scripts existentes de test, typecheck, lint e build. Na API:

```powershell
npm test
npm run test:management:integration
```

O teste de integração cria um cluster descartável em loopback e nunca usa DATABASE_URL ou arquivos .env. No Windows, procura PostgreSQL 18 em Program Files; `METAS_LOCAL_POSTGRES_BIN` permite indicar o diretório dos binários locais. Sem os binários, o teste é explicitamente skipped. Ele remove o cluster ao terminar e não utiliza force-exit.
