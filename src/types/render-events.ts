// src/types/render-events.ts

/**
 * Rich, structured description of a user interaction, captured at the DOM
 * source. Used to classify and label the interaction accurately in the panel.
 */
export interface InteractionInfo {
  /** DOM event type: 'click' | 'input' | 'keydown' | 'change' | 'pointerdown' | 'submit' ... */
  eventType: string;
  /** Lowercased tag name of the target element: 'button' | 'a' | 'input' | 'select' ... */
  tag: string;
  /** The `type` attribute for inputs/buttons: 'text' | 'checkbox' | 'submit' | 'radio' ... */
  inputType?: string;
  /** ARIA role, if present. */
  role?: string;
  /** True if the element (or an ancestor) is an anchor with an href. */
  isLink?: boolean;
  /** True if the element resolves to a button (tag, role, or submit/button input). */
  isButton?: boolean;
  /** True if the element is a text-entry field. */
  isTextField?: boolean;
  /**
   * Best human-readable name for the target: accessible name derived from
   * aria-label / title / textContent / value / placeholder / alt / name.
   */
  accessibleName?: string;
  /** For keydown events: the key that was pressed. */
  key?: string;
}

export interface RenderEvent {
  componentName: string;
  timestamp: number;
  duration: number;
  causes: RenderCause[];
  /** Grouped reasons why this component rendered (derived from causes) */
  reasons?: RenderReason[];
  /** The component that owns the element the user interacted with (click/input/keydown target) */
  interactionComponent?: string;
  /** CSS-like selector of the element the user interacted with */
  interactionTarget?: string;
  /**
   * Structured metadata about the user interaction that triggered this render.
   * Captured at the source (render-tracker) so the panel can label chips
   * accurately (e.g. "Click Save button", "Type in Search") instead of
   * re-parsing a lossy selector string.
   */
  interactionInfo?: InteractionInfo;
  /** Parent component in the render cascade (null if this is the top-level trigger) */
  parentComponent?: string | null;
  /** Depth in the cascade tree (0 = triggered directly, 1 = child of trigger, etc.) */
  depth?: number;
  frameId?: number;
  // CD-MER metrics
  cdCount?: number;
  mutationCount?: number;
  // Custom template metrics from Ivy context
  totalTemplateBindings?: number;
  totalOutputListeners?: number;
  hasHighFrequencyZonePollution?: boolean;
  highFrequencyEvents?: string[];
  /** Spatial metadata for "Blast Radius" heatmap */
  spatialMetadata?: {
    top: number;
    left: number;
    width: number;
    height: number;
    selector: string;
  };
}

export interface RenderCause {
  type: 'signal' | 'input' | 'zone' | 'parent' | 'manual-cd';
  source?: string;
}

/** Grouped reasons why a component re-rendered (for UI aggregation) */
export interface RenderReason {
  /** Type of trigger: signal write, input change, parent render, zone event, API response, route change */
  type: 'signal' | 'input' | 'parent' | 'zone' | 'api' | 'route';
  /** The specific source (signal name, input name, parent name, API endpoint, route, etc.) */
  source: string;
  /** Before value (if tracked) */
  before?: string | number | boolean;
  /** After value (if tracked) */
  after?: string | number | boolean;
  /** How many render events had this reason */
  count: number;
  /** Color hint for UI (e.g., 'signal-color', 'input-color', etc.) */
  colorClass?: string;
}

// ── State/Flow Events (RxJS, Signals, Routes, HTTP) ──────────────────────────

export type FlowEventType = 'subject-emit' | 'signal-write' | 'http-response' | 'route-change' | 'user-interaction' | 'websocket' | 'facade-method' | 'store-dispatch' | 'store-select';

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
  /** For subject emissions: which component triggered this (e.g., HeaderNavComponent) */
  sourceComponent?: string;
  /** For subject emissions: which components/services are subscribing to this (e.g., ["SidebarComponent", "FooterComponent"]) */
  subscribers?: string[];
  /** The value being emitted/written (stringified for display) */
  value?: string;
  /** For websocket: connection status or message type */
  connectionStatus?: 'connected' | 'disconnected' | 'connecting';
  /** For store/facade: method name being called */
  methodName?: string;
  /** For store actions: action name (NgRx) */
  actionName?: string;
  /** For store selectors: selector name (NgRx) */
  selectorName?: string;
  frameId?: number;
  /** Timestamp of the user interaction that caused this flow event (for grouping) */
  triggeredByInteractionTs?: number;
  /** For HTTP: the response body (stringified for display, typically first 500 chars) */
  responseBody?: string;
  /** For HTTP: request duration in ms (time from request sent to response received) */
  duration?: number;
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
