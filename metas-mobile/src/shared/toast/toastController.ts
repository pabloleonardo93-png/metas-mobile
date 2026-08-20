export type ToastType = 'error' | 'info' | 'success';

export interface ToastOptions {
  durationMs?: number;
  message: string;
  type: ToastType;
}

export interface ToastMessage extends Required<ToastOptions> {
  id: number;
}

type ToastListener = (toast: ToastMessage | null) => void;
type TimerHandle = unknown;

interface ToastTimer {
  clear(handle: TimerHandle): void;
  schedule(callback: () => void, durationMs: number): TimerHandle;
}

export interface ToastController {
  dispose(): void;
  getCurrent(): ToastMessage | null;
  hide(): void;
  show(options: ToastOptions): void;
  subscribe(listener: ToastListener): () => void;
}

export const TOAST_DURATION_MS = {
  error: 5_000,
  info: 4_000,
  success: 3_000,
} satisfies Record<ToastType, number>;

const defaultTimer: ToastTimer = {
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  schedule: (callback, durationMs) => setTimeout(callback, durationMs),
};

export function createToastController(timer: ToastTimer = defaultTimer): ToastController {
  const listeners = new Set<ToastListener>();
  let current: ToastMessage | null = null;
  let nextId = 1;
  let timerHandle: TimerHandle | null = null;

  function clearTimer() {
    if (timerHandle !== null) {
      timer.clear(timerHandle);
      timerHandle = null;
    }
  }

  function notify() {
    listeners.forEach((listener) => listener(current));
  }

  function hide() {
    clearTimer();
    if (current === null) return;
    current = null;
    notify();
  }

  return {
    dispose() {
      clearTimer();
      current = null;
      listeners.clear();
    },
    getCurrent: () => current,
    hide,
    show(options) {
      clearTimer();
      const toast: ToastMessage = {
        durationMs: options.durationMs ?? TOAST_DURATION_MS[options.type],
        id: nextId,
        message: options.message,
        type: options.type,
      };
      nextId += 1;
      current = toast;
      notify();
      timerHandle = timer.schedule(() => {
        if (current?.id === toast.id) {
          timerHandle = null;
          current = null;
          notify();
        }
      }, toast.durationMs);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
