# Next Actions for ngLens

## Immediate (This Week)

### 1. Execution Explorer - VERIFY IT WORKS
- [ ] Test with real Angular app
- [ ] Verify causality chains are detected correctly
- [ ] Verify bottleneck detection highlights the slowest step
- [ ] Check that business chapter names show (not Angular internals)
- [ ] Verify timeline shows accurate timestamps

**Expected flow:**
```
User action → causality chains detected → grouped into chapters 
→ each chapter shows "what was slow" → ready to act
```

### 2. Build Clean Up
- [ ] Remove unused files (if any)
  - `METRICS_ACCESSIBILITY.md` - (We're not using the glossary approach)
  - `docs/BEGINNERS_GUIDE.md` - (Optional, can keep for reference)
  - `src/devtools/panel/app/services/metrics-glossary.service.ts` - (Not used)
  - `src/devtools/panel/app/features/metrics-help/metrics-help.component.ts` - (Not used)

- [ ] Keep essential files
  - `SESSION_SUMMARY.md` - Strategy summary
  - `PANEL_STRATEGY.md` - Panel roles
  - `PANEL_FLOW.md` - User journey
  - `RENDERING_INSPECTOR_ENHANCEMENTS.md` - Enhancement roadmap

---

## Short Term (Next 2 Weeks)

### 1. Strengthen Rendering Inspector

**Phase 1a: Show change detection strategy**
- [ ] Detect if component uses OnPush change detection
- [ ] Display icon: ✅ OnPush or ⚠️ Default
- [ ] Link to documentation

**Phase 1b: Show render reason**
- [ ] Display why each component rendered
  - Parent re-rendered
  - Input changed
  - Zone.run() triggered
  - Manual ChangeDetectorRef
  - Unknown
- [ ] Show which renders were unnecessary

**Phase 1c: Link to Execution Explorer**
- [ ] Show which Execution Explorer chapter triggered this render cascade
- [ ] Add clickable link to jump between panels

---

### 2. Test Cross-Panel Navigation
- [ ] Verify users can jump from Execution Explorer to Rendering Inspector
- [ ] Verify context is preserved
- [ ] Verify links work correctly

---

## Medium Term (Month 2)

### 1. Rendering Inspector Enhancements (Phase 2)
- [ ] Highlight slow renders (> 16ms yellow, > 50ms red)
- [ ] Show render duration clearly
- [ ] Suggest optimizations inline
  - "Use OnPush change detection"
  - "Add trackBy to *ngFor"
  - "Consider memoization"

---

### 2. Performance Overview Review
- [ ] Ensure it shows overall health clearly
- [ ] Add trend visualization
- [ ] Add comparison context ("this is 2x slower than usual")

---

### 3. Recommendations Engine Review
- [ ] Ensure recommendations are ranked by impact
- [ ] Add estimated improvement for each
- [ ] Link to code that needs fixing

---

## Long Term (Month 3+)

### 1. Polish All Panels
- [ ] Ensure consistent UI across all panels
- [ ] Add smooth transitions between panels
- [ ] Add keyboard shortcuts

### 2. Advanced Features
- [ ] Session comparison (compare two execution sessions)
- [ ] Performance regression detection
- [ ] Performance trends/analytics

### 3. Documentation
- [ ] Create help system (not glossaries, but contextual)
- [ ] Create video tutorials
- [ ] Create optimization guides

---

## Success Metrics

### Execution Explorer
- ✅ Shows causality chains correctly
- ✅ Identifies bottleneck accurately
- ✅ Developer immediately understands what was slow

### Rendering Inspector
- ✅ Shows change detection strategy
- ✅ Shows why each component rendered
- ✅ Links to Execution Explorer
- ✅ Developer knows what to optimize

### Cross-Panel Experience
- ✅ Easy navigation between panels
- ✅ Context is preserved
- ✅ Developer can trace issue from high level to detail

---

## Philosophy to Remember

### ✅ DO
- Focus each panel on one job
- Link panels together
- Show contextual information (about THIS app)
- Progressive disclosure (summary first, details on demand)
- Make it actionable (what should I do?)

### ❌ DON'T
- Dump every metric into one panel
- Create glossaries or help documents
- Explain generic Angular concepts
- Make assumptions about user's knowledge
- Forget to link panels together

---

## Questions to Ask When Adding Features

Before adding any feature to Execution Explorer, Rendering Inspector, or other panel:

1. **Does this belong here?** Or should it be in a different panel?
2. **Is this about THIS application** or generic Angular concepts?
3. **Can the user ignore this** if they don't care? (Should be yes)
4. **Does this help them act?** Or just inform?
5. **Can we link to another panel** to provide context?

---

## Key Resources

- `PANEL_STRATEGY.md` - What each panel does
- `PANEL_FLOW.md` - How users navigate
- `RENDERING_INSPECTOR_ENHANCEMENTS.md` - What to build next
- `SESSION_SUMMARY.md` - What happened this session
- `CAUSALITY_DETECTION_SYSTEM.md` - How causality chains work

---

## Current Build Status

✅ **PASSING**
- No errors
- No warnings
- Production ready

```bash
npm run build  # Takes ~6s, builds successfully
```

---

## Remaining Work

### Done This Session
- ✅ Built causality detection pipeline (Phases 1-10)
- ✅ Created Execution Explorer
- ✅ Cleaned up metrics display
- ✅ Added bottleneck detection
- ✅ Created panel strategy
- ✅ Created roadmap for Rendering Inspector

### Ready to Do
- ❌ Strengthen Rendering Inspector (priority)
- ❌ Test with real Angular app
- ❌ Cross-link panels

### Optional (If Time)
- ⚪ Performance Overview improvements
- ⚪ Recommendations engine improvements
- ⚪ Memory analyzer review

---

**Goal:** Make Execution Explorer + Rendering Inspector the core value of ngLens.

Then expand to other panels if needed.
