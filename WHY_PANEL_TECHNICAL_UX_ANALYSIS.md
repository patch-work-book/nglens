# Why Panel - Technical & UX Analysis

## Overview
The **"Why Panel"** is a collapsible bottom drawer that answers: **"Why did THIS component re-render?"**

It's the bridge between the Rendering Inspector and developer understanding.

---

## UX Architecture

### Entry Point
```
Developer clicks on a component in Rendering Inspector
    ↓
selectedComponent() is set in PanelState
    ↓
Why Panel appears at bottom of screen
    ↓
Developer sees causality breakdown + suggested fix
```

### Visibility Logic
**App Component:**
```typescript
// Why Panel only shows when:
// 1. A component is selected
// 2. User is NOT in Rendering Inspector (to avoid clutter)

@if (selectedComponent() && !isRenderInspectorRoute()) {
  <app-why-panel />
}
```

**Why?** Rendering Inspector already shows cascades. Why Panel is for "drill down" from other panels.

---

## Technical Structure

### 1. Data Flow (Reactive)

**PanelState:**
- `selectedComponent()` - which component user clicked
- `renderEvents()` - all render events in session
- `componentStats()` - aggregated stats per component

**Why Panel Computation:**
```
selectedComponent() 
    ↓
selectedStats = computed(() => 
  componentStats.find(stats => stats.componentName === selected)
)
    ↓
causesBreakdown = computed(() =>
  analyze(stats.causesBreakdown)
    .sort(byFrequency)
    .addPercents()
    .markDominant()
)
    ↓
HTML displays causesBreakdown with bars
```

**Change Detection:** OnPush + computed() = Ultra-efficient
- Only recomputes when selectedComponent or componentStats changes
- Never wasteful

---

### 2. Key Computed Properties

#### `causesBreakdown: CauseEntry[]`
**What it does:** Analyzes why a component renders

**Input:** `stats.causesBreakdown` object
```typescript
{
  parent: 5,        // Rendered 5 times because parent re-rendered
  input: 2,         // Rendered 2 times because @Input changed
  zone: 1,          // Rendered 1 time from async event
  signal: 3,        // Rendered 3 times from signal update
  manual-cd: 0      // Never from manual ChangeDetectorRef
}
```

**Output:** Sorted array with percentages
```typescript
[
  { type: 'parent', label: 'Parent cascade', count: 5, percent: 45, isDominant: true },
  { type: 'signal', label: 'Signal update', count: 3, percent: 27, isDominant: false },
  { type: 'input', label: 'Input changed', count: 2, percent: 18, isDominant: false },
  { type: 'zone', label: 'Async/DOM event', count: 1, percent: 10, isDominant: false },
]
```

**Technical insight:** 
- `isDominant` marks the #1 cause (most renders)
- Percentages are used for bar chart widths
- Sorted descending by count (most frequent first)

---

#### `dominantCause: RenderCause['type'] | null`
**What it does:** Identifies the PRIMARY reason this component renders

**Example outputs:**
- `'parent'` - "Component cascades from parent"
- `'input'` - "Component re-renders when @Input changes"
- `'signal'` - "Component listens to signal"
- `'zone'` - "Async events trigger renders"
- `'manual-cd'` - "Someone calls ChangeDetectorRef.markForCheck()"
- `null` - "Not enough data yet"

---

#### `triggerSource: string`
**What it does:** Shows WHAT caused the dominant cause

**Examples:**
- For `dominantCause = 'parent'`: triggerSource = "DashboardComponent"
- For `dominantCause = 'signal'`: triggerSource = "revenueSignal"
- For `dominantCause = 'input'`: triggerSource = "@Input() items"

**Technical detail:** Aggregates all sources, picks the most frequent one
```typescript
const counts = new Map<string, number>();
for (const event of selectedEvents()) {
  for (const cause of event.causes) {
    if (cause.type !== type || !cause.source) continue;
    counts.set(cause.source, (counts.get(cause.source) ?? 0) + 1);
  }
}
// Return the source with highest count
```

---

#### `cascadeIndicator: string`
**What it does:** Shows how many times this component was forced to re-render by parent

**Output format:** `"5 renders, 45%"` (meaning parent caused 5 of 11 total renders)

**UX usage:** Green if low, amber if high
- `< 5 parent renders` = Green ✅ (parent is stable)
- `>= 5 parent renders` = Amber ⚠️ (parent unstable, consider OnPush)

---

#### `renderExplanation: string`
**What it does:** Plain English summary of the component's render behavior

**Example output:**
```
"12 renders (0.2/sec), mostly from Parent cascade. 
CD-MER CD efficiency is 78.3% (23/25 cycles mutated)."
```

**Breaks down:**
1. Total renders + frequency
2. Dominant cause
3. CD-MER (Change Detection Mutation Efficiency Ratio)
   - CD-MER = % of change detection runs that actually mutated DOM
   - Low = CPU waste (checking when nothing changed)
   - High = Efficient (only checking when needed)

---

#### `suggestedFix: string`
**What it does:** Gives concrete optimization advice

**Conditional logic:**
```typescript
if (renderFrequency > 100) {
  // Component is rendering CONSTANTLY
  "Check parent state churn, list trackBy coverage..."
} 

if (dominantCause === 'zone') {
  // Async events triggering renders
  "Move high-frequency event handlers outside Angular..."
}

if (dominantCause === 'parent') {
  // Parent cascading renders
  "Stabilize parent inputs, use OnPush..."
}

if (dominantCause === 'input') {
  // @Input changing frequently
  "Memoize derived arrays/objects..."
}

if (dominantCause === 'signal') {
  // Signal emitting unchanged values
  "Review signal writes so unchanged values aren't emitted..."
}
```

**UX insight:** Each fix is ACTIONABLE, not generic
- Not: "Consider using OnPush"
- Yes: "Stabilize parent inputs, avoid recreating arrays in templates, and consider OnPush"

---

### 3. Component Statistics Model

**What Why Panel consumes:**
```typescript
interface ComponentStats {
  componentName: string;
  renderCount: number;                    // Total renders ever
  renderFrequency: number;                // Renders per minute
  averageDuration: number;                // Avg time per render (ms)
  triggerCount: number;                   // How many user interactions triggered renders
  totalTemplateBindings: number;          // Count of {{ }} expressions
  totalOutputListeners: number;           // Count of (event)= handlers
  hasHighFrequencyZonePollution: boolean; // Are there noisy event listeners?
  highFrequencyEvents: string[];          // Which events are noisy
  cdMer: number;                          // CD Mutation Efficiency Ratio (0-100%)
  
  causesBreakdown: {
    parent: number;        // "Rendered because parent rendered"
    input: number;         // "Rendered because @Input changed"
    zone: number;          // "Rendered from async event"
    signal: number;        // "Rendered from signal update"
    'manual-cd': number;   // "Rendered from ChangeDetectorRef"
  };
}
```

---

## UX Patterns

### 1. **Collapsible Panel**
```
┌─────────────────────────────────────────────────────────────┐
│ ▼ Why Did This Render? — RevenueChart                       │  ← Clickable header
├─────────────────────────────────────────────────────────────┤
│ [Full content shown when expanded]                          │
└─────────────────────────────────────────────────────────────┘
```

**Why collapsible?** 
- Not always needed
- Takes 256px height when open
- Developer might want full Rendering Inspector view
- Single click to dismiss

---

### 2. **Metrics Grid with Tooltips**
```
Total renders: 12        Recent renders: 3
Render Freq: 0.2/sec     Avg duration: 15.2ms

Render cause: Parent cascade
Trigger source: DashboardComponent
Parent cascade: 5 renders, 45%
CD Efficiency: 78.3%
```

**UX technique:** Every metric has a `title` tooltip
```html
<div title="Cumulative renders since tracking started">
  Total renders: <strong>12</strong>
</div>
```

Developer hovers → understands what each metric means

---

### 3. **Cause Evidence Visualization**

Three layers:

**Layer 1: Text Labels**
```
Parent cascade: 5 renders
Input changed: 2 renders
Signal update: 3 renders
```

**Layer 2: Horizontal Bar Chart**
```
Parent cascade  ████████████  45%
Input changed   ██████         18%
Signal update   █████████      27%
```

**Layer 3: Confidence Badge**
```
[HIGH confidence] or [MEDIUM confidence] or [HEURISTIC]
```

**Why 3 layers?**
- Text = exact numbers (precise)
- Bar chart = visual proportion (intuitive)
- Confidence = trust level (honest about data quality)

---

### 4. **Color Coding for Status**

**Cause bars by type:**
- Purple = Parent cascade (most common performance issue)
- Cyan = Input changed (expected, usually fine)
- Blue = Zone/async event (often indicates issue)
- Green = Signal update (Angular best practice)
- Amber = Manual CD (usually indicates problem)

**Cascade indicator:**
- Green = Good (< 5 parent renders)
- Amber = Warning (>= 5 parent renders)

**CD-MER efficiency:**
- Green = 60%+ (good)
- Amber = 25-60% (moderate waste)
- Red = < 25% (severe waste)

---

### 5. **Actionable Suggested Fix**

Not just diagnosis, but WHAT TO DO:

**Bad UX:**
```
"This component has high parent cascade renders"
```

**Good UX (What Why Panel Does):**
```
"Stabilize parent inputs, avoid recreating arrays or 
objects in templates, and consider OnPush for this 
component and its parent."
```

Developer can immediately:
1. Check if arrays are recreated in template
2. Check if parent is stable
3. Add OnPush change detection

---

## Technical Efficiency

### Computed Caching
```typescript
readonly causesBreakdown = computed<CauseEntry[]>(() => {
  // Only recalculates when selectedStats() changes
  // Never recalculates on other changes
});
```

**Why matter?** 
- Bar chart is recreated only when stats change
- Not on every render cycle
- Perfect for OnPush change detection

### Memoization Pattern
```typescript
private topSourceForCause(type: RenderCause['type']): string {
  const counts = new Map<string, number>();
  
  // Iterate all events for this cause type
  for (const event of this.selectedEvents()) {
    for (const cause of event.causes) {
      if (cause.type !== type || !cause.source) continue;
      counts.set(cause.source, (counts.get(cause.source) ?? 0) + 1);
    }
  }
  
  // Find the most frequent source
  let topSource = '';
  let topCount = 0;
  for (const [source, count] of counts) {
    if (count > topCount) {
      topSource = source;
      topCount = count;
    }
  }
  
  return topSource || 'No source captured';
}
```

**Efficiency:** O(n) iteration but called only when needed

---

## Summary

The **Why Panel** is a masterclass in:
- **Data visualization** - Multiple representations of same data
- **Progressive disclosure** - Overview first, details on demand
- **Actionability** - Shows not just what, but what to do
- **Performance** - Efficient reactivity with computed()
- **UX clarity** - Tooltips, colors, confidence badges

It's the bridge between raw data (renders) and developer action (optimization).
