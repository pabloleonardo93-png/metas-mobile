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

const me = (assuranceLevel: 'GOOGLE_ONLY' | 'MFA_VERIFIED') => ({
  assuranceLevel,
  displayName: 'Admin Teste',
  primaryEmail: 'admin@example.test',
});

let googleCallback: ((response: { credential?: string }) => void) | null = null;

describe('admin authentication routes', () => {
  beforeEach(() => {
    resetAdminApiStateForTests();
    window.history.replaceState({}, '', '/');
    googleCallback = null;
    window.google = {
      accounts: {
        id: {
          cancel: vi.fn(),
          initialize: vi.fn(
            (options: { callback: (response: { credential?: string }) => void }) => {
              googleCallback = options.callback;
            },
          ),
          renderButton: vi.fn(),
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
    expect(screen.queryByLabelText(/senha/iu)).not.toBeInTheDocument();
  });

  it('routes GOOGLE_ONLY sessions to the passkey step', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(me('GOOGLE_ONLY')));
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Confirme com sua passkey' }),
    ).toBeInTheDocument();
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
          admin: me('GOOGLE_ONLY'),
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
