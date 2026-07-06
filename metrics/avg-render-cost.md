# Average Render Cost & Durations

The **Average Render Cost** measures the CPU execution time in milliseconds required for Angular to parse, compile, and execute a component's lifecycle and verify its active bindings inside the DOM tree.

---

## The Core Concept: The 16.6ms standard

To achieve a fluid **60 frames per second (fps)** on standard displays, the browser has a absolute budget of **16.6ms** per frame. Within this budget, the browser must:
1. Handle user interactions.
2. Execute JavaScript (including Angular change detection).
3. Compute styles and recalculate layouts.
4. Paint pixels on the viewport.

If a single component's average rendering pass exceeds **10ms - 15ms**, it eats up almost the entire frame budget, leaving no time for layout or paint, and results in instantly noticeable UI freezing (jank).

---

## Causes of Large Average Render Costs

### 1. Complex Component Subtree Nodes
If a component nests a very large subtree (e.g., thousands of child elements, unvirtualized lists, or massive nested tables), the CPU cost of walking and recalculating this tree climbs exponentially.

### 2. Slow Expression Evaluation
Evaluating slow getters or executing synchronous array calculations inside interpolation templates locks up the thread on every render run.
```html
<!-- BAD: Executes an O(N) array search on every rendering cycle! -->
<p>User Status: {{ searchLargeUserList(userId) }}</p>
```

### 3. DOM Layout Thrashing
Programs that read lay-out patterns (such as `element.offsetHeight` or `element.getBoundingClientRect()`) and immediately write to the DOM inside templates trigger forced synchronous layouts, drastically escalating render duration.

---

## Industrial-Strength Remedies

1. **Virtual Scrolling (`cdkScrollable`):**
   Instead of DOM-rendering 1,000 table rows, use the Angular CDK virtual scroll to render only the 10 rows visible in the viewport, cutting render duration by over $95\%$.
   
2. **Move Calculations to class lifecycle or reactive flows:**
   Evaluate heavy queries inside `ngOnInit` or RxJS pipelines rather than inside the HTML template:
   ```typescript
   // GOOD: Computed once upon value change rather than on every render cycle
   this.status$ = this.userList$.pipe(
     map(list => this.searchLargeUserList(list, this.userId))
   );
   ```

3. **Break Components down into smaller modules:**
   Isolate large static trees from heavy dynamic chunks so that updates are contained only within specific component regions.
