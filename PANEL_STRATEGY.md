# ngLens Panel Strategy - Strengthen Each Panel

## Current Panels

1. **Execution Explorer** (NEW - causality-based)
2. **Rendering Inspector** (EXISTING - detailed render analysis)
3. **Performance Overview** (EXISTING - metrics & overview)
4. **Memory Analyzer** (EXISTING - memory profiling)
5. **Recommendations Engine** (EXISTING - performance tips)

---

## Problem: Lack of Cohesion

Currently, each panel exists independently. They don't work together to tell a story.

A developer opens ngLens and doesn't know:
- Which panel to look at first?
- How do these panels relate?
- What is each one for?

---

## Solution: Clear Panel Roles

### Panel 1: **Execution Explorer** (ENTRY POINT)
**Role**: "What just happened in my app?"

**Shows:**
- Sessions (left) - List of execution events
- Execution Journal (center) - Business chapters (causality chains grouped by intent)
- Inspector (right) - Details for selected chapter
  - What was slow
  - What happened (timeline)
  - What changed (data)
  - Who was affected (components)

**Does NOT show:**
- Detailed metrics
- Recommendations
- Memory info
- Every Angular internal detail

**Why start here:**
- Tells a story in business terms
- Shows causality (why did X happen)
- Immediate answer to "what was slow"

---

### Panel 2: **Rendering Inspector** (DEEP DIVE INTO RENDERS)
**Role**: "Why did my components re-render?"

**Should show:**
- Render cascade tree
- Which components rendered
- How many times each rendered
- Why each component rendered (detection reason)
- **NEW**: Link back to Execution Explorer chapters

**Does NOT show:**
- Causality (that's Execution Explorer's job)
- Business logic flow
- Data changes (that's Execution Explorer's job)

**Why use it:**
- You saw "4 component renders" in Execution Explorer
- You want details: which 4? how many times each?
- You want to know: OnPush or change detection issue?

---

### Panel 3: **Performance Overview** (METRICS & HEALTH)
**Role**: "Is my app healthy?"

**Should show:**
- Overall score
- Key metrics (APIs, renders, memory)
- Performance trends over time
- Comparisons (is this normal?)

**Does NOT show:**
- Causality chains (use Execution Explorer)
- Individual render details (use Rendering Inspector)
- Detailed data changes

**Why use it:**
- Quick health check
- Spot regressions
- See if performance improved

---

### Panel 4: **Recommendations Engine** (ACTION ITEMS)
**Role**: "What should I fix?"

**Should show:**
- Ranked list of optimizations
- Estimated impact of each
- How to implement (links to code/docs)

**Does NOT show:**
- Raw data
- Causality chains
- Render cascades

**Why use it:**
- "I want to know what to optimize first"
- "I want estimated improvement"

---

### Panel 5: **Memory Analyzer** (MEMORY PROFILING)
**Role**: "Am I leaking memory?"

**Should show:**
- Memory over time
- Object retention
- Potential leaks

**Does NOT show:**
- Render info
- Causality
- Metrics

**Why use it:**
- "App is getting slower over time"
- "Possible memory leak"

---

## User Journey

### Beginner Developer
1. App feels slow
2. Opens ngLens → **Execution Explorer**
   - Sees "Dashboard took 4.6s"
   - Sees "Revenue API was slow (2.1s)"
3. Clicks on Revenue API chapter
   - Sees timeline: 0ms → 2.1s → store → render
4. Done. Knows what to optimize.

### Intermediate Developer
1. App is slow
2. Opens ngLens → **Execution Explorer**
   - Sees "4 component renders"
3. Switches to **Rendering Inspector**
   - "RevenueChart rendered 3 times unnecessarily"
4. Switches to **Recommendations**
   - "Add OnPush change detection to RevenueChart"
5. Implements fix

### Advanced Developer
1. Performance regression
2. Opens **Execution Explorer** - confirms the regression
3. Opens **Rendering Inspector** - traces render cascade
4. Opens **Memory Analyzer** - checks if memory leak
5. Checks **Performance Overview** - sees the trend
6. Uses **Recommendations** to prioritize fixes

---

## Implementation Plan

### For Execution Explorer
**✅ Already Done:**
- Causality chain detection
- Business chapter grouping
- Timeline display
- Data changes
- Affected components

**❌ TODO:**
- Identify bottleneck (slowest step)
- Fix null check errors in template

**Priority:** CRITICAL - This is the entry point

---

### For Rendering Inspector
**✅ Already Has:**
- Render cascade tree
- Component render count
- Timeline

**❌ TODO:**
- Show change detection strategy (OnPush? Default?)
- Link to Execution Explorer (show which chapter triggered this)
- Highlight slow renders (> 16ms)
- Show render reason clearly

**Priority:** HIGH - Users need to understand WHY components re-render

---

### For Performance Overview
**Status:** Needs review
**Priority:** MEDIUM - Not entry point, but important for trends

---

### For Recommendations
**Status:** Needs review
**Priority:** HIGH - Users want actionable advice

---

### For Memory Analyzer
**Status:** Needs review
**Priority:** MEDIUM - Only relevant for specific issues

---

## Next Immediate Steps

1. **Fix Execution Explorer**
   - Fix template null check errors
   - Ensure bottleneck detection works
   - Test the flow

2. **Strengthen Rendering Inspector**
   - Add change detection info
   - Highlight slow renders
   - Link to Execution Explorer

3. **Ensure Cohesion**
   - Each panel links to related panels
   - Users can flow between panels
   - Clear navigation

---

## Key Philosophy

**Don't make one super-panel.**

Make **five focused panels** that each do one thing well:

- Execution Explorer: What happened (business view)
- Rendering Inspector: Why did renders happen (technical view)
- Performance Overview: Is it healthy (diagnostic view)
- Recommendations: What to fix (action view)
- Memory Analyzer: Memory issues (specialized view)

Each panel is simple. Each panel is focused. Together, they're powerful.
