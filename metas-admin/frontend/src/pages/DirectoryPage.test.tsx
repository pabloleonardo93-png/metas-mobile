import { act, render, screen, waitFor, within } from '@testing-library/react';
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
const setup = (
  route = '/pharmacies',
  items: unknown[] = [pharmacy],
  options: { assurance?: string; fail?: boolean } = {},
) => {
  window.history.replaceState({}, '', route);
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === '/api/auth/me')
      return Promise.resolve(
        json({ ...me, assuranceLevel: options.assurance ?? me.assuranceLevel }),
      );
    if (url === '/api/security/csrf') return Promise.resolve(json({ csrfToken: 'synthetic-csrf' }));
    if (init?.method === 'POST') return Promise.resolve(json({ id }));
    return Promise.resolve(
      options.fail
        ? json({ code: 'MANAGEMENT_UNAVAILABLE', message: 'Serviço indisponível.' }, 503)
        : json(page(items)),
    );
  });
  render(<App />);
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
    setup();
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
  it('mostra estado vazio sem números fictícios', async () => {
    setup('/pharmacies', []);
    expect(
      await screen.findByRole('heading', { name: 'Nenhum registro encontrado' }),
    ).toBeInTheDocument();
    expect(screen.getByText('0 registros · Página 1 de 1')).toBeInTheDocument();
  });
  it('mostra loading e permite tentar novamente após falha', async () => {
    setup('/pharmacies', [], { fail: true });
    expect(
      await screen.findByRole('heading', { name: 'Não foi possível carregar a lista' }),
    ).toBeInTheDocument();
    fetchMock.mockResolvedValue(json(page([pharmacy])));
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Farmácia Centro', { selector: 'strong' })).toBeInTheDocument();
  });
  it('valida formulário, impede duplo envio e cria farmácia pelo BFF', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });
    await user.click(screen.getByRole('button', { name: 'Nova farmácia' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar cadastro' }));
    expect(within(dialog).getAllByText('Revise este campo.').length).toBeGreaterThan(0);
    await user.type(within(dialog).getByLabelText('Nome da farmácia'), 'Farmácia Norte');
    await user.type(within(dialog).getByLabelText('Identificador público'), 'norte');
    await user.dblClick(within(dialog).getByRole('button', { name: 'Salvar cadastro' }));
    expect(
      await screen.findByText('Alteração salva e registrada em auditoria.'),
    ).toBeInTheDocument();
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
  it('desativar exige confirmação, preserva versão e não envia DELETE', async () => {
    setup();
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
    setup('/employees', [employee]);
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
  it('sessão sem MFA não acessa gestão', async () => {
    setup('/pharmacies', [], { assurance: 'GOOGLE_ONLY' });
    await waitFor(() => expect(window.location.pathname).toBe('/mfa'));
    expect(
      fetchMock.mock.calls.some(([input]) =>
        (input instanceof Request ? input.url : input.toString()).startsWith('/api/management'),
      ),
    ).toBe(false);
  });
  it('menu responsivo mantém links acessíveis e navegação real', async () => {
    setup();
    await screen.findByText('Farmácia Centro', { selector: 'strong' });
    const menu = screen.getByRole('button', { name: 'Menu' });
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('link', { name: /Auditoria/ }));
    expect(await screen.findByRole('heading', { name: 'Auditoria' })).toBeInTheDocument();
  });
  it('cancelamento da requisição evita resposta antiga sobrescrever filtros', async () => {
    setup();
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
