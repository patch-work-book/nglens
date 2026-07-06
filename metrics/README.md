# ngLens Performance Metrics Guide

This directory contains deep-dive architectural guidelines and metric definitions used by **ngLens** to assess, score, and optimize large-scale Angular applications in development mode.

---

## Metric Breakdown & Index

An overview of each index metric tracked dynamically by ngLens:

### 1. [CD-MER (Change Detection Mutation Efficiency Ratio)](cd-mer.md)
* **What it measures:** The percentage of checked change detection cycles (`ngDoCheck`) which result in a real, visible DOM mutation within a component's rendering boundary.
* **Why it matters:** Pinpoints highly redundant checks that waste CPU time without updating the screen.
* **Target optimal range:** $\ge 60\%$. Ratios $< 25\%$ indicate critical recheck bottlenecks.

### 2. [Render Frequency & Interval](render-frequency.md)
* **What it measures:** The localized velocity (rate) of rendering passes per component over the recording session duration.
* **Why it matters:** Translates raw rendering frequencies into intuitive intervals (e.g., `2.5/sec`, `Every 1.2s`, `Idle`) to assess structural animation overhead or subscription pollution.
* **Target optimal range:** Low render frequencies (e.g., `Idle` during stationary periods or spaced intervals matching direct user interactions only).

### 3. [Average Render Durations & Cost](avg-render-cost.md)
* **What it measures:** The CPU execution time elapsed in milliseconds during a component's DOM paint and subtree rendering pass.
* **Why it matters:** Correlates structural layout complexness (DOM node depth) with CPU thread locking. Helps pinpoint sluggish layouts and bloated template expressions.
* **Target optimal range:** $< 16\text{ms}$ (per frame budget limit) per component group.

### 4. [Active Cleanup Risks](cleanup-risks.md)
* **What it measures:** Cumulative count of potential memory and subscription leaks detected upon component destruction.
* **Why it matters:** Warns of active RxJS subscriptions, dangling `setInterval`/`setTimeout` macros, or uncleaned window event listeners after a component has unmounted, leading to memory accumulation or multiple background executions.
* **Target optimal range:** $0$ cleanup risks.

### 5. [Render Hotspots & Cascading Depth](render-hotspots.md)
* **What it measures:** An aggregated severity score (0-100) combining render frequency, tree nesting depth, template declarations, and dominant triggering causes.
* **Why it matters:** Exposes layout bottlenecks where parent component state updates trigger massive, unintended "cascading rivers of renders" downstream.
* **Target optimal range:** Hotspot score $< 40$.

### 6. [Template Binding Density](template-bindings.md)
* **What it measures:** The count of active template expressions, data interpolations, and directive structural bindings inside a component.
* **Why it matters:** Evaluates change detection workload — a higher property load increases evaluation times, leading to frame drops.
* **Target optimal range:** $< 25$ bindings.

### 7. [High-Frequency Output Event Listeners](high-frequency-listeners.md)
* **What it measures:** The count and classification of continuous/rapid DOM event handlers (scroll, mousemove, wheel) attached directly within a component's footprint.
* **Why it matters:** Pinpoints listeners executing inside Zone.js that trigger continuous application change detection ticks, dropping FPS.
* **Target optimal range:** $0$ un-throttled high-frequency zone handlers.

---

## Educational Reference & Integration
These guidelines are directly embedded inside the live **ngLens** DevTools interface under the **Action Center** and **Render Inspector** tabs to provide in-context explanations and target fixes while profiling your development build.
