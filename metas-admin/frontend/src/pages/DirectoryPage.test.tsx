import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { App } from '../App';
import { resetAdminApiStateForTests } from '../api/adminApi';
import { authenticateWithPasskey } from '../auth/webauthn';

vi.mock('../auth/webauthn', () => ({
  authenticateWithPasskey: vi.fn().mockResolvedValue(undefined),
  describeWebAuthnError: () => 'Não foi possível confirmar sua identidade.',
  recoverWithNewPasskey: vi.fn(),
  registerFirstPasskey: vi.fn(),
  supportsWebAuthn: () => true,
}));

const id = '11111111-1111-4111-8111-111111111111';
const pharmacy = {
  id,
  name: 'Farmácia Centro',
  slug: 'centro',
  timezone: 'America/Sao_Paulo',
  isActive: true,
  version: 1,
  employeeCount: 2,
  managers: ['Gestora Teste'],
  updatedAt: '2026-09-09T12:00:00Z',
};
const pharmacyWithoutManager = { ...pharmacy, employeeCount: 0, managers: [] };
const secondPharmacy = {
  ...pharmacyWithoutManager,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Santa Afonso',
  slug: 'santa-afonso',
};
const inactivePharmacy = {
  ...pharmacyWithoutManager,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Farmácia Inativa',
  slug: 'inativa',
  isActive: false,
};
const employee = {
  id,
  userId: id,
  storeId: id,
  storeName: 'Farmácia Centro',
  name: 'Pessoa Teste',
  email: 'person@example.test',
  role: 'CAIXA',
  status: 'ATIVO',
  accountStatus: 'ACTIVE',
  joinedOn: '2026-01-01',
  endedOn: null,
  version: 1,
  userVersion: 1,
  updatedAt: '2026-09-09T12:00:00Z',
};
const auditEvent = {
  id,
  action: 'EMPLOYEE_DEACTIVATED',
  actor: 'Admin Teste',
  targetType: 'employee',
  targetId: id,
  outcome: 'SUCCESS',
  createdAt: '2026-09-09T12:00:00Z',
};
const me = {
  assuranceLevel: 'MFA_VERIFIED',
  displayName: 'Admin Teste',
  primaryEmail: 'admin@example.test',
  hasWebAuthnCredential: true,
  hasWebAuthnCredentialHistory: true,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
let fetchMock: MockInstance<typeof fetch>;
const setup = async (
  route = '/pharmacies',
  items: unknown[] = [pharmacy],
  options: {
    assurance?: string;
    deleteError?: { code: string; message: string; status: number };
    fail?: boolean;
  } = {},
) => {
  window.history.replaceState({}, '', route);
  let employeeDeleted = false;
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === '/api/auth/me')
      return Promise.resolve(
        json({ ...me, assuranceLevel: options.assurance ?? me.assuranceLevel }),
      );
    if (url === '/api/security/csrf') return Promise.resolve(json({ csrfToken: 'synthetic-csrf' }));
    if (init?.method === 'DELETE') {
      if (options.deleteError)
        return Promise.resolve(
          json(
            { code: options.deleteError.code, message: options.deleteError.message },
            options.deleteError.status,
          ),
        );
      employeeDeleted = true;
      return Promise.resolve(json({ id }));
    }
    if (init?.method === 'POST') return Promise.resolve(json({ id }));
    if (url.startsWith('/api/management/pharmacies') && route !== '/pharmacies')
      return Promise.resolve(json(page([pharmacy])));
    return Promise.resolve(
      options.fail
        ? json({ code: 'MANAGEMENT_UNAVAILABLE', message: 'Serviço indisponível.' }, 503)
        : json(page(employeeDeleted && route === '/employees' ? [] : items)),
    );
  });
  await act(async () => {
    render(<App />);
    await Promise.resolve();
  });
};
describe('gestão administrativa', () => {
  const originalShowModal = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    'showModal',
  );
  beforeAll(() =>
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      writable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    }),
  );
  afterAll(() => {
    if (originalShowModal)
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  });
  beforeEach(() => {
    resetAdminApiStateForTests();
    vi.mocked(authenticateWithPasskey).mockReset().mockResolvedValue(undefined);
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('lista dados reais do contrato e aplica busca e filtro de status', async () => {
    await setup();
    const user = userEvent.setup();
    expect(await screen.findByText('Farmácia Centro', { selector: 'strong' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'Centro');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('q=Centro'),
        expect.anything(),
      ),
    );
    await user.selectOptions(screen.getByLabelText('Status'), 'INACTIVE');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=INACTIVE'),
        expect.anything(),
      ),
    );
  });
  it.each([
    ['/pharmacies', [pharmacy], 'pharmacies', 'Farmácia Centro'],
    ['/employees', [employee], 'employees', 'Pessoa Teste'],
  ] as const)(
    'constrói os filtros iniciais compatíveis com o BFF em %s',
    async (route, items, resource, expectedName) => {
      await setup(route, [...items]);
      await screen.findByText(expectedName, { selector: 'strong' });

      const call = fetchMock.mock.calls.find(([input]) => {
        const value = input instanceof Request ? input.url : input.toString();
        return value.startsWith(`/api/management/${resource}?`);
      });
      const input = call?.[0];
      if (input === undefined) throw new Error('Requisição de gestão esperada.');
      const url = new URL(input instanceof Request ? input.url : input.toString(), window.origin);

      expect(url.pathname).toBe(`/api/management/${resource}`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        page: '1',
        pageSize: '20',
        q: '',
        status: 'ALL',
        role: 'ALL',
      });
    },
  );
  it('mostra estado vazio sem números fictícios', async () => {
    await setup('/pharmacies', []);
    expect(
      await screen.findByRole('heading', { name: 'Nenhum registro encontrado' }),
    ).toBeInTheDocument();
    expect(screen.getByText('0 registros · Página 1 de 1')).toBeInTheDocument();
  });
  it('mostra loading e permite tentar novamente após falha', async () => {
    await setup('/pharmacies', [], { fail: true });
    expect(
      await screen.findByRole('heading', { name: 'Não foi possível carregar a lista' }),
    ).toBeInTheDocument();
    fetchMock.mockResolvedValue(json(page([pharmacy])));
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Farmácia Centro', { selector: 'strong' })).toBeInTheDocument();
  });
  it('valida formulário, impede duplo envio e cria farmácia pelo BFF', async () => {
    await setup();
    const user = userEvent.setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });
    await user.click(screen.getByRole('button', { name: 'Nova farmácia' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar cadastro' }));
    expect(within(dialog).getAllByText('Revise este campo.').length).toBeGreaterThan(0);
    await user.type(within(dialog).getByLabelText('Nome da farmácia'), 'Farmácia Norte');
    await user.type(within(dialog).getByLabelText('Identificador público'), 'norte');
    await user.dblClick(within(dialog).getByRole('button', { name: 'Salvar cadastro' }));
    expect(await screen.findByText('Farmácia Norte foi criada com sucesso.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar gestor agora' })).toBeEnabled();
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe('/api/management/pharmacies');
    const body = posts[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Corpo JSON esperado.');
    expect(JSON.parse(body)).toMatchObject({
      name: 'Farmácia Norte',
      slug: 'norte',
      isActive: true,
    });
  });
  it('após criar a farmácia abre o formulário compartilhado com gestor e unidade definidos', async () => {
    await setup();
    const user = userEvent.setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });
    await user.click(screen.getByRole('button', { name: 'Nova farmácia' }));
    const pharmacyDialog = screen.getByRole('dialog');
    fireEvent.change(within(pharmacyDialog).getByLabelText('Nome da farmácia'), {
      target: { value: 'Santa Afonso' },
    });
    fireEvent.change(within(pharmacyDialog).getByLabelText('Identificador público'), {
      target: { value: 'santa-afonso' },
    });
    await user.click(within(pharmacyDialog).getByRole('button', { name: 'Salvar cadastro' }));

    await user.click(await screen.findByRole('button', { name: 'Adicionar gestor agora' }));
    const employeeDialog = screen.getByRole('dialog', { name: 'Adicionar gestor' });
    expect(within(employeeDialog).getByText('Santa Afonso')).toBeInTheDocument();
    expect(within(employeeDialog).getByText('Gestor')).toBeInTheDocument();
    fireEvent.change(within(employeeDialog).getByLabelText('Nome completo'), {
      target: { value: 'Gestora Santa Afonso' },
    });
    fireEvent.change(within(employeeDialog).getByLabelText('E-mail da conta Google'), {
      target: { value: 'gestora.santa@example.test' },
    });
    await user.click(within(employeeDialog).getByRole('button', { name: 'Adicionar gestor' }));
    await waitFor(() => expect(authenticateWithPasskey).toHaveBeenCalledOnce());
    const employeePost = fetchMock.mock.calls.find(
      ([input, init]) => input === '/api/management/employees' && init?.method === 'POST',
    );
    expect(employeePost).toBeDefined();
    const body = employeePost?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Corpo JSON esperado.');
    expect(JSON.parse(body)).toEqual({
      email: 'gestora.santa@example.test',
      name: 'Gestora Santa Afonso',
      role: 'GESTOR',
      storeId: id,
    });
  });
  it('adiciona funcionário pelo caso de uso compartilhado após confirmação de identidade', async () => {
    await setup('/employees', [employee]);
    const user = userEvent.setup();
    await screen.findByText('Pessoa Teste', { selector: 'strong' });
    await user.click(screen.getByRole('button', { name: '+ Novo funcionário' }));
    const dialog = screen.getByRole('dialog', { name: 'Novo funcionário' });
    await user.type(within(dialog).getByLabelText('Nome completo'), 'Nova Pessoa');
    await user.type(within(dialog).getByLabelText('E-mail da conta Google'), 'nova@example.test');
    const pharmacySelect = within(dialog).getByLabelText('Farmácia');
    await within(pharmacySelect).findByRole('option', { name: 'Farmácia Centro' });
    await user.selectOptions(pharmacySelect, id);
    expect(within(dialog).getByLabelText('Função')).toHaveValue('');
    await user.selectOptions(within(dialog).getByLabelText('Função'), 'CAIXA');
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar funcionário' }));

    await waitFor(() => expect(authenticateWithPasskey).toHaveBeenCalledOnce());
    const post = fetchMock.mock.calls.find(
      ([input, init]) => input === '/api/management/employees' && init?.method === 'POST',
    );
    expect(post).toBeDefined();
    const body = post?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Corpo JSON esperado.');
    expect(JSON.parse(body)).toEqual({
      email: 'nova@example.test',
      name: 'Nova Pessoa',
      role: 'CAIXA',
      storeId: id,
    });
    expect(await screen.findByText(/O acesso foi autorizado/iu)).toBeInTheDocument();
  });
  it('abre o cadastro compartilhado pelo menu da farmácia correta', async () => {
    await setup('/pharmacies', [pharmacyWithoutManager, secondPharmacy, inactivePharmacy]);
    const user = userEvent.setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });

    expect(screen.getByRole('button', { name: 'Detalhes de Farmácia Centro' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Editar Farmácia Centro' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Desativar Farmácia Centro' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Mais ações para Farmácia Centro' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Mais ações para Santa Afonso' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Mais ações para Farmácia Inativa' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mais ações para Santa Afonso' }));
    const menu = screen.getByRole('menu', { name: 'Mais ações para Santa Afonso' });
    expect(within(menu).getByRole('menuitem', { name: 'Adicionar gestor' })).toHaveFocus();
    await user.click(within(menu).getByRole('menuitem', { name: 'Adicionar gestor' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const employeeDialog = screen.getByRole('dialog', { name: 'Adicionar gestor' });
    expect(within(employeeDialog).getByText('Santa Afonso')).toBeInTheDocument();
    expect(within(employeeDialog).queryByText('Farmácia Centro')).not.toBeInTheDocument();
    expect(within(employeeDialog).getByText('Gestor')).toBeInTheDocument();
  });
  it('fecha o menu de ações por clique externo e Escape', async () => {
    await setup('/pharmacies', [pharmacyWithoutManager]);
    const user = userEvent.setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });
    const moreActions = screen.getByRole('button', { name: 'Mais ações para Farmácia Centro' });

    await user.click(moreActions);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('heading', { name: 'Farmácias' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(moreActions);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(moreActions).toHaveFocus();
  });
  it('mantém os gestores nos detalhes sem repetir a ação de cadastro', async () => {
    await setup('/pharmacies', [pharmacyWithoutManager]);
    const user = userEvent.setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });
    await user.click(screen.getByRole('button', { name: 'Detalhes de Farmácia Centro' }));
    const details = screen.getByRole('dialog');
    expect(within(details).getByText('Nenhum gestor cadastrado')).toBeInTheDocument();
    expect(
      within(details).queryByRole('button', { name: '+ Adicionar gestor' }),
    ).not.toBeInTheDocument();
  });
  it('desativar exige confirmação, preserva versão e não envia DELETE', async () => {
    await setup();
    const user = userEvent.setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });
    await user.click(screen.getByRole('button', { name: 'Desativar Farmácia Centro' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(screen.getByText(/Os cadastros e o histórico serão preservados/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desativar' }));
    await screen.findByText('Alteração salva e registrada em auditoria.');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = post?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Corpo JSON esperado.');
    expect(JSON.parse(body)).toMatchObject({ isActive: false, version: 1 });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
  it('mostra detalhes de pessoa e limita funções ao domínio', async () => {
    await setup('/employees', [employee]);
    const user = userEvent.setup();
    await screen.findByText('Pessoa Teste', { selector: 'strong' });
    await user.click(screen.getByRole('button', { name: 'Detalhes de Pessoa Teste' }));
    expect(within(screen.getByRole('dialog')).getByText('person@example.test')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar detalhes' }));
    await user.click(screen.getByRole('button', { name: 'Editar Pessoa Teste' }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Gestor', 'Balconista', 'Caixa', 'Farmacêutico']);
    await user.selectOptions(within(dialog).getByLabelText('Função'), 'GESTOR');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar cadastro' }));
    expect(within(dialog).getByRole('button', { name: 'Confirmar alteração' })).toBeInTheDocument();
  });
  it('organiza os campos existentes de pessoas em colunas compactas', async () => {
    await setup('/employees', [employee]);
    await screen.findByText('Pessoa Teste', { selector: 'strong' });
    expect(screen.getByRole('columnheader', { name: 'E-mail' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByText('person@example.test')).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
  });
  it('confirma a exclusão pelo menu compartilhado, evita duplo envio e atualiza a lista', async () => {
    await setup('/employees', [employee]);
    const user = userEvent.setup();
    await screen.findByText('Pessoa Teste', { selector: 'strong' });

    expect(screen.getByRole('button', { name: 'Detalhes de Pessoa Teste' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Editar Pessoa Teste' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Vincular Pessoa Teste' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Desativar Pessoa Teste' })).toBeEnabled();
    const moreActions = screen.getByRole('button', { name: 'Mais ações para Pessoa Teste' });

    await user.click(moreActions);
    const menu = screen.getByRole('menu', { name: 'Mais ações para Pessoa Teste' });
    const deleteAction = within(menu).getByRole('menuitem', { name: 'Excluir' });
    expect(deleteAction).toHaveFocus();
    await user.click(deleteAction);

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    const dialog = screen.getByRole('dialog', { name: 'Excluir funcionário?' });
    expect(
      within(dialog).getByText('Tem certeza de que deseja excluir Pessoa Teste?'),
    ).toBeVisible();
    expect(within(dialog).getByText('Essa ação não poderá ser desfeita.')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await user.click(moreActions);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog', { name: 'Excluir funcionário?' })).not.toBeInTheDocument();

    await user.click(moreActions);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir' }));
    await user.dblClick(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }),
    );

    await waitFor(() => expect(authenticateWithPasskey).toHaveBeenCalledOnce());
    await screen.findByText('Funcionário excluído com sucesso.');
    const deletions = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deletions).toHaveLength(1);
    expect(deletions[0]?.[0]).toBe(`/api/management/employees/${id}`);
    const body = deletions[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Corpo JSON esperado.');
    expect(JSON.parse(body)).toEqual({ version: 1, userVersion: 1 });
    expect(screen.queryByText('Pessoa Teste', { selector: 'strong' })).not.toBeInTheDocument();
  });
  it('mantém a pessoa na lista e mostra erro amigável quando a exclusão é rejeitada', async () => {
    await setup('/employees', [employee], {
      deleteError: {
        code: 'LAST_ACTIVE_MANAGER_DELETE_REQUIRED',
        message: 'Não é possível excluir o único gestor ativo desta farmácia.',
        status: 409,
      },
    });
    const user = userEvent.setup();
    await screen.findByText('Pessoa Teste', { selector: 'strong' });
    await user.click(screen.getByRole('button', { name: 'Mais ações para Pessoa Teste' }));
    await user.click(screen.getByRole('menuitem', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    expect(
      await within(dialog).findByText(
        'Não é possível excluir o único gestor ativo desta farmácia.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Pessoa Teste', { selector: 'strong' })).toBeInTheDocument();
  });

  it('apresenta o resultado da auditoria sem expor detalhes de autenticação', async () => {
    await setup('/audit', [auditEvent]);
    expect(await screen.findByText('Vínculo desativado')).toBeInTheDocument();
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    expect(screen.queryByText(/MFA|WebAuthn|passkey|platform admin/iu)).not.toBeInTheDocument();
  });
  it('sessão sem MFA não acessa gestão', async () => {
    await setup('/pharmacies', [], { assurance: 'GOOGLE_ONLY' });
    await waitFor(() => expect(window.location.pathname).toBe('/mfa'));
    expect(
      fetchMock.mock.calls.some(([input]) =>
        (input instanceof Request ? input.url : input.toString()).startsWith('/api/management'),
      ),
    ).toBe(false);
  });
  it('menu responsivo mantém links acessíveis e navegação real', async () => {
    await setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });
    const menu = screen.getByRole('button', { name: 'Menu' });
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('link', { name: /Auditoria/ }));
    expect(await screen.findByRole('heading', { name: 'Auditoria' })).toBeInTheDocument();
  });
  it('cancelamento da requisição evita resposta antiga sobrescrever filtros', async () => {
    await setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });
    let resolve: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'INACTIVE');
    expect(await screen.findByRole('status', { name: 'Carregando registros' })).toBeInTheDocument();
    fetchMock.mockResolvedValue(json(page([])));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await screen.findByRole('heading', { name: 'Nenhum registro encontrado' });
    await act(async () => {
      resolve?.(json(page([pharmacy])));
      await Promise.resolve();
    });
    expect(screen.queryByText('Farmácia Centro', { selector: 'strong' })).not.toBeInTheDocument();
  });
});
