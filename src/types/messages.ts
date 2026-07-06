// src/types/messages.ts

import type { AnalyzerConfig, AnalyzerResult, AnalyzerType, RuntimeMode } from './analyzer';
import type { PerformanceScore } from './scoring';
import type { ActionItem } from './actions';

export type MessageType =
  | 'SCAN_REQUEST'
  | 'SCAN_RESULTS'
  | 'START_PROFILING'
  | 'STOP_PROFILING'
  | 'PROFILE_DATA'
  | 'PROFILE_COMPLETE'
  | 'STATE_REQUEST'
  | 'STATE_RESPONSE'
  | 'OVERLAY_SHOW'
  | 'OVERLAY_HIDE'
  | 'OVERLAY_CLEAR_ALL'
  | 'DETECTION_STATUS'
  | 'TAB_NAVIGATED'
  | 'ERROR'
  | 'ANALYTICS_CONSENT_CHANGED'
  | 'ANALYTICS_TRACK_EVENT'
  // Port-based panel commands (forwarded from background)
  | 'START_TRACKING'
  | 'STOP_TRACKING'
  | 'TRACKING_STARTED'
  | 'TRACKING_STOPPED'
  | 'SELECT_COMPONENT'
  | 'CLEAR_DATA'
  // Async events from page-script (forwarded to background)
  | 'EVENT_BATCH'
  | 'LEAK_EVENT'
  | 'TRACKBY_ISSUE'
  | 'ONPUSH_RESULT'
  | 'DEGRADED_MODE'
  | 'ZONE_POLLUTION_EVENT'
  | 'ROUTE_CHANGED'
  | 'FLOW_EVENT_BATCH'
  | 'FRAME_LOADED';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  payload: T;
  tabId?: number;
  timestamp: number;
}

// Page Script <-> Content Script (CustomEvent-based)
export interface PageMessage<T = unknown> {
  eventId: string;
  type: MessageType;
  payload: T;
}

// Scan request payload
export interface ScanRequestPayload {
  analyzers: AnalyzerType[]; // Which analyzers to run
  config?: Partial<AnalyzerConfig>;
}

// Full scan results
export interface ScanResultsPayload {
  detection: DetectionResult;
  score: PerformanceScore;
  results: AnalyzerResult[];
  actionItems: ActionItem[];
}

export interface DetectionResult {
  isAngular: boolean;
  version: string | null;
  mode: RuntimeMode | null;
  componentCount: number;
}
