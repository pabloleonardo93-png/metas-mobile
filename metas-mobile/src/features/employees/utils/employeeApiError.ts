interface ApiErrorLike {
  code?: unknown;
  status?: unknown;
}

export function getEmployeeApiErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'Não foi possível carregar a equipe.';
  }

  const apiError = error as ApiErrorLike;
  if (apiError.status === 401) {
    return 'Sua sessão expirou. Entre novamente.';
  }
  if (apiError.status === 403) {
    return 'Você não tem permissão para gerenciar a equipe.';
  }
  if (apiError.status === 409 && apiError.code === 'EMPLOYEE_ALREADY_EXISTS') {
    return 'Já existe um cadastro com este e-mail.';
  }
  if (apiError.status === 409 && apiError.code === 'LAST_ACTIVE_MANAGER_REQUIRED') {
    return 'A loja deve permanecer com pelo menos um Gestor ativo.';
  }
  if (apiError.status === null) {
    return 'Não foi possível conectar ao servidor. Tente novamente.';
  }
  return 'Não foi possível concluir a operação com o funcionário.';
}
