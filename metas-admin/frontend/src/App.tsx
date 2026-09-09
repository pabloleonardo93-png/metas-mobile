import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MfaPage } from './pages/MfaPage';
import { DirectoryPage } from './pages/DirectoryPage';
import { SettingsPage } from './pages/SettingsPage';

const destinationFor = (kind: string): string => {
  if (kind === 'google-only') return '/mfa';
  if (kind === 'verified') return '/dashboard';
  return '/login';
};

const RouteController = (): React.JSX.Element => {
  const { state } = useAuth();
  if (state.kind === 'loading') {
    return (
      <main className="center-state" role="status">
        Validando sessão administrativa…
      </main>
    );
  }
  if (state.kind === 'error') {
    return (
      <main className="center-state">
        <h1>Não foi possível abrir o painel</h1>
        <p>{state.message}</p>
      </main>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          state.kind === 'unauthenticated' ? (
            <LoginPage />
          ) : (
            <Navigate replace to={destinationFor(state.kind)} />
          )
        }
      />
      <Route
        path="/mfa"
        element={
          state.kind === 'google-only' ? (
            <MfaPage />
          ) : (
            <Navigate replace to={destinationFor(state.kind)} />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          state.kind === 'verified' ? (
            <DashboardPage />
          ) : (
            <Navigate replace to={destinationFor(state.kind)} />
          )
        }
      />
      <Route path="*" element={<Navigate replace to={destinationFor(state.kind)} />} />
      {(['pharmacies', 'employees', 'audit'] as const).map((resource) => (
        <Route
          key={resource}
          path={`/${resource}`}
          element={
            state.kind === 'verified' ? (
              <DirectoryPage key={resource} resource={resource} />
            ) : (
              <Navigate replace to={destinationFor(state.kind)} />
            )
          }
        />
      ))}
      <Route
        path="/settings"
        element={
          state.kind === 'verified' ? (
            <SettingsPage />
          ) : (
            <Navigate replace to={destinationFor(state.kind)} />
          )
        }
      />
    </Routes>
  );
};

export const App = (): React.JSX.Element => (
  <BrowserRouter>
    <AuthProvider>
      <RouteController />
    </AuthProvider>
  </BrowserRouter>
);
