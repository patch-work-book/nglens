# Message Bridge — Technical & UX Analysis (Execution Explorer Focus)

## Quick Overview

**What is it?** The communication layer that sends execution data from the Angular app to the Execution Explorer panel.

**For Execution Explorer, it does:**
```
Angular App (Page Script)
        ↕ CustomEvents (EVENT_BATCH)
Content Script
        ↕ chrome.runtime
Background Worker
        ↕ chrome.runtime.Port
Execution Explorer Panel
```

**Why it matters for Execution Explorer?** Without this, execution steps never reach the panel, and you can't build causality chains.

---

## The Problem It Solves (For Execution Explorer)

Execution Explorer needs to see what's happening inside Angular:
- API calls (`GET /revenue`)
- Store updates (`updateRevenue`)
- Signal emissions (`RevenueSignal emitted`)
- Component renders (`RevenueChart rendered`)

But these happen in the Angular app (main world), and Execution Explorer runs in the extension (isolated world). They're security-isolated. The message bridge connects them.

### The 2 Worlds That Need to Talk

```
┌─────────────────────────────────────────┐
│ MAIN WORLD (Angular App)                │
│ - Has access to Angular internals       │
│ - Records execution steps               │
│ - CAN'T access extension APIs           │
│ - CAN send CustomEvents                 │
└─────────────────────────────────────────┘
          CustomEvent ↕ CustomEvent
        (EVENT_BATCH messages)
┌─────────────────────────────────────────┐
│ ISOLATED WORLD (Content Script)         │
│ - Can access chrome.runtime             │
│ - Acts as middleman                     │
│ - Relays events to background           │
└─────────────────────────────────────────┘
          chrome.runtime ↕
┌─────────────────────────────────────────┐
│ BACKGROUND (Service Worker)             │
│ - Stores execution data                 │
│ - Sends to Execution Explorer panel     │
└─────────────────────────────────────────┘
```

---

## How It Works (For Execution Explorer)

### The Flow: Execution Step → Execution Explorer

```
1️⃣ ANGULAR APP RECORDS STEP
   page-script.ts detects: "GET /api/revenue"
   Creates ExecutionStep object with timing, type, title

2️⃣ PAGE SCRIPT SENDS TO CONTENT SCRIPT
   Batches ~10 steps together (EVENT_BATCH)
   Sends via CustomEvent:
   dispatchEvent(CustomEvent("__ng_perf_to_content", {
     detail: { eventId, type: "EVENT_BATCH", payload: steps }
   }))

3️⃣ CONTENT SCRIPT RECEIVES
   listenFromPage() catches CustomEvent
   Validates data (normalizePageMessage)
   
4️⃣ CONTENT SCRIPT RELAYS TO BACKGROUND
   sendToBackground() via chrome.runtime.sendMessage():
   {
     type: "EVENT_BATCH",
     payload: [
       { id: "1", type: "data-fetch", title: "GET /revenue", ... },
       { id: "2", type: "state-update", title: "updateRevenue", ... },
       ...
     ]
   }

5️⃣ BACKGROUND RECEIVES & STORES
   chrome.runtime.onMessage listener in background.ts
   Stores execution steps in memory/storage
   
6️⃣ BACKGROUND BROADCASTS TO EXECUTION EXPLORER
   Uses chrome.runtime.Port (persistent connection)
   Sends EVENT_BATCH to panel via:
   port.postMessage(message)

7️⃣ EXECUTION EXPLORER RECEIVES
   Adds steps to executionIntelligence service
   Computed signals recalculate
   CausalityChainDetectorService analyzes steps
   UI updates with chapters and timeline
```

### In Code

```typescript
// STEP 1: Page script records (in page-script.ts)
const step: ExecutionStep = {
  id: "1",
  type: "data-fetch",
  title: "GET /api/revenue",
  startTime: 0,
  endTime: 310,
  // ... more metadata
};

// STEP 2: Page script sends batch via CustomEvent
const batch = [step1, step2, step3, ...];
const message: PageMessage = {
  eventId: generateEventId(),
  type: "EVENT_BATCH",
  payload: batch
};
dispatchEvent(new CustomEvent("__ng_perf_to_content", { detail: message }));

// STEP 3: Content script catches via listenFromPage()
listenFromPage((message) => {
  if (message.type === "EVENT_BATCH") {
    // STEP 4: Relay to background
    sendToBackground({
      type: "EVENT_BATCH",
      payload: message.payload,
      timestamp: Date.now()
    });
  }
});

// STEP 5-6: Background receives and broadcasts
// (in background.ts)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "EVENT_BATCH") {
    const panel = panelPorts.get(tabId);
    if (panel) {
      panel.postMessage(message);  // Send to Execution Explorer
    }
  }
});

// STEP 7: Execution Explorer receives (in execution-explorer.component.ts)
listenForPanelMessages((message) => {
  if (message.type === "EVENT_BATCH") {
    this.executionIntelligence.addExecutionSteps(message.payload);
    // Computed signals update → UI updates
  }
});
```

---

## The 2 Key Functions for Execution Explorer

### `listenFromPage(handler)`

**What it does:** Content script listens for EVENT_BATCH messages from page script.

**For Execution Explorer:** Catches execution step batches from the Angular app.

```typescript
// In content.ts
listenFromPage((message) => {
  if (message.type === "EVENT_BATCH") {
    console.log(`Got ${message.payload.length} execution steps`);
    
    // Relay to background
    sendToBackground({
      type: "EVENT_BATCH",
      payload: message.payload,
      timestamp: Date.now()
    });
  }
});
```

**Why important?** Without this, execution steps never leave the page script.

---

### `sendToBackground<T>(message)`

**What it does:** Content script relays messages to background worker.

**For Execution Explorer:** Sends event batches to background, which then broadcasts to the panel.

```typescript
// In content.ts
sendToBackground({
  type: "EVENT_BATCH",
  payload: executionSteps,  // 100+ steps
  timestamp: Date.now()
});
```

**Why important?** Without this, background never knows about execution steps.

---

## Message Flow (Execution Explorer Only)

```
┌─────────────────────────────────────────────────────────┐
Angular App Records Step
GET /api/revenue (0ms → 310ms)
updateRevenue (320ms → 330ms)
RevenueSignal emitted (340ms → 350ms)
RevenueChart rendered (360ms → 380ms)
        ↓ batch 4 steps
┌─────────────────────────────────────────────────────────┐
Page Script Creates CustomEvent
{
  eventId: "__ng_perf_1234567_abc",
  type: "EVENT_BATCH",
  payload: [step1, step2, step3, step4]
}
        ↓ dispatchEvent(CustomEvent)
┌─────────────────────────────────────────────────────────┐
Content Script listenFromPage()
Receives CustomEvent
Validates message
        ↓ sendToBackground()
┌─────────────────────────────────────────────────────────┐
Background chrome.runtime.onMessage
Receives EVENT_BATCH
Finds panel port for this tab
        ↓ port.postMessage()
┌─────────────────────────────────────────────────────────┐
Execution Explorer Panel
Receives via port.onMessage
Updates executionIntelligence service
CausalityChainDetectorService analyzes
UI shows: "Load Revenue (380ms)"
        ↓
Causality chains rendered in tree
Timeline shown in inspector
```

---

## Message Flow Diagram

### Scenario: User clicks "Profile This Page"

```
┌─────────────────────────────────────────────────────────────┐

1️⃣ USER CLICKS BUTTON
   Devtools Panel (inside popup)
           ↓ chrome.runtime.sendMessage
   Background Service Worker

2️⃣ BACKGROUND PROCESSES
   Background checks tab permissions
           ↓ chrome.tabs.executeScript
   Injects page-script.ts into main world

3️⃣ PAGE SCRIPT STARTS
   page-script.ts starts monitoring Angular
           ↓ creates AngularInstaller
   Adds instrumentation hooks

4️⃣ ANGULAR EVENT OCCURS
   Component renders, signal emits
           ↓ notifyStepRecorded(step)
   page-script.ts collects step data

5️⃣ SEND TO CONTENT SCRIPT
   page-script.ts (main world)
           ↓ CustomEvent dispatch
   message-bridge.ts (isolated world)

6️⃣ RELAY TO BACKGROUND
   message-bridge.ts
           ↓ chrome.runtime.sendMessage
   Background Service Worker

7️⃣ BACKGROUND BROADCASTS
   Background stores execution
           ↓ notifyTabUpdate(tabId)
   Sends to all interested devtools panels

8️⃣ DEVTOOLS UPDATES
   Execution Explorer Component
           ↓ computed signals update
   UI re-renders with new execution data

└─────────────────────────────────────────────────────────────┘
```

---

## Error Handling

### Extension Reloads

When you reload the extension in `chrome://extensions`, the extension context is invalidated.

```typescript
export function sendToBackground<T>(message: ExtensionMessage<T>): Promise<unknown> {
  try {
    if (!chrome.runtime?.id) {
      // Extension reloaded — silently resolve
      return Promise.resolve();
    }
    return chrome.runtime.sendMessage(message);
  } catch {
    // Catch if sendMessage throws
    return Promise.resolve();
  }
}
```

**For Execution Explorer:** If you reload the extension while recording, it gracefully stops. The page keeps running. When you open devtools again, recording resumes.

### Listener Cleanup

```typescript
// Don't leak listeners
let cleanup: (() => void) | null = null;

export function setupRecording() {
  cleanup?.();  // Remove old listener
  cleanup = listenFromPage((message) => {
    if (message.type === "EVENT_BATCH") {
      // Process execution steps
      handleExecutionBatch(message.payload);
    }
  });
}
```

## Why This Architecture?

### Security
- Page script can't access extension APIs (safe from XSS)
- Extension can't directly modify page (safe from malicious pages)
- All communication is serialized JSON (no code execution)

### Performance
- CustomEvents are synchronous and fast
- Batching (10 steps per EVENT_BATCH) reduces message overhead
- chrome.runtime messages are async but batched by browser

### Reliability
- Works across extension reloads
- Works across page navigation
- Graceful degradation if extension breaks

---

## UX Implications for Execution Explorer

### Fast & Responsive
- User opens Execution Explorer
- Steps appear in real-time as app runs
- No polling or refresh needed
- Causality chains update instantly

### Continuous Recording
- Extension reloads? Recording pauses, resumes when extension loads
- Page navigates? Clears old data, starts fresh session
- TAB_NAVIGATED event notifies panel of page change

### Lightweight
- Only sends EVENT_BATCH (not every single step)
- Compression: 100 steps → ~5KB message
- Background processes batches efficiently

---

## How Execution Explorer Uses the Bridge

```typescript
// src/devtools/panel/app/features/execution-explorer/execution-explorer.component.ts

export class ExecutionExplorerComponent {
  private executionIntelligence = inject(ExecutionIntelligenceService);
  private chainDetector = inject(CausalityChainDetectorService);
  
  constructor() {
    // Listen for EVENT_BATCH messages from background
    this.setupPanelListener();
  }
  
  private setupPanelListener() {
    // This uses chrome.runtime.Port internally
    // (panel port established by background.ts)
    
    panelPort.onMessage.addListener((message) => {
      if (message.type === "EVENT_BATCH") {
        // Add steps to the service
        this.executionIntelligence.addExecutionSteps(message.payload);
        
        // Computed signals update automatically
        // → narrativeMap recomputes
        // → UI re-renders with new chapters
      }
      
      if (message.type === "TAB_NAVIGATED") {
        // Page reload — clear old execution data
        this.executionIntelligence.clearSessions();
      }
    });
  }
}
```

The message bridge ensures EVENT_BATCH reaches the panel, which feeds the entire causality detection pipeline.

