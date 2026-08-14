const brazilianCurrencyFormatter = new Intl.NumberFormat('pt-BR', {
  currency: 'BRL',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: 'currency',
});

export function formatBrazilianCurrency(value: number): string {
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;

  return brazilianCurrencyFormatter.format(safeValue);
}

export function formatPercentage(value: number, maximumFractionDigits = 1): string {
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;

  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits }).format(safeValue)}%`;
}
