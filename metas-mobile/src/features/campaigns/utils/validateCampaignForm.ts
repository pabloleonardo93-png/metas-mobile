import type {
  CampaignFormErrors,
  CampaignFormValues,
} from '@/features/campaigns/types/campaign.types';
import { parseBrazilianDate } from '@/features/campaigns/utils/campaignDates';
import { parseBrlCurrencyToCents } from '@/shared/utils/brlCurrency';

export function validateCampaignForm(values: CampaignFormValues): CampaignFormErrors {
  const errors: CampaignFormErrors = {};
  const targetAmountCents = parseBrlCurrencyToCents(values.targetAmount);
  const targetQuantity = Number(values.targetQuantity);
  const startDate = parseBrazilianDate(values.startDate);
  const endDate = parseBrazilianDate(values.endDate);

  if (!values.name.trim()) {
    errors.name = 'Informe a marca ou o produto.';
  } else if (values.name.trim().length > 120) {
    errors.name = 'Use no máximo 120 caracteres.';
  }

  if (!values.targetQuantity.trim()) {
    errors.targetQuantity = 'Informe a quantidade a vender.';
  } else if (!/^\d+$/.test(values.targetQuantity) || !Number.isInteger(targetQuantity)) {
    errors.targetQuantity = 'Use somente números inteiros.';
  } else if (targetQuantity <= 0) {
    errors.targetQuantity = 'A quantidade deve ser maior que zero.';
  } else if (targetQuantity > 1_000_000_000) {
    errors.targetQuantity = 'A quantidade informada é muito alta.';
  }

  if (!values.targetAmount.trim()) {
    errors.targetAmount = 'Informe o valor financeiro da meta.';
  } else if (targetAmountCents === null) {
    errors.targetAmount = 'Informe um valor monetário válido.';
  } else if (targetAmountCents <= 0) {
    errors.targetAmount = 'O valor da meta deve ser maior que zero.';
  }

  if (!values.startDate.trim()) {
    errors.startDate = 'Informe a data inicial.';
  } else if (!startDate) {
    errors.startDate = 'Informe uma data válida no formato DD/MM/AAAA.';
  }

  if (!values.endDate.trim()) {
    errors.endDate = 'Informe a data final.';
  } else if (!endDate) {
    errors.endDate = 'Informe uma data válida no formato DD/MM/AAAA.';
  } else if (startDate && endDate < startDate) {
    errors.endDate = 'A data final não pode ser anterior à inicial.';
  }

  return errors;
}
