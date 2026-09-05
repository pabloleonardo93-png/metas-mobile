import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAdminApiStateForTests } from './api/adminApi';
import { App } from './App';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const me = (
  assuranceLevel: 'GOOGLE_ONLY' | 'MFA_VERIFIED',
  hasWebAuthnCredential = true,
  hasWebAuthnCredentialHistory = hasWebAuthnCredential,
) => ({
  assuranceLevel,
  displayName: 'Admin Teste',
  hasWebAuthnCredential,
  hasWebAuthnCredentialHistory,
  primaryEmail: 'admin@example.test',
});

let googleCallback: ((response: { credential?: string }) => void) | null = null;
let googleRenderButton = vi.fn();

describe('admin authentication routes', () => {
  beforeEach(() => {
    resetAdminApiStateForTests();
    window.history.replaceState({}, '', '/');
    googleCallback = null;
    googleRenderButton = vi.fn();
    window.google = {
      accounts: {
        id: {
          cancel: vi.fn(),
          initialize: vi.fn(
            (options: { callback: (response: { credential?: string }) => void }) => {
              googleCallback = options.callback;
            },
          ),
          renderButton: googleRenderButton,
        },
      },
    };
    vi.restoreAllMocks();
  });

  it('routes an unauthenticated browser to Google login and never asks for a password', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ code: 'UNAUTHORIZED', message: 'Sessão necessária.' }, 401),
    );
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Logo Metas' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/senha/iu)).not.toBeInTheDocument();
  });

  it('renders the official textual GIS button in an isolated responsive container', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ code: 'UNAUTHORIZED', message: 'Sessão necessária.' }, 401),
    );
    render(<App />);

    const container = await screen.findByTestId('google-sign-in-container');
    await waitFor(() => expect(googleRenderButton).toHaveBeenCalledOnce());

    const [renderTarget, options] = googleRenderButton.mock.calls[0] as [
      HTMLElement,
      Record<string, string>,
    ];
    expect(renderTarget).toBe(container);
    expect(container).toHaveClass('google-button__surface');
    expect(options).toEqual(
      expect.objectContaining({
        logo_alignment: 'left',
        shape: 'rectangular',
        size: 'large',
        text: 'signin_with',
        theme: 'outline',
        type: 'standard',
      }),
    );
    expect(options).not.toHaveProperty('width');
    expect(screen.queryByRole('button', { name: /google/iu })).not.toBeInTheDocument();
  });

  it('routes GOOGLE_ONLY sessions to the passkey step', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(me('GOOGLE_ONLY')));
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Confirme com sua passkey' }),
    ).toBeInTheDocument();
  });

  it('requests controlled first enrollment without polling or browser-stored authority', async () => {
    const user = userEvent.setup();
    const requestId = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(me('GOOGLE_ONLY', false)))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'session.csrf' }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            approvalExpiresAt: null,
            expiresAt: '2026-09-01T12:15:00.000Z',
            requestId,
            status: 'PENDING',
          },
          202,
        ),
      );
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Proteja sua conta com uma passkey' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar passkey autorizada' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Solicitar primeiro cadastro' }));

    expect(await screen.findByText('Aguardando autorização operacional')).toBeInTheDocument();
    expect(screen.getByText(`Identificador: ${requestId}`)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mfa/first-enrollment/request',
      expect.objectContaining({ body: '{}', method: 'POST' }),
    );
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it('requests MFA recovery without persisting its identifier or exposing session authority', async () => {
    const user = userEvent.setup();
    const requestId = '44444444-4444-4444-8444-444444444444';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(me('GOOGLE_ONLY', true)))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'session.csrf' }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            approvalExpiresAt: null,
            expiresAt: '2026-09-01T12:15:00.000Z',
            requestId,
            status: 'PENDING',
          },
          202,
        ),
      );
    render(<App />);

    await screen.findByRole('heading', { name: 'Confirme com sua passkey' });
    await user.click(screen.getByRole('button', { name: 'Perdi acesso às minhas passkeys' }));

    expect(await screen.findByText('Aguardando confirmação independente')).toBeInTheDocument();
    expect(screen.getByText(`Identificador: ${requestId}`)).toBeInTheDocument();
    expect(screen.getByText(/passkeys anteriores serão revogadas/iu)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mfa/recovery/request',
      expect.objectContaining({ body: '{}', method: 'POST' }),
    );
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(window.location.search).toBe('');
  });

  it('keeps an interrupted recovery out of the first-enrollment flow', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(me('GOOGLE_ONLY', false, true)))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'session.csrf' }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            approvalExpiresAt: null,
            expiresAt: '2026-09-01T12:15:00.000Z',
            requestId: '55555555-5555-4555-8555-555555555555',
            status: 'PENDING',
          },
          202,
        ),
      );
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Recupere o acesso com uma nova passkey' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solicitar primeiro cadastro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Usar passkey cadastrada' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Perdi acesso às minhas passkeys' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mfa/recovery/request',
      expect.objectContaining({ body: '{}', method: 'POST' }),
    );
  });

  it('routes MFA_VERIFIED sessions to the dashboard shell', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(me('MFA_VERIFIED')));
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Painel da plataforma' }),
    ).toBeInTheDocument();
    expect(screen.getByText('MFA verificado')).toBeInTheDocument();
  });

  it('logs out through the BFF and returns to the unauthenticated state', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(me('MFA_VERIFIED')))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'session.csrf' }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'anonymous.csrf' }));
    render(<App />);
    await screen.findByRole('heading', { name: 'Painel da plataforma' });

    await user.click(screen.getByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
  });

  it('sends a GIS callback to the BFF then advances to MFA', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ code: 'UNAUTHORIZED', message: 'Sessão necessária.' }, 401),
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'anonymous.csrf' }))
      .mockResolvedValueOnce(
        jsonResponse({
          admin: {
            assuranceLevel: 'GOOGLE_ONLY',
            displayName: 'Admin Teste',
            primaryEmail: 'admin@example.test',
          },
          csrfToken: 'session.csrf',
          expiresAt: '2026-09-01T12:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(me('GOOGLE_ONLY')));
    render(<App />);
    await screen.findByRole('heading', { name: 'Entrar no painel' });
    await waitFor(() => expect(googleCallback).not.toBeNull());

    act(() => {
      googleCallback?.({ credential: 'google-id-token-for-admin-login' });
    });

    expect(
      await screen.findByRole('heading', { name: 'Confirme com sua passkey' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/google',
      expect.objectContaining({
        body: JSON.stringify({ credential: 'google-id-token-for-admin-login' }),
      }),
    );
  });

  it('shows the sanitized BFF error when Google login is denied', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ code: 'UNAUTHORIZED', message: 'Sessão necessária.' }, 401),
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'anonymous.csrf' }))
      .mockResolvedValueOnce(
        jsonResponse(
          { code: 'UNAUTHORIZED', message: 'Não foi possível autorizar este acesso.' },
          401,
        ),
      );
    render(<App />);
    await screen.findByRole('heading', { name: 'Entrar no painel' });
    await waitFor(() => expect(googleCallback).not.toBeNull());

    act(() => googleCallback?.({ credential: 'denied-google-id-token' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível autorizar este acesso.',
    );
  });
});
