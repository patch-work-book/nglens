# Active Cleanup & Teardown Risks

The **Cleanup Risks** metric in ngLens counts prospective memory and reference leaks caused by resources that are initialized inside a component, but are not properly disposed of when that component is destroyed (unmounted) from the active routing DOM.

---

## The Danger of Missing Cleanup

When a component is destroyed, its DOM nodes are discarded. However, if the underlying component instance created a persistent reference, that component is kept alive in heap memory (a **detached DOM/Object leak**):
1. **Garbage Collection Block:** The JS engine cannot sweep destroyed elements because active subscriptions or timers still hold reference handles.
2. **Background CPU Bloat:** Leftover RxJS subscriptions and intervals keep running indefinitely in the background, consuming CPU bandwidth.
3. **Multiple executions:** Each time the user navigates back to that page and destroys it again, a new active, uncleaned instance is spawned, leading to exponential execution rates.

---

## Monitored Cleanup Vectors in ngLens

### 1. RxJS Subscription Leaks
The most frequent cause of memory leaks in modern Angular. Standard class subscriptions to shared singletons or root services keep running indefinitely.

### 2. setInterval / setTimeout Macros
Starting intervals (`setInterval`) that aren't cleared via `clearInterval` during teardown.

### 3. Native Window Event Listeners
Attaching window listeners (e.g. `window.addEventListener('resize')`) that are never detached, pinning the component in heap memory.

---

## Modern and Safe Remedies

### A. The Observable `AsyncPipe` (Highly Recommended)
Using Angular's built-in `async` template pipe completely automates the subscribe and unsubscribe cycle. Angular disposes of the subscription the instant the component is destroyed.
```html
<ul>
  <li *ngFor="let item of items$ | async">{{ item }}</li>
</ul>
```

### B. Use `takeUntilDestroyed()` (Angular 16+)
A modern, native operator that hooks into the component's `DestroyRef` context and automatically completes the subscription when the host gets unmounted.
```typescript
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DataService } from './data.service';

@Component({ ... })
export class MyComponent {
  constructor(dataService: DataService) {
    dataService.getData()
      .pipe(takeUntilDestroyed()) // Completely safe teardown!
      .subscribe(data => { ... });
  }
}
```

### C. Manual Component Lifecycle Teardown
If manual subscriptions or intervals must be held, store their handles and dispose of them cleanly inside the `ngOnDestroy` lifecycle:
```typescript
import { Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

@Component({ ... })
export class PollerComponent implements OnDestroy {
  private timer: any;
  private sub = new Subscription();

  ngOnDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.sub.unsubscribe();
  }
}
```
