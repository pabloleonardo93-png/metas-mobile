const brazilianCurrencyFormatter = new Intl.NumberFormat('pt-BR', {
  currency: 'BRL',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: 'currency',
});

export function formatBrazilianCurrency(value: number): string {
  return brazilianCurrencyFormatter.format(value);
}

export function formatPercentage(value: number, maximumFractionDigits = 1): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits }).format(value)}%`;
}
