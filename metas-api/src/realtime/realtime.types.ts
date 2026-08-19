export type RealtimeEventType =
  'campaigns.changed' | 'employees.changed' | 'goal.configuration.changed';

export interface RealtimeEvent {
  eventId: string;
  timestamp: string;
  type: RealtimeEventType;
}

export interface RealtimePublisher {
  // Keep business routes independent from the transport so a distributed publisher can replace
  // the in-memory server when the API runs with more than one replica.
  publish(storeId: string, type: RealtimeEventType): void;
}

export const noopRealtimePublisher: RealtimePublisher = {
  publish: () => undefined,
};
