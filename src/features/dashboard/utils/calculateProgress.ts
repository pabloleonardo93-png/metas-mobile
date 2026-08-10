export function calculateProgress(realizado: number, objetivo: number): number {
  if (!Number.isFinite(realizado) || !Number.isFinite(objetivo) || objetivo <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (realizado / objetivo) * 100));
}
