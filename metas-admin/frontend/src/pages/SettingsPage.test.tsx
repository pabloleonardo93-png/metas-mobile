import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticateWithPasskey } from '../auth/webauthn';
import { SettingsPage } from './SettingsPage';

const accessApiMocks = vi.hoisted(() => ({
  approve: vi.fn(),
  cancel: vi.fn(),
  invite: vi.fn(),
  list: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    logout: vi.fn(),
    refresh: vi.fn(),
    loginWithGoogle: vi.fn(),
    state: {
      kind: 'verified',
      admin: {
        assuranceLevel: 'MFA_VERIFIED',
        displayName: 'Admin Atual',
        hasWebAuthnCredential: true,
        hasWebAuthnCredentialHistory: true,
        primaryEmail: 'atual@example.test',
      },
    },
  }),
}));

vi.mock('../auth/webauthn', () => ({
  authenticateWithPasskey: vi.fn(),
  supportsWebAuthn: () => true,
}));

vi.mock('../api/platformAdminAccessApi', () => ({
  platformAdminAccessApi: accessApiMocks,
}));

const currentAdmin = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Admin Atual',
  email: 'atual@example.test',
  status: 'ACTIVE' as const,
  invitationId: null,
  enrollmentRequestId: '33333333-3333-4333-8333-333333333333',
  lastAccessAt: '2026-09-10T12:00:00.000Z',
};
const pending = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Nova Admin',
  email: 'nova@example.test',
  status: 'AWAITING_FIRST_ACCESS' as const,
  invitationId: '22222222-2222-4222-8222-222222222222',
  enrollmentRequestId: null,
  lastAccessAt: null,
};
const awaitingApproval = {
  id: '44444444-4444-4444-8444-444444444444',
  displayName: 'Admin Convidada',
  email: 'convidada@example.test',
  status: 'AWAITING_DEVICE_APPROVAL' as const,
  invitationId: null,
  enrollmentRequestId: '55555555-5555-4555-8555-555555555555',
  lastAccessAt: '2026-09-10T12:30:00.000Z',
};

describe('configurações de administradores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accessApiMocks.list.mockResolvedValue({ items: [currentAdmin, pending, awaitingApproval] });
    accessApiMocks.invite.mockResolvedValue({ id: pending.id });
    accessApiMocks.cancel.mockResolvedValue({ id: pending.id });
    accessApiMocks.approve.mockResolvedValue({
      id: awaitingApproval.enrollmentRequestId,
    });
    vi.mocked(authenticateWithPasskey).mockResolvedValue(undefined);
  });

  it('lista situações amigáveis sem expor termos técnicos nem permitir autoaprovação', async () => {
    render(<SettingsPage />, { wrapper: MemoryRouter });

    expect(await screen.findByText('Aguardando primeiro acesso')).toBeInTheDocument();
    expect(screen.getAllByText('Admin Atual').length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/MFA_VERIFIED|GOOGLE_ONLY|WebAuthn|passkey|PLATFORM ADMIN/iu),
    ).toBeNull();
    const currentAdminRow = screen.getByRole('cell', { name: 'Admin Atual' }).closest('tr');
    expect(currentAdminRow).not.toBeNull();
    expect(
      within(currentAdminRow!).queryByRole('button', { name: 'Aprovar dispositivo' }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancelar acesso' })).toBeEnabled();
  });

  it('confirma identidade antes de autorizar acesso e envia somente nome e e-mail', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: MemoryRouter });
    await screen.findByText('Aguardando primeiro acesso');

    await user.click(screen.getByRole('button', { name: '+ Adicionar administrador' }));
    await user.type(screen.getByLabelText('Nome completo'), 'Pessoa Autorizada');
    await user.type(screen.getByLabelText('E-mail da conta Google'), 'pessoa@example.test');
    await user.click(screen.getByRole('button', { name: 'Confirmar identidade e autorizar' }));

    await waitFor(() => expect(authenticateWithPasskey).toHaveBeenCalledOnce());
    expect(accessApiMocks.invite).toHaveBeenCalledWith({
      displayName: 'Pessoa Autorizada',
      email: 'pessoa@example.test',
    });
    expect(await screen.findByText(/Acesso autorizado/iu)).toBeInTheDocument();
  });

  it('abre e fecha o formulário de novo acesso pelas duas ações disponíveis', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: MemoryRouter });
    await screen.findByText('Aguardando primeiro acesso');

    await user.click(screen.getByRole('button', { name: '+ Adicionar administrador' }));
    expect(screen.getByRole('dialog', { name: 'Adicionar administrador' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Adicionar administrador' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '+ Adicionar administrador' }));
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog', { name: 'Adicionar administrador' })).toBeNull();
    expect(accessApiMocks.invite).not.toHaveBeenCalled();
    expect(authenticateWithPasskey).not.toHaveBeenCalled();
  });

  it('confirma identidade antes de cancelar um acesso pendente', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: MemoryRouter });
    await user.click(await screen.findByRole('button', { name: 'Cancelar acesso' }));

    await waitFor(() => expect(authenticateWithPasskey).toHaveBeenCalledOnce());
    expect(accessApiMocks.cancel).toHaveBeenCalledWith(pending.invitationId);
  });

  it('permite que outro administrador autorize o primeiro dispositivo após step-up', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />, { wrapper: MemoryRouter });
    await user.click(await screen.findByRole('button', { name: 'Aprovar dispositivo' }));

    await waitFor(() => expect(authenticateWithPasskey).toHaveBeenCalledOnce());
    expect(accessApiMocks.approve).toHaveBeenCalledWith(awaitingApproval.enrollmentRequestId);
    expect(await screen.findByText(/Primeiro dispositivo autorizado/iu)).toBeInTheDocument();
  });
});
