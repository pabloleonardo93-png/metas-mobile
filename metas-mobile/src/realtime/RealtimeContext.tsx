import { createContext, useContext } from 'react';

import type { RealtimeEventType, RealtimeListener } from '@/realtime/realtime.types';

export interface RealtimeContextValue {
  subscribe(type: RealtimeEventType, listener: RealtimeListener): () => void;
}

export const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime deve ser usado dentro de RealtimeProvider.');
  }
  return context;
}
