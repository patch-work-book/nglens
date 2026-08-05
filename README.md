# ngLens

**See what Angular doesn't show you.**

ngLens is a Chrome DevTools extension that tells you WHY your Angular app is slow — in seconds, with zero config, and nothing leaves your machine.

![ngLens — Angular Performance DevTools](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/first-page.png)

---

## The Problem

![Every Angular developer asks...](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/the-problem.png)

Angular DevTools shows you components. ngLens shows you **why they rendered**, **what triggered it**, and **how to fix it**.

---

## ngLens vs Angular DevTools

![ngLens vs Angular DevTools](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/comparison-ng-s-nglens.png)

| Feature | Angular DevTools | ngLens |
|---------|:---:|:---:|
| Component tree | ✓ | ✓ |
| WHY it rendered | ✗ | ✓ |
| Waterfall timeline | ✗ | ✓ |
| API → Store → Component chain | ✗ | ✓ |
| Memory leak detection | ✗ | ✓ |
| Impact scoring | ✗ | ✓ |
| Targeted fix per component | ✗ | ✓ |
| Signal tracking (computed, input) | ✗ | ✓ |
| Duplicate API detection | ✗ | ✓ |
| Jank detection (frame drops) | ✗ | ✓ |

---

## Features

### Execution Explorer

![Execution Explorer](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/execution-explorer.png)

Horizontal waterfall timeline showing WHEN things happened — like Chrome's Network tab, but for your Angular app's internal execution:

- When each component rendered relative to others
- Which API call is the bottleneck (highlighted automatically)
- Millisecond-precision timing for every operation
- Interactive category filters (APIs, Components, State, Signals)

### Performance Overview

![Overview — app health at a glance](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/overview.png)

Instant health check with zero effort:

- Risk score (0–100) per component
- Top issue with root cause identified
- Suggested fix with expected performance gain
- Environment detection (production/dev mode)

### Render Inspector

![Render Inspector](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/render-inspector.png)

Component cascade showing render counts, severity, and data flow:

- Ranked by render count and time cost
- Hotspot indicator for worst offenders
- Action-level breakdown (Click, Change, Input events)

### Causal Chains

![Causal chains — which API affected which component](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/render-inspector-casual-chains.png)

Trace the full path: API → Store → Component:

- Links API calls to state changes to component renders
- Flags duplicate APIs automatically
- Counts impacted components per action

### Memory Analyzer & Recommendations

![Memory leaks and recommendations](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/memory-recommandations.png)

Detects leaks and gives you prioritized, actionable fixes:

- Surviving subscriptions with exact fix patterns
- Unmanaged timers and DOM listeners
- Recommendations ranked by impact (HIGH / MED / LOW)

### Hotspots & Compare Runs

![Hotspots and Compare](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/overview-hotspot.png)

Save a baseline → Make your fix → Capture again → See the improvement instantly.

### Signal Reactivity Tracking

![Signals — Angular 17-22](https://raw.githubusercontent.com/patch-work-book/nglens/execution-explorer/screenshots/singals.png)

Full signal chain tracking across Angular versions:

- **Angular 17+** — `computed()` recomputation, `input()` signals
- **Angular 19+** — `linkedSignal()`, `resource()`, `httpResource()`
- **Angular 22** — Signal Forms, `@Service()`, all stable signal APIs

---

## Architecture

```
src/
├── instrumentation/        # Runtime instrumentation (page-script, MAIN world)
│   ├── render-tracker.ts           # Change detection cycle monitoring
│   ├── flow-tracker.ts             # RxJS, Signals, HTTP, Router tracing
│   ├── leak-detector.ts            # Subscription & timer leak detection
│   ├── freeze-detector.ts          # UI jank detection
│   ├── zone-pollution-detector.ts  # Idle CD trigger identification
│   ├── trackby-detector.ts         # Missing trackBy in *ngFor
│   ├── template-expression-tracker.ts  # Expensive binding detection
│   ├── selective-analyzer.ts       # Deep per-component scan
│   └── orchestrator.ts             # Coordination & lifecycle
│
├── analyzers/              # Static analyzers (on-demand scan)
│   ├── performance-scorer.ts       # Health scoring (0-100)
│   ├── dom-inspector.ts            # DOM tree analysis
│   ├── production-analyzer.ts      # Production heuristics
│   ├── enterprise-optimizer.ts     # Enterprise-scale patterns
│   ├── best-practices-detector.ts  # Anti-pattern detection
│   ├── subscription-leak-detector.ts  # RxJS cleanup analysis
│   └── signals-analyzer.ts         # Signal usage analysis
│
├── devtools/panel/app/features/    # Angular DevTools Panel UI
│   ├── execution-explorer/         # Waterfall timeline
│   ├── performance-overview/       # Health & hotspots
│   ├── rendering-inspector/        # Component cascade
│   ├── memory-analyzer/            # Leak detection
│   ├── recommendations-engine/     # Fix suggestions
│   └── metrics-help/               # Learning & docs
│
├── background/             # Service worker (message routing, tab state)
├── content/                # Content script (message bridge, injection)
├── services/               # Shared services
├── types/                  # TypeScript interfaces
└── utils/                  # DOM helpers, serialization, timing
```

---

## Compatibility

- **Angular 14–22** — Full runtime tracking
- **Signals** — Angular 17+ (computed, input, linkedSignal, resource)
- **Works in production** — DOM attribute heuristics when `window.ng` unavailable
- **Standalone & Module-based** — Both architectures supported
- **Micro-frontends** — Multi-app detection
- **NgRx / Signal Store / Facades** — State management aware

---

## Performance Budget

ngLens self-monitors to stay invisible:

- **< 3% CPU** overhead
- **< 50MB memory** usage
- Event batching (100ms debounce)
- Automatic throttling on heavy apps

---

## Privacy & Security

- ✅ All analysis runs **locally in your browser**
- ✅ Source code and results **never leave your machine**
- ✅ **Minimal permissions** — `activeTab`, `storage`, `scripting`
- ✅ Strict Content Security Policy
- ✅ No telemetry — optional analytics require explicit opt-in
- ✅ MIT License — fully open source and auditable

See [PRIVACY.md](./PRIVACY.md) and [SECURITY.md](./SECURITY.md) for details.

---

## Install

**Chrome Web Store:**
[Install ngLens](https://chrome.google.com/webstore/category/extensions)

**Or build from source:**

```bash
git clone https://github.com/patch-work-book/nglens.git
cd nglens
npm install
npm run build
```

Then load in Chrome:
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` folder

---

## Development

```bash
# Install dependencies
npm install

# Dev mode (panel + extension with hot reload)
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| Panel UI | Angular 22 |
| Styling | Tailwind CSS |
| Extension Build | Vite |
| Testing | Vitest |
| Extension Standard | Chrome Manifest V3 |

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

- MIT License
- "ngLens" name and logo are trademark protected ([TRADEMARK.md](./TRADEMARK.md))
- Follow secure coding practices
- Sign your commits

---

## Roadmap

- **V1.2** (current): Execution Explorer, Render Inspector, Memory Analyzer, Recommendations, Signals tracking
- **V2**: CD profiler, Zone.js profiler, FPS monitor, interaction latency
- **V3**: Architecture smells, regression detection, Signals migration assistant

---

## License

MIT

---

*ngLens — Because "slow Angular app" doesn't have to be a life sentence.*
