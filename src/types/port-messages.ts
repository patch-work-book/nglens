// src/types/port-messages.ts

export type PortMessageType =
  | 'INIT'
  | 'CONNECTION_ACK'
  | 'START_TRACKING'
  | 'STOP_TRACKING'
  | 'TRACKING_STARTED'
  | 'TRACKING_STOPPED'
  | 'EVENT_BATCH'
  | 'LEAK_EVENT'
  | 'TRACKBY_ISSUE'
  | 'ONPUSH_RESULT'
  | 'SELECT_COMPONENT'
  | 'COMPONENT_DETAIL'
  | 'CLEAR_DATA'
  | 'DEGRADED_MODE'
  | 'TAB_NAVIGATED'
  | 'OVERLAY_SHOW'
  | 'OVERLAY_HIDE'
  | 'OVERLAY_PULSE'
  | 'SCAN_REQUEST'
  | 'SCAN_RESULTS'
  | 'ROUTE_CHANGED'
  | 'ZONE_POLLUTION_EVENT'
  | 'FLOW_EVENT_BATCH'
  | 'FRAME_LOADED'
  | 'ERROR';

export interface PortMessage<T = unknown> {
  type: PortMessageType;
  payload: T;
  tabId?: number;
  timestamp: number;
  frameId?: number;
  frameUrl?: string;
}
