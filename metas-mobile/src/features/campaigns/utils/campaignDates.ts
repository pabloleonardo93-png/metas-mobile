const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function buildIsoDate(day: number, month: number, year: number): string | null {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatBrazilianDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseBrazilianDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  return buildIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  return buildIsoDate(Number(match[3]), Number(match[2]), Number(match[1])) === value;
}

export function formatCampaignDate(value: string): string {
  const match = ISO_DATE_PATTERN.exec(value);

  if (!match || !isValidIsoDate(value)) {
    return '--/--/----';
  }

  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatCampaignPeriod(startDate: string, endDate: string): string {
  return `${formatCampaignDate(startDate)} - ${formatCampaignDate(endDate)}`;
}
