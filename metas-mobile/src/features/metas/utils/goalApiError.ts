interface ApiErrorLike {
  code?: unknown;
  status?: unknown;
}

export function getGoalApiErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'Não foi possível salvar a configuração. Tente novamente.';
  }

  const apiError = error as ApiErrorLike;
  if (apiError.status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (apiError.status === 403) return 'Você não tem permissão para alterar esta configuração.';
  if (apiError.status === 409 && apiError.code === 'GOAL_CONFIGURATION_CONFLICT') {
    return 'Outro Gestor alterou a configuração. Recarregue e tente novamente.';
  }
  if (apiError.status === 422) return 'Revise os valores informados.';
  if (apiError.status === null) return 'Não foi possível conectar ao servidor. Tente novamente.';
  return 'Não foi possível salvar a configuração. Tente novamente.';
}

export function getGoalLoadErrorMessage(error: unknown): string {
  const message = getGoalApiErrorMessage(error);
  return message.includes('salvar') ? 'Não foi possível carregar a configuração.' : message;
}
