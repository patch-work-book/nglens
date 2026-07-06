// src/types/render-events.ts

export interface RenderEvent {
  componentName: string;
  timestamp: number;
  duration: number;
  causes: RenderCause[];
  /** The component that owns the element the user interacted with (click/input/keydown target) */
  interactionComponent?: string;
  /** CSS-like selector of the element the user interacted with */
  interactionTarget?: string;
  /** Parent component in the render cascade (null if this is the top-level trigger) */
  parentComponent?: string | null;
  /** Depth in the cascade tree (0 = triggered directly, 1 = child of trigger, etc.) */
  depth?: number;
  frameId?: number;
  route?: string;
}

export interface RenderCause {
  type: 'signal' | 'input' | 'zone' | 'parent' | 'manual-cd';
  source?: string;
}

// ── State/Flow Events (RxJS, Signals, Routes, HTTP) ──────────────────────────

export type FlowEventType = 'subject-emit' | 'signal-write' | 'http-response' | 'route-change' | 'user-interaction';

/** A single event in the reactive flow — captures state changes, HTTP, route, and user actions. */
export interface FlowEvent {
  id: string;
  type: FlowEventType;
  timestamp: number;
  /** Human-readable label: "UserService.user$.next()", "click on button.save", etc. */
  label: string;
  /** The service/class that owns this state (if applicable) */
  ownerClass?: string;
  /** The property name (subject name, signal name, etc.) */
  propertyName?: string;
  /** For HTTP: method + URL */
  detail?: string;
  /** For user interactions: the element selector */
  targetSelector?: string;
  /** For route changes: from → to */
  fromRoute?: string;
  toRoute?: string;
  frameId?: number;
  /** Timestamp of the user interaction that caused this flow event (for grouping) */
  triggeredByInteractionTs?: number;
}

/** A batch of flow events dispatched from the page script. */
export interface FlowEventBatch {
  events: FlowEvent[];
  batchTimestamp: number;
}

export interface EventBatch {
  events: RenderEvent[];
  batchTimestamp: number;
  sequenceNumber: number;
}

export interface TemplateExpressionEvent {
  componentName: string;
  expressionName: string;
  expressionType: 'method' | 'getter' | 'pipe';
  duration: number;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  args: string[];
}

export interface TemplateExpressionBatch {
  expressions: TemplateExpressionEvent[];
  batchTimestamp: number;
  componentCount: number;
}
