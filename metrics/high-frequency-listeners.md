# High-Frequency Output Event Listeners

**High-Frequency Output Event Listeners** represent DOM events such as `scroll`, `mousemove`, `pointermove`, or `wheel` that are attached directly within an Angular component's template or structural DOM element Footprint.

Because these event streams fire at rapid cycles (e.g. up to 60 to 120 times per second), they can trigger infinite, wasteful change detection sweeps.

---

## The Core Concept

By default, any standard Angular event handler (e.g., `(scroll)="onScroll($event)"` or `(mousemove)="..."` in HTML templates) is wrapped by **`Zone.js`**. 

Whenever these callback handlers execute, Zone.js intercepts the completion of the stack and informs Angular that a state change might have occurred. This forces Angular to run a full rendering crawl (`ApplicationRef.tick()`) across the entire web application—potentially on **every single pixel moved or scrolled**, leading to severe layout lagging and UI freezing.

---

## Monitored High-Frequency Triggers

The ngLens Point-In-Time Best Practices scan intercepts event registrations and flags:
* **`mousemove`** / **`pointermove`**
* **`scroll`**
* **`wheel`** / **`mousewheel`**

---

## Recommended Anti-Patterns & Optimal Fixes

### 1. Wrap continuous listeners in `NgZone.runOutsideAngular`
By running handlers outside Angular's event zone, Zone.js bypasses task scheduling, preventing wasteful application refreshes. Call `NgZone.run()` only when a specific calculation requires changing a visual binding:

```typescript
import { Component, OnInit, NgZone, ElementRef, ViewChild } from '@angular/core';

@Component({ ... })
export class ScrollListenerComponent implements OnInit {
  @ViewChild('scrollContainer', { static: true }) container!: ElementRef;

  constructor(private ngZone: NgZone) {}

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      this.container.nativeElement.addEventListener('scroll', (event) => {
        // High-frequency task runs outside Angular's zone — 0% CD overhead!
        const scrollPosition = this.container.nativeElement.scrollTop;

        if (scrollPosition > 300) {
          // Re-enter Angular zone only when visual updates are actually needed
          this.ngZone.run(() => {
            this.showBackToTopButton = true;
          });
        }
      });
    });
  }
}
```

### 2. Implement RxJS Debounce and Throttle Operators
If you consume event streams via Observables, apply `throttleTime` or `debounceTime` operators to limit how often downstream calculations occur.

### 3. Use Passive Event Listeners for Scroll Animations
Ensure that native scroll handlers are registered as `passive` when possible to prevent blocking standard browser scroll thread pipelines:
```typescript
element.addEventListener('scroll', handler, { passive: true });
```
