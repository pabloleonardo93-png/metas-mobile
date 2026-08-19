export type RealtimeEventType =
  'campaigns.changed' | 'employees.changed' | 'goal.configuration.changed';

export type RealtimeListener = () => Promise<void> | void;

export interface RealtimeSubscription {
  unsubscribe(): void;
}
