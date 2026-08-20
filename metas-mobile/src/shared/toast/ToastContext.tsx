import { createContext, useContext } from 'react';

import type { ToastOptions } from '@/shared/toast/toastController';

export interface ToastContextValue {
  hideToast(): void;
  showToast(options: ToastOptions): void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast deve ser usado dentro de ToastProvider.');
  }
  return context;
}
