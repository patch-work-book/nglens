// src/types/zone-pollution-events.ts

export type ZonePollutionSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface TaskRecord {
  source: string;          // e.g., "setTimeout", "addEventListener:scroll"
  type: 'macroTask' | 'microTask' | 'eventTask';
  timestamp: number;       // performance.now()
  triggeredCd: boolean;    // Was a CD cycle attributed to this task?
  library?: string;        // Extracted from stack trace
}

export interface PollutionSourceMetrics {
  source: string;
  type: string;
  library?: string;
  cdCyclesPerMinute: number;
  severity: ZonePollutionSeverity;
  taskCount: number;
  lastSeen: number;
  fixSuggestion?: string;
  frameId?: number;
  route?: string;
}

export interface ZonePollutionEvent {
  sources: PollutionSourceMetrics[];  // Top 10, ranked
  totalCdCycles: number;
  windowDurationMs: number;
  timestamp: number;
}
