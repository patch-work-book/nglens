// src/types/leak-events.ts

import type { SeverityLevel } from './panel';

export interface LeakEvent {
  id: string;
  componentName: string;
  componentId: string;
  leakType: 'subscription' | 'timer' | 'event-listener';
  severity: SeverityLevel;
  source: string;
  createdAt: number;
  detectedAt: number;
  lifecycleState: 'destroyed';
  frameId?: number;
}

export interface ComponentLifecycle {
  componentId: string;
  componentName: string;
  createdAt: number;
  destroyedAt: number | null;
  subscriptions: SubscriptionRecord[];
  timers: TimerRecord[];
}

export interface SubscriptionRecord {
  id: string;
  source: string;
  createdAt: number;
  cleaned: boolean;
  cleanedAt: number | null;
}

export interface TimerRecord {
  id: string;
  type: 'interval' | 'timeout';
  createdAt: number;
  cleared: boolean;
}
