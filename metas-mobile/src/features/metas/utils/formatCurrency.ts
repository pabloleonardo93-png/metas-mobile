import { formatCentsAsBrl, reaisToCents } from '@/shared/utils/brlCurrency';

const decimalFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

export function formatBrazilianCurrency(value: number): string {
  return formatCentsAsBrl(reaisToCents(value) ?? 0);
}

export function formatDecimal(value: number): string {
  return decimalFormatter.format(Number.isFinite(value) && value >= 0 ? value : 0);
}
