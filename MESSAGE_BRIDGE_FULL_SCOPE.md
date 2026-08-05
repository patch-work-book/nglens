# Message Bridge — Full Scope Across ngLens

No, the message bridge is **NOT just for Execution Explorer**. It's the nervous system of the entire extension. Here's what it actually enables:

---

## The 4 Message Types ngLens Supports

From `src/types/messages.ts`, here's the complete protocol:

```
V1 Commands (Request/Response):
  - SCAN_REQUEST          → "Analyze this page for Angular"
  - SCAN_RESULTS          ← "Here's what we found"
  - DETECTION_STATUS      → "Is this Angular?"
  - OVERLAY_SHOW          → "Highlight this element"
  - OVERLAY_HIDE          → "Stop highlighting"
  - OVERLAY_CLEAR_ALL     → "Clear all highlights"
  - ERROR                 ← "Something went wrong"

V2 Commands (Fire & Forget):
  - START_TRACKING        → "Start recording execution"
  - STOP_TRACKING         → "Stop recording"
  - TRACKING_STARTED      ← "Recording started"
  - TRACKING_STOPPED      ← "Recording stopped"
  - SELECT_COMPONENT      → "Focus on this component"
  - CLEAR_DATA            → "Clear all collected data"

V2 Async Events (Background → Panel):
  - EVENT_BATCH           ← "Here are execution steps"
  - LEAK_EVENT            ← "Memory leak detected"
  - TRACKBY_ISSUE         ← "Missing trackBy function"
  - ONPUSH_RESULT         ← "Change detection issue found"
  - DEGRADED_MODE         ← "Performance budget exceeded"
  - ZONE_POLLUTION_EVENT  ← "Zone.js misuse detected"
  - ROUTE_CHANGED         ← "User navigated"
  - FLOW_EVENT_BATCH      ← "Data flow events"
  - FRAME_LOADED          ← "New frame detected"
```

---

## Communication Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ DEVTOOLS PANEL (devtools/panel/app/*.component.ts)          │
│                                                             │
│ ├─ ExecutionExplorerComponent                              │
│ ├─ RenderingInspectorComponent                             │
│ ├─ PerformanceOverviewComponent                            │
│ ├─ MemoryAnalyzerComponent                                 │
│ └─ RecommendationsComponent                                │
│                                                             │
│ Uses: chrome.runtime.Port (port-based, persistent)         │
└─────────────────────────────────────────────────────────────┘
              port.postMessage ↕ port.onMessage
┌─────────────────────────────────────────────────────────────┐
│ BACKGROUND SERVICE WORKER (src/background/background.ts)    │
│                                                             │
│ Routes messages between:                                   │
│ - DevTools Panel ↔ Content Script                          │
│ - Manages tab/session state                                │
│ - Tracks frame IDs across tabs                             │
│                                                             │
│ Key: panelPorts Map<tabId, chrome.runtime.Port>            │
└─────────────────────────────────────────────────────────────┘
    chrome.runtime.sendMessage ↕ chrome.runtime.onMessage
┌─────────────────────────────────────────────────────────────┐
│ CONTENT SCRIPT (src/content/content.ts)                     │
│                                                             │
│ Uses MESSAGE BRIDGE:                                       │
│ ├─ sendToBackground()       → forward events to background │
│ ├─ dispatchToPage()         → send commands to page-script │
│ ├─ listenFromPage()         → receive results from page    │
│ └─ listenFromExtension()    → receive commands from bkgnd  │
│                                                             │
│ Responsibilities:                                          │
│ ├─ Inject page-script.js lazily                            │
│ ├─ Relay scan requests → page → background                │
│ ├─ Forward async events (LEAK, TRACKBY, etc.)              │
│ └─ Enforce timeouts & retries                              │
└─────────────────────────────────────────────────────────────┘
    CustomEvent ↕ CustomEvent (__ng_perf_to_page, from_page)
┌─────────────────────────────────────────────────────────────┐
│ PAGE SCRIPT (src/content/page-script.ts)                    │
│                                                             │
│ ├─ Instrumentation Orchestrator                            │
│ │  ├─ Detect Angular                                       │
│ │  ├─ Run Analyzers (7 total)                              │
│ │  │  ├─ PerformanceScorerAnalyzer                         │
│ │  │  ├─ DomInspectorAnalyzer                              │
│ │  │  ├─ ProductionAnalyzerAnalyzer                        │
│ │  │  ├─ EnterpriseOptimizerAnalyzer                       │
│ │  │  ├─ BestPracticesDetectorAnalyzer                     │
│ │  │  ├─ SubscriptionLeakDetectorAnalyzer                  │
│ │  │  └─ SignalsAnalyzer                                   │
│ │  └─ Monitor Performance Budget                           │
│ │     ├─ CPU < 3%                                          │
│ │     └─ Memory < 50MB                                     │
│ │                                                           │
│ ├─ Overlay Renderer                                        │
│ │  ├─ showOverlay(component)                               │
│ │  ├─ hideOverlay(id)                                      │
│ │  └─ clearAllOverlays()                                   │
│ │                                                           │
│ └─ Execution Step Recorder (V2)                            │
│    ├─ Record API calls                                     │
│    ├─ Track store updates                                  │
│    ├─ Monitor signal emissions                             │
│    ├─ Capture component renders                            │
│    └─ Send EVENT_BATCH → content → background → panel      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Where Message Bridge Is Used (Not Just Execution Explorer!)

### 1. **Rendering Inspector Panel**
```typescript
// User clicks "Why did this component render?"
// Panel sends query via port
port.postMessage({
  type: 'SELECT_COMPONENT',
  payload: { componentName: 'RevenueChart' }
});

// Background routes to content script via MESSAGE_BRIDGE
// sendToBackground() → chrome.runtime.sendMessage()
//   ↓
// Content script dispatchToPage() with CustomEvent
//   ↓
// Page script records and sends back EVENT_BATCH
//   ↓
// Rendering Inspector shows "Rendered because Signal changed"
```

### 2. **Performance Overview Panel**
```typescript
// User opens Performance Overview
// Panel sends START_TRACKING via port
port.postMessage({ type: 'START_TRACKING' });

// Background → Content (MESSAGE_BRIDGE)
// Content → Page Script (CustomEvent via dispatchToPage)
// Page Script starts instrumentation

// Page Script detects performance violations
// Sends DEGRADED_MODE event via listenFromPage
// Content relays to Background via sendToBackground
// Background broadcasts to Panel via port
// Panel displays "⚠️ CPU budget exceeded"
```

### 3. **Memory Analyzer Panel**
```typescript
// User navigates the page
// Page Script records memory state via EVENT_BATCH
// Content receives via listenFromPage()
// Relays to Background via sendToBackground()
// Background forwards to Memory Analyzer Panel via port

// Panel shows:
// - Memory growth over time
// - Leak detection (from LEAK_EVENT messages)
// - Subscription cleanup warnings
```

### 4. **Recommendations Panel**
```typescript
// Page Script runs BestPracticesDetectorAnalyzer
// Detects: TrackBy missing, OnPush not used, etc.
// Sends TRACKBY_ISSUE event via listenFromPage()
// Content relays via sendToBackground()
// Background forwards to Recommendations Panel
// Panel shows actionable fixes with estimated improvement
```

### 5. **Execution Explorer (Finally!)** ✨
```typescript
// Page Script records causality chains
// Sends EVENT_BATCH (100+ execution steps)
// Content receives via listenFromPage()
// Relays via sendToBackground()
// Background forwards to Execution Explorer
// Execution Explorer runs CausalityChainDetectorService
// Shows: "Load Revenue" → "Load Orders" → "Render Dashboard"
```

---

## Message Bridge Functions & Their Usage

### `sendToBackground<T>(message)`

**Used by:** Content Script
**Purpose:** Relay data from page → background

```typescript
// In content.ts

// Forward async events (memory leaks, performance issues, etc.)
sendToBackground({
  type: 'EVENT_BATCH',
  payload: executionSteps,
  timestamp: Date.now(),
});

// Forward errors
sendToBackground({
  type: 'ERROR',
  payload: { message: 'Page script injection failed' },
  timestamp: Date.now(),
});

// Notify about frame loads
sendToBackground({
  type: 'FRAME_LOADED',
  payload: { url: window.location.href, isTop: true },
  timestamp: Date.now(),
});
```

### `listenFromPage(handler)`

**Used by:** Content Script
**Purpose:** Receive results from page script

```typescript
// In content.ts

listenFromPage((message) => {
  // page-script.ts sent a result via CustomEvent
  
  if (message.type === 'SCAN_RESULTS') {
    // Scan finished! Relay to background
    sendToBackground({
      type: 'SCAN_RESULTS',
      payload: message.payload,
      timestamp: Date.now(),
    });
  }
  
  if (message.type === 'ERROR') {
    // Page script error! Relay it
    sendToBackground(message);
  }
  
  if (message.type === 'EVENT_BATCH') {
    // Execution events! These go to Execution Explorer panel
    sendToBackground(message);
  }
});
```

### `dispatchToPage<T>(type, payload, eventId)`

**Used by:** Content Script
**Purpose:** Send commands to page script

```typescript
// In content.ts

// User clicked "Start Profiling" in DevTools panel
// Background sends START_TRACKING command
// Content dispatches to page-script:
dispatchToPage('START_TRACKING', { 
  analyzers: ['performance-scorer', 'signals-analyzer'] 
}, eventId);

// User clicked "Highlight component" in Rendering Inspector
// Background forwards command
// Content dispatches to page-script:
dispatchToPage('SELECT_COMPONENT', { 
  componentName: 'RevenueChart' 
}, eventId);

// Panel user clicks "Show me overlay on this element"
dispatchToPage('OVERLAY_SHOW', {
  elementSelector: '[app-revenue-chart]'
}, eventId);
```

### `listenFromExtension(handler)`

**Used by:** Content Script
**Purpose:** Receive commands from background

```typescript
// In content.ts

listenFromExtension((message, sender, sendResponse) => {
  // Background relayed a panel command
  
  if (message.type === 'START_TRACKING') {
    // Dispatch to page-script via dispatchToPage()
    dispatchToPage('START_TRACKING', message.payload, eventId);
    sendResponse({ success: true });
  }
  
  if (message.type === 'OVERLAY_SHOW') {
    dispatchToPage('OVERLAY_SHOW', message.payload, eventId);
    sendResponse({ success: true });
  }
});
```

---

## Complete Data Flow Examples

### Example 1: "Show Why This Component Rendered"

```
1. User clicks component in Rendering Inspector panel
   rendering-inspector.component.ts
        ↓ port.postMessage()
   
2. Background receives port message
   background.ts → sendPanelMessageToContent()
        ↓ chrome.runtime.sendMessage()
   
3. Content script receives in listenFromExtension()
   content.ts
        ↓ dispatchToPage() [MESSAGE BRIDGE]
   
4. Page script receives CustomEvent
   page-script.ts → handleContentMessage()
        ↓ Analyzes component render reasons
   
5. Page script sends result via CustomEvent
   dispatchResult() [MESSAGE BRIDGE call]
        ↓ globalThis.dispatchEvent(CustomEvent)
   
6. Content script receives via listenFromPage() [MESSAGE BRIDGE]
   content.ts
        ↓ sendToBackground() [MESSAGE BRIDGE]
   
7. Background receives and forwards to panel
   background.ts → forwardToPanel()
        ↓ port.postMessage()
   
8. Panel receives and updates UI
   rendering-inspector.component.ts
        ↓
   Shows: "RevenueChart rendered because:
           - Signal @Input changed"
```

### Example 2: "Record Execution and Show Causality"

```
1. User opens Execution Explorer panel
   execution-explorer.component.ts
        ↓ port.postMessage({ type: 'START_TRACKING' })
   
2. Background routes to content
   background.ts
        ↓ chrome.runtime.sendMessage() [MESSAGE BRIDGE via relay]
   
3. Content dispatches to page-script
   content.ts → dispatchToPage() [MESSAGE BRIDGE]
        ↓
   
4. Page script starts recording execution steps
   page-script.ts → initOrchestrator()
        ↓ Every Angular event creates ExecutionStep
   
5. After each step, page script sends EVENT_BATCH
   CustomEvent dispatch [MESSAGE BRIDGE path]
        ↓
   
6. Content receives via listenFromPage() [MESSAGE BRIDGE]
   content.ts
        ↓ sendToBackground() [MESSAGE BRIDGE]
   
7. Background broadcasts to panel
   background.ts → forwardToPanel()
        ↓
   
8. Execution Explorer panel receives EVENT_BATCH
   execution-explorer.component.ts
        ↓ executionIntelligence.addExecutionSteps(batch)
        ↓ computed signals recalculate
   
9. CausalityChainDetectorService analyzes steps
   Converts 100 low-level steps into 4 chains:
     - "Load Revenue" 
     - "Load Orders"
     - "Render Summary"
     - "Render Metrics"
   
10. UI updates with business-intent chapters
    "🎯 Dashboard Bootstrap | 986ms | 6 APIs | 18 Renders | Score 90"
```

---

## Why Message Bridge Is Critical

| Component | Depends On | Why |
|-----------|-----------|-----|
| **Execution Explorer** | `listenFromPage`, `sendToBackground` | Needs to receive EVENT_BATCH execution steps and send START_TRACKING commands |
| **Rendering Inspector** | `dispatchToPage`, `listenFromPage`, `sendToBackground` | Needs to query page-script about render reasons, get results back |
| **Performance Overview** | `dispatchToPage`, `listenFromPage`, `sendToBackground` | Needs to trigger scans, receive performance data |
| **Memory Analyzer** | `listenFromPage`, `sendToBackground` | Needs to receive memory leak events (LEAK_EVENT) |
| **Recommendations** | `listenFromPage`, `sendToBackground` | Needs to receive analysis results (TRACKBY_ISSUE, ONPUSH_RESULT) |
| **Overlay System** | `dispatchToPage` | Needs to trigger highlights via OVERLAY_SHOW/HIDE |
| **Error Handling** | `sendToBackground` | All panels depend on error reporting |

**All 5 panels** depend on the message bridge!

---

## The 3-Phase Message Bridge Pattern

Every panel operation follows this pattern:

```
PHASE 1: SEND COMMAND
┌─────────────────────────────────────────┐
│ Panel sends command via port            │
│ Background receives & routes            │
│ Content receives via listenFromExtension│
│ Content calls dispatchToPage()          │ ← MESSAGE BRIDGE
│ Page script receives CustomEvent        │
└─────────────────────────────────────────┘

PHASE 2: PAGE SCRIPT PROCESSES
┌─────────────────────────────────────────┐
│ Analyzes, instruments, or queries       │
│ Performs DOM traversal or instrumentation
│ Collects data                           │
└─────────────────────────────────────────┘

PHASE 3: SEND RESULT
┌─────────────────────────────────────────┐
│ Page script sends result via CustomEvent│
│ Content receives via listenFromPage()   │ ← MESSAGE BRIDGE
│ Content calls sendToBackground()        │ ← MESSAGE BRIDGE
│ Background receives & relays to panel   │
│ Panel receives via port.onMessage()     │
│ Panel UI updates                        │
└─────────────────────────────────────────┘
```

---

## Error Handling in Message Bridge

The message bridge handles extension reload gracefully:

```typescript
// When extension is reloaded:
// 1. chrome.runtime.id becomes undefined
// 2. chrome.runtime.sendMessage() throws

export function sendToBackground<T>(message: ExtensionMessage<T>): Promise<unknown> {
  try {
    if (!chrome.runtime?.id) {
      // Extension reloaded — silently resolve
      return Promise.resolve();
    }
    return chrome.runtime.sendMessage(message);
  } catch {
    // Any error — silently resolve
    return Promise.resolve();
  }
}

// Result: Page stays running, devtools reconnect when extension is back
```

---

## Summary

**The message bridge is NOT just for Execution Explorer.**

It's the **complete communication infrastructure** for all 5 devtools panels:

✅ **Execution Explorer** — Receives execution steps, shows causality chains
✅ **Rendering Inspector** — Queries render reasons, shows why each component rendered
✅ **Performance Overview** — Triggers scans, receives performance data
✅ **Memory Analyzer** — Receives memory leak events, tracks leak detection
✅ **Recommendations** — Receives best practices violations, shows actionable fixes

All panels use the same 4 message bridge functions. All follow the same 3-phase pattern. All depend on the message bridge working correctly.

**It's the nervous system. Everything else is just organs.**

