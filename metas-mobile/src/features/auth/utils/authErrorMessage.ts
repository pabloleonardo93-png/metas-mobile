interface AuthErrorLike {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}

export function getLoginErrorMessage(error: unknown): string {
  const errorLike =
    typeof error === 'object' && error !== null ? (error as AuthErrorLike) : undefined;

  if (errorLike?.status === 403 || errorLike?.code === 'ACCESS_NOT_AUTHORIZED') {
    return 'Não foi possível autorizar o acesso desta conta.';
  }
  if (errorLike?.status === 429) {
    return 'Muitas tentativas. Aguarde um momento e tente novamente.';
  }
  if (errorLike?.status === null) {
    return errorLike.code === 'API_NOT_CONFIGURED'
      ? 'A API ainda não está configurada neste aplicativo.'
      : 'Não foi possível conectar ao servidor. Verifique sua conexão.';
  }
  if (errorLike?.message === 'GOOGLE_NOT_CONFIGURED') {
    return 'O acesso Google ainda não está configurado neste build.';
  }
  if (errorLike?.message === 'GOOGLE_NATIVE_ONLY') {
    return 'O acesso Google está disponível no aplicativo Android ou iOS.';
  }

  return 'Não foi possível entrar com o Google. Tente novamente.';
}
