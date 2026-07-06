# Change Detection Mutation Efficiency Ratio (CD-MER)

The **Change Detection Mutation Efficiency Ratio (CD-MER)** is a specialized performance metric engineered to assess the change detection efficiency of custom Angular components during active profiling sessions. It identifies "wasteful rendering checks"—change detection runs that consume main-thread CPU cycles but update nothing in the user-visible viewport.

---

## The Formula

$$\text{CD-MER} = \frac{\text{DOM Mutations within Component Region}}{\text{Invocations of Component change detection (\texttt{ngDoCheck})}} \times 100$$

Where:
* **DOM Mutations:** Are captured dynamically by the ngLens `MutationObserver` targeting child nodes, attributes, and text changes within the component host element's subtree.
* **Component CD Invocations:** The number of times Angular triggers the life-cycle hook of `ngDoCheck` on instances of this component class.

---

## Why CD-MER Matters

By default, Angular operates on a **Default Change Detection Strategy** (`ChangeDetectionStrategy.Default`). Under this model, any asynchronous micro or macro-task (e.g., `setTimeout`, click captures, HTTP requests, or RxJS emissions) scheduled inside the core `Zone.js` container prompts Angular to run a full sweep (`ApplicationRef.tick()`) across the active component tree.

Even if none of the input data or internal properties have changed, the default strategy forces Angular to compile, parse, loop over, and compare every active component's template tree.

A low **CD-MER** percentage mathematically demonstrates that the target component is acting as a major performance bottleneck, running excessive "ghost cycles."

---

## Efficiency Classification Reference

| CD-MER Range | Efficiency Level | Performance Assessment & Structural Impact |
| :--- | :--- | :--- |
| **$\ge 60\%$** | **High Efficiency** | Highly optimized component. Most change detection passes translate immediately to functional UI tree updates. |
| **$25\% - 59\%$** | **Moderate Efficiency** | Acceptable for highly interactive state wrappers but indicates potential areas for improvement. |
| **$< 25\%$** | **Wasteful Sweeps** | Severe bottleneck. Represents dynamic parent template cascades or timer pollution frequently checking a passive component. Highly recommended to re-architect. |

---

## Underlying Root Causes for Bad CD-MER

### 1. Default Change Detection Propagation
When utilizing the `Default` change detection strategy, parent re-renders propagate unconditionally downward to children. If a parent updates its state high-frequency (e.g., ticking countdown), children continuously trigger `ngDoCheck` even with stationary values.

### 2. Method Invocations inside Templates
Placing standard methods or non-pure getters inside structural template loops or interpolation blocks forces re-evaluation on *every single* change detection pass.
```html
<!-- ANTI-PATTERN: Called dozens of times on every frame task check! -->
<h3>{{ getUserTitle() }}</h3>
```

### 3. Asynchronous Task Pollution within Zone.js
Dynamic libraries or custom intervals doing polling or canvas draws inside the core Angular Zone repeatedly trigger a microtask check, firing global ticks.

---

## Actionable Remedies & Fixes

### A. Convert to `ChangeDetectionStrategy.OnPush`
Switching a default component to the `OnPush` strategy guarantees that Angular only checks the component's template when:
1. One of its `@Input()` bindings changes by object/primitive reference.
2. An event handler owned by the component emits.
3. An active Observable bound with the `async` pipe fires.
4. It reads from an updated Angular Signal.

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-heavy-viewer',
  templateUrl: './heavy-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeavyViewerComponent {}
```

### B. Migrate template bindings to Angular Signals
Migrating component state from manual properties to reactive Angular Signals (`signal()`, `computed()`) allows Angular to track precise fine-grained view dependencies. This avoids running the entire change detection tree.

### C. Leverage `NgZone.runOutsideAngular()`
For background activities (timers, DOM animations, Canvas events, etc.) that do not require updating the UI on every tick, run them outside the Angular zone. Enter the zone only when state changes require a DOM paint.

```typescript
import { Component, OnInit, NgZone } from '@angular/core';

@Component({ ... })
export class PollingComponent implements OnInit {
  constructor(private ngZone: NgZone) {}

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      setInterval(() => {
        // Perform background work...
        
        if (stateHasChanged) {
          this.ngZone.run(() => {
            // Mutate state here to trigger change detection only when needed
          });
        }
      }, 100);
    });
  }
}
```
