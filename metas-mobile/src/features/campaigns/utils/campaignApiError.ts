import { ApiError } from '@/shared/api/apiClient';

export function getCampaignApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão expirou. Entre novamente.';
    if (error.status === 403) return 'Você não tem permissão para alterar campanhas.';
    if (error.code === 'CAMPAIGN_CONFLICT') {
      return 'A campanha foi alterada por outro Gestor. Recarregue e tente novamente.';
    }
    if (error.code === 'CAMPAIGN_CLOSED') return 'Esta campanha já está encerrada.';
    if (error.status === 422) return 'Revise os dados informados para a campanha.';
    if (error.status === null) return 'Não foi possível conectar ao servidor.';
  }

  return 'Não foi possível concluir a operação com a campanha.';
}
