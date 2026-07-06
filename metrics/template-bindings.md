# Template Binding Density

The **Template Binding Density** represents the total volume of active template expressions, data interpolations, and directive property bindings configured inside an Angular component's HTML template footprint.

---

## The Formula

$$\text{Template Binding Density} = \text{LView.length} - \text{TView.bindingStartIndex}$$

In Angular Ivy:
* **`LView` (Logical View):** A runtime array representing a single instance of a component's template, containing state, children, DOM nodes, and binding values.
* **`TView` (Template View):** A static metadata description shared across all instances of a component defining where structural bindings begin (`bindingStartIndex`).
* **`totalBindingsCount`:** Subtracting the binding start index from the total `LView` capacity isolates the exact count of dynamic bindings Angular must track, verify, and diff during change detection.

---

## Why Template Binding Density Matters

Every single template binding (e.g., `[prop]="value"`, `{{ value }}`, `[class.active]="condition"`) is checked sequentially during an Angular change detection loop.
* **Default Change Detection:** The CPU processes and compares all bindings on *every single* cycle, even if no surrounding inputs changed.
* **OnPush Change Detection:** While OnPush blocks parent cascades, it still checks all properties whenever local events, bound observables, or signals emit, which can cause frame drops if the local templates are bloated.

---

## Density Reference Guide

| Bindings Count | Rating | Performance Diagnosis | Severity Level |
| :--- | :--- | :--- | :--- |
| **$> 50$** | **Bloated Template** | Heavy render overhead. Forces massive property-by-property comparisons that saturate the browser thread. | 🛑 **Critical** |
| **$25 - 50$** | **Moderate Template** | Normal interactive component, but represents a target for `OnPush` conversion or child decoupling. | ⚠️ **Warning** |
| **$< 25$** | **Lean Template** | Highly optimized. Minor rendering check footprint. | 🟢 **Healthy** |

---

## Underlying Causes of Bloated Binding Density

### 1. Monolithic Component Design
Packing entire pages or dashboards into a single master template with hundreds of layout divs, lists, and textual interpolations instead of decoupling sections into specialized child templates.

### 2. Large Forms or Tables without Virtualization
Directly declaring fifty inputs, selections, or spreadsheet cells in a heavy dynamic DOM footprint.

---

## Architectural Remedies & Fixes

### A. Break the component down into smaller child components
Splitting a monolithic layout splits the monolithic `LView` arrays. This means that if a tiny child component changes state, Angular only checks that specific child component’s properties instead of evaluating the entire page.

### B. Convert to `ChangeDetectionStrategy.OnPush`
If a component contains deep or rich bindings ($> 25$ bindings), force-convert it to `OnPush` change detection to guarantee it is skipped during unrelated application sweeps.

### C. Leverage Memoization with Pure Pipes
For heavy bindings evaluating complex sub-graphs, route values through custom pure pipes. Pure pipes cache their outputs, preventing execution loops if input references haven't changed.
