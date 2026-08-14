export function getEmailError(email: string): string | undefined {
  if (!email.trim()) {
    return 'Informe seu e-mail.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return 'Informe um e-mail válido.';
  }

  return undefined;
}

export function getPasswordError(password: string): string | undefined {
  if (!password) {
    return 'Informe sua senha.';
  }

  if (password.length < 6) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }

  return undefined;
}
