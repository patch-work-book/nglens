# ngLens Panel Flow - User Journey

## The Ideal Developer Experience

### Scenario: "My Dashboard Feels Slow"

```
┌─────────────────────────────────────────────────────────────────┐
│ Developer: Dashboard loaded but feels slow. What's wrong?      │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: EXECUTION EXPLORER (Entry Point)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 🎯 Dashboard Bootstrap | 4.6s | Score: 62/100 | ⚠️ 2 Issues    │
│                                                                 │
│ Left: Sessions        Center: Chapters        Right: Inspector │
│ ─────────────────     ─────────────────       ─────────────    │
│ Dashboard             ① Load Revenue          🎯 What's Slow?   │
│   Bootstrap           ② Load Orders           Revenue API      │
│                       ③ Render Charts         2.1s (slow)      │
│                                               ───────────      │
│                                               🔗 What Happened  │
│                                               0ms→ API start    │
│                                               2.1s→ API done    │
│                                               2.1s→ Store       │
│                                               2.2s→ Render      │
│                                                                 │
│ Developer: "OK, Revenue API took 2.1 seconds. That's the issue" │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Developer: "But I also saw 4 component renders. Why so many?"  │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: RENDERING INSPECTOR (Deep Dive)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Render Cascade for "Load Revenue" (Linked from Execution Explorer)
│                                                                 │
│ RevenueChart                                                   │
│   ✅ OnPush optimized                                           │
│   3 renders in 78ms                                            │
│   ① 0ms    (Initial render) ✓                                  │
│   ② 45ms   (Unnecessary) ⚠️ Caused by: Parent re-render       │
│   ③ 90ms   (Unnecessary) ⚠️ Same cause                         │
│                                                                 │
│ SummaryCard                                                    │
│   ⚠️ Default change detection (NOT OnPush)                     │
│   2 renders in 15ms                                            │
│   ① 0ms    (Initial render) ✓                                  │
│   ② 20ms   (Unnecessary) ⚠️ Caused by: Zone.run()             │
│                                                                 │
│ Developer: "RevenueChart has OnPush but still rendered 3 times │
│            because parent re-rendered. And SummaryCard isn't  │
│            using OnPush at all!"                              │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Developer: "What should I do about this?"                      │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: RECOMMENDATIONS (Action Items)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Ranked by Impact:                                              │
│                                                                 │
│ 1. 🔴 Optimize Revenue API                                     │
│    Current: 2.1s  →  Target: 0.3s                             │
│    Estimated improvement: +35 points                           │
│    Action: Work with backend team                             │
│                                                                 │
│ 2. 🟠 Add OnPush to SummaryCard                                │
│    Current: 2 renders  →  Target: 1 render                    │
│    Estimated improvement: +8 points                            │
│    Action: Change ChangeDetectionStrategy.OnPush              │
│                                                                 │
│ 3. 🟡 Optimize parent render logic                             │
│    Current: Parent re-renders children 2x                     │
│    Estimated improvement: +5 points                            │
│    Action: Add trackBy to *ngFor, use memoization             │
│                                                                 │
│ Developer: "OK, my action plan is:                             │
│            1. Talk to backend about API optimization            │
│            2. Add OnPush to SummaryCard                         │
│            3. Optimize parent component"                       │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Developer implements fixes                                      │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: PERFORMANCE OVERVIEW (Verify Improvement)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Performance Score Trend                                        │
│                                                                 │
│ 📊 Today:   Score: 82  ✅ Good                                 │
│ 📊 Yesterday: Score: 62 (was bad)                              │
│ 📊 Improvement: +20 points (32% better)                        │
│                                                                 │
│ Dashboard loaded in 1.8s (was 4.6s)                            │
│ Revenue API: 0.3s (was 2.1s) ✓ Fixed                           │
│ Renders: 3 (was 6) ✓ Improved                                  │
│                                                                 │
│ Developer: "Great! Dashboard loads much faster now."           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Panel Navigation Model

```
Developer's Journey:

1. Something seems slow
   │
   └─→ 2. Open ngLens → Execution Explorer
       │
       ├─→ Understanding question?
       │   "What happened?"  → Stay in Execution Explorer
       │
       └─→ Technical question?
           "Why did components re-render?" → Switch to Rendering Inspector
                                      │
                                      └─→ Performance question?
                                          "Is this normal?" → Switch to Performance Overview

3. Ready to act
   │
   └─→ Switch to Recommendations
       "What should I fix first?"

4. Verify improvements
   │
   └─→ Switch to Performance Overview
       "Did performance improve?"
```

---

## Each Panel's Purpose

### Execution Explorer
**Question it answers:** What happened?

**Information provided:**
- Business operation (chapter name)
- Timeline of causality
- What data changed
- Which components were affected
- What was the bottleneck

**Who uses it:** Everyone - this is the entry point

---

### Rendering Inspector
**Question it answers:** Why did components re-render?

**Information provided:**
- Render cascade tree
- Which components rendered how many times
- Why each rendered (parent? input? zone?)
- Change detection strategy
- Slow renders highlighted
- Optimizations suggested

**Who uses it:** Developers investigating render performance

---

### Performance Overview
**Question it answers:** Is my app healthy?

**Information provided:**
- Overall performance score
- Key metrics
- Trend over time
- Comparisons (normal vs abnormal)

**Who uses it:** Developers monitoring health, checking for regressions

---

### Recommendations
**Question it answers:** What should I fix?

**Information provided:**
- Ranked list of optimizations
- Estimated impact of each
- How to implement
- Links to relevant code/docs

**Who uses it:** Developers ready to optimize

---

### Memory Analyzer
**Question it answers:** Am I leaking memory?

**Information provided:**
- Memory usage over time
- Object retention graph
- Potential leak detection
- Size of key objects

**Who uses it:** Developers debugging memory issues

---

## Why This Works

### Each panel is focused
- Doesn't try to do everything
- Single responsibility
- Easy to understand and navigate

### Panels link to each other
- Jump from Execution Explorer to Rendering Inspector
- See context everywhere

### Progressive disclosure
- Start with the answer (Execution Explorer)
- Drill into details (Rendering Inspector)
- Get actions (Recommendations)
- Track progress (Performance Overview)

### No glossaries or docs
- Information is contextual
- About THIS application
- Every metric is explained inline

### Developers can skip panels
- Don't care about renders? Skip Rendering Inspector
- Don't care about memory? Skip Memory Analyzer
- Just want the answer? Use Execution Explorer
