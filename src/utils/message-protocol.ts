import type { ExtensionMessage, MessageType, PageMessage } from '../types/messages';

const MESSAGE_TYPES = [
  'SCAN_REQUEST',
  'SCAN_RESULTS',
  'START_PROFILING',
  'STOP_PROFILING',
  'PROFILE_DATA',
  'PROFILE_COMPLETE',
  'STATE_REQUEST',
  'STATE_RESPONSE',
  'OVERLAY_SHOW',
  'OVERLAY_HIDE',
  'OVERLAY_CLEAR_ALL',
  'DETECTION_STATUS',
  'TAB_NAVIGATED',
  'ERROR',
  'ANALYTICS_CONSENT_CHANGED',
  'ANALYTICS_TRACK_EVENT',
  'START_TRACKING',
  'STOP_TRACKING',
  'TRACKING_STARTED',
  'TRACKING_STOPPED',
  'SELECT_COMPONENT',
  'CLEAR_DATA',
  'EVENT_BATCH',
  'LEAK_EVENT',
  'TRACKBY_ISSUE',
  'ONPUSH_RESULT',
  'DEGRADED_MODE',
  'ZONE_POLLUTION_EVENT',
  'ROUTE_CHANGED',
  'FLOW_EVENT_BATCH',
] as const satisfies readonly MessageType[];

const PAGE_SCRIPT_RESPONSE_TYPES = [
  'SCAN_RESULTS',
  'DETECTION_STATUS',
  'ERROR',
] as const satisfies readonly MessageType[];

const PAGE_SCRIPT_ASYNC_EVENT_TYPES = [
  'EVENT_BATCH',
  'LEAK_EVENT',
  'TRACKBY_ISSUE',
  'ONPUSH_RESULT',
  'DEGRADED_MODE',
  'ROUTE_CHANGED',
  'TRACKING_STARTED',
  'TRACKING_STOPPED',
  'ERROR',
  'ZONE_POLLUTION_EVENT',
  'FLOW_EVENT_BATCH',
] as const satisfies readonly MessageType[];

const PANEL_COMMAND_TYPES = [
  'START_TRACKING',
  'STOP_TRACKING',
  'SELECT_COMPONENT',
  'CLEAR_DATA',
] as const satisfies readonly MessageType[];

const messageTypeSet = new Set<string>(MESSAGE_TYPES);
const responseTypeSet = new Set<string>(PAGE_SCRIPT_RESPONSE_TYPES);
const asyncEventTypeSet = new Set<string>(PAGE_SCRIPT_ASYNC_EVENT_TYPES);
const panelCommandTypeSet = new Set<string>(PANEL_COMMAND_TYPES);

const RENDER_CAUSE_TYPES = new Set(['signal', 'input', 'zone', 'parent', 'manual-cd']);
const SEVERITY_LEVELS = new Set(['CRITICAL', 'WARNING', 'INFO']);
const LEAK_TYPES = new Set(['subscription', 'timer', 'event-listener']);
const ZONE_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

const MAX_STRING_LENGTH = 500;
const MAX_BATCH_EVENTS = 1000;
const MAX_CAUSES_PER_EVENT = 10;
const MAX_ZONE_SOURCES = 50;

export function isMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && messageTypeSet.has(value);
}

export function isPageScriptResponseType(type: MessageType): boolean {
  return responseTypeSet.has(type);
}

export function isPageScriptAsyncEventType(type: MessageType): boolean {
  return asyncEventTypeSet.has(type);
}

export function isPanelCommandType(type: MessageType): boolean {
  return panelCommandTypeSet.has(type);
}

export function normalizePageMessage(value: unknown): PageMessage | null {
  if (!isRecord(value)) return null;
  if (!isMessageType(value.type)) return null;
  if (!isBoundedString(value.eventId, 160)) return null;

  const message: PageMessage = {
    eventId: value.eventId,
    type: value.type,
    payload: value.payload,
  };

  return isPageMessagePayloadValid(message) ? message : null;
}

export function normalizeExtensionMessage(value: unknown): ExtensionMessage | null {
  if (!isRecord(value)) return null;
  if (!isMessageType(value.type)) return null;

  return {
    type: value.type,
    payload: value.payload,
    tabId: isFiniteNumber(value.tabId) ? value.tabId : undefined,
    timestamp: isFiniteNumber(value.timestamp) ? value.timestamp : Date.now(),
  };
}

export function isPageMessagePayloadValid(message: PageMessage): boolean {
  switch (message.type) {
    case 'EVENT_BATCH':
      return isEventBatchPayload(message.payload);
    case 'LEAK_EVENT':
      return isLeakEventPayload(message.payload);
    case 'TRACKBY_ISSUE':
      return isTrackByIssuePayload(message.payload);
    case 'ONPUSH_RESULT':
      return isOnPushResultPayload(message.payload);
    case 'ZONE_POLLUTION_EVENT':
      return isZonePollutionPayload(message.payload);
    case 'ERROR':
      return isErrorPayload(message.payload);
    case 'TRACKING_STARTED':
    case 'TRACKING_STOPPED':
    case 'DEGRADED_MODE':
    case 'ROUTE_CHANGED':
      return message.payload == null || isRecord(message.payload);
    case 'SCAN_RESULTS':
    case 'DETECTION_STATUS':
      return isRecord(message.payload);
    default:
      return true;
  }
}

function isEventBatchPayload(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.events)) return false;
  if (value.events.length > MAX_BATCH_EVENTS) return false;
  return value.events.every(isRenderEventPayload);
}

function isRenderEventPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isBoundedString(value.componentName)) return false;
  if (!isNonNegativeFiniteNumber(value.timestamp) || !isNonNegativeFiniteNumber(value.duration)) return false;
  if (!Array.isArray(value.causes) || value.causes.length > MAX_CAUSES_PER_EVENT) return false;
  return value.causes.every(isRenderCausePayload);
}

function isRenderCausePayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string' || !RENDER_CAUSE_TYPES.has(value.type)) return false;
  return value.source === undefined || isBoundedString(value.source);
}

function isLeakEventPayload(value: unknown): boolean {
  return isRecord(value) &&
    isBoundedString(value.id) &&
    isBoundedString(value.componentName) &&
    isBoundedString(value.componentId) &&
    typeof value.leakType === 'string' &&
    LEAK_TYPES.has(value.leakType) &&
    typeof value.severity === 'string' &&
    SEVERITY_LEVELS.has(value.severity) &&
    isBoundedString(value.source) &&
    isNonNegativeFiniteNumber(value.createdAt) &&
    isNonNegativeFiniteNumber(value.detectedAt) &&
    value.lifecycleState === 'destroyed';
}

function isTrackByIssuePayload(value: unknown): boolean {
  return isRecord(value) &&
    isBoundedString(value.id) &&
    isBoundedString(value.componentName) &&
    isBoundedString(value.collectionProperty) &&
    isNonNegativeFiniteNumber(value.collectionSize) &&
    typeof value.severity === 'string' &&
    SEVERITY_LEVELS.has(value.severity) &&
    isBoundedString(value.recommendation, 1200);
}

function isOnPushResultPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isBoundedString(value.component)) return false;
  if (!isNumberInRange(value.score, 0, 100)) return false;
  if (value.currentStrategy !== 'Default' && value.currentStrategy !== 'OnPush') return false;
  if (!Array.isArray(value.factors) || value.factors.length > 20) return false;
  if (!isBoundedString(value.recommendation, 1200)) return false;

  return value.factors.every((factor) =>
    isRecord(factor) &&
    isBoundedString(factor.name) &&
    isNumberInRange(factor.weight, 0, 1) &&
    typeof factor.met === 'boolean' &&
    isBoundedString(factor.description, 1200)
  );
}

function isZonePollutionPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.sources) || value.sources.length > MAX_ZONE_SOURCES) return false;
  if (!isNonNegativeFiniteNumber(value.totalCdCycles)) return false;
  const hasValidWindow = value.zonelessMode === true
    ? isNonNegativeFiniteNumber(value.windowDurationMs)
    : isPositiveFiniteNumber(value.windowDurationMs);
  if (!hasValidWindow) return false;
  if (!isNonNegativeFiniteNumber(value.timestamp)) return false;

  return value.sources.every((source) =>
    isRecord(source) &&
    isBoundedString(source.source) &&
    isBoundedString(source.type) &&
    (source.library === undefined || isBoundedString(source.library)) &&
    isNonNegativeFiniteNumber(source.cdCyclesPerMinute) &&
    typeof source.severity === 'string' &&
    ZONE_SEVERITIES.has(source.severity) &&
    isNonNegativeFiniteNumber(source.taskCount) &&
    isNonNegativeFiniteNumber(source.lastSeen) &&
    (source.fixSuggestion === undefined || isBoundedString(source.fixSuggestion, 1200))
  );
}

function isErrorPayload(value: unknown): boolean {
  return isRecord(value) && isBoundedString(value.message, 1200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function isBoundedString(value: unknown, maxLength = MAX_STRING_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}
