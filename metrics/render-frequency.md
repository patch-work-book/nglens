# Render Frequency Metric (Trigger-Based)

The **Render Frequency** in ngLens describes the density of rendering sweeps relative to the concrete, asynchronous **trigger events** occurring inside the application (e.g. `1.2x / trigger`). 

Rather than relying on arbitrary clock time (renders per second/minute)—which fluctuates regardless of whether the user is actively interacting with the website or navigating the pages—ngLens isolates and groups measurements around **four core asynchronous triggers**.

---

## The Formula

$$\text{Trigger-Based Render Frequency} = \frac{\text{Component Render Count}}{\text{Total Trigger Events during Component Lifetime}}$$

Where **Total Trigger Events** is the sum of:
$$\text{Total Trigger Events} = \text{Route Changes} + \text{User Interactions} + \text{Microtasks} + \text{Server Data Pushes}$$

---

## The Four Trigger Categories

ngLens dynamically intercepts and tracks these four groups of asynchronous events on the browser page to compile a component's lifecycle density:

### 1. Route Changes
* **Monitored via:** Angular router link transitions and address history changes.
* **Why it matters:** Component layout shifts during a routing transition should render exactly once. Multiple rendering runs point to state initialization mismatches or repeated route guards.

### 2. User Interactions
* **Monitored via:** Captured DOM event listeners (e.g., `click`, `input`, and `keydown`).
* **Why it matters:** An ideal UI action should trigger at most a single rendering cycle. A high density (e.g., $10\text{x}$ renders per individual click) indicates that parent cascades are triggering wasteful layouts.

### 3. Microtask Queues
* **Monitored via:** Zone.js microtask schedules, Promise resolutions (`Promise.then`), and async ticks.
* **Why it matters:** Intercepts high-frequency state updates occurring on same-frame schedules before paint loops complete.

### 4. Server Data Pushes (I/O)
* **Monitored via:** Outgoing and incoming `fetch`/`XMLHttpRequest` requests and active custom `WebSocket` streams.
* **Why it matters:** Checks if polling endpoints or dynamic data pushes are forcing entire view segments to redraw unnecessarily on passive screens.

---

## Metric Display Classification

To ensure immediate readability during profiling runs, ngLens translates calculated densities into trigger ratios:

| Computed Frequency | Displayed Format | Real-World Performance Assessment | Severity Level |
| :--- | :--- | :--- | :--- |
| **$\ge 5.0$** | **`X.X  / trigger`** | Extreme frame rate churn. A single asynchronous event triggers **5 or more** complete rendering sweeps. Points to deep layout loops or zone pollution. | 🛑 **Critical** |
| **$2.0 - 4.9$** | **`X.X  / trigger`** | Sub-optimal cascade. A single microtask or user action causes **2 to 5** complete rendering sweeps. Indicates layout cascades or dual state updates. | 🟡 **Watch** |
| **$1.0 - 1.9$** | **`X.X  / trigger`** | Typical interactive range. One render pass is triggered per lifecycle action. | ⚪ **Normal** |
| **$< 1.0$** | **`X.X  / trigger`** | High-efficiency rendering. Most application trigger tasks are bypassed safely. | 🟢 **Optimal** |
| **$0.0$** | **`Idle`** | Completely stationary; zero re-renders observed. | 🟢 **Healthy** |

---

## Why Trigger-Based Frequency is Superior

1. **Active Context-Sensitivity:** Legacy "renders per minute" indicators artificially dilute component problems over long tracking runs. If a noisy component renders 1,000 times in 10 seconds and then sits idle for 10 minutes, time-based rates drop to a misleadingly low number. Trigger-based analysis remains highly accurate.
2. **True Cause Correlation:** Directly relates rendering spikes to their specific asynchronous origins, letting developers trace exactly which interaction triggers are producing layout overhead.

---

## Actionable Remedies for High Trigger Density

### A. Convert Dynamic Bindings to pure Pipes
Standard class method calls in templates (e.g., `{{ computeTotal() }}`) calculate on every single change detection trigger. Moving them into pure Angular pipes ensures output evaluation only fires when input properties actually undergo changes.

### B. Consolidate State Updates
If an asynchronous response updates three separate internal signals sequentially, it can trigger three consecutive microtask renders. Group state changes into single transactions using computed values or unified objects.

### C. Run Background Push Streams Outside Angular Zone
When working with high-frequency WebSocket notifications, decouple stream checks using `NgZone.runOutsideAngular(...)`:
```typescript
class TicketFeedComponent implements OnInit {
  constructor(private ngZone: NgZone) {}

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      this.socket$.subscribe(data => {
        // Evaluate outside Angular zone...
        if (data.requiresVisualUpdate) {
          // Re-enter zone only when UI needs paint
          this.ngZone.run(() => {
            this.uiState.set(data.payload);
          });
        }
      });
    });
  }
}
```
