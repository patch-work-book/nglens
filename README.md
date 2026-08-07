# ngLens

**See WHY your Angular components re-render.**

ngLens is a Chrome DevTools extension that answers the question every Angular developer asks: **"Why did this component render?"**

It works with Angular 14-22, requires zero configuration, runs entirely in your browser, and nothing leaves your machine.

---

## The Problem

Every Angular developer debugs render performance issues:

- "Which component is re-rendering 47 times?"
- "Why did this parent render cascade to 200 grandchildren?"
- "Did that API call really cause this component to render?"

Angular DevTools shows you the component tree. **ngLens shows you the causality chain.**

---

## How It Works

Open ngLens, interact with your app, and see:

1. **Waterfall Timeline** — When each component rendered (millisecond precision)
2. **Causality Chain** — What triggered each render (user click? API response? signal mutation?)
3. **Component Cascade** — How the render propagated from parent to children
4. **Health Score** — Overall performance health (0-100)

### Example: "Why did 47 ListItems render?"

```
User clicks "Load"
  ↓ triggers API call (/api/items)
    ↓ API responds with 50 items
      ↓ Store updates state
        ↓ ListComponent subscribes → re-renders
          ↓ No trackBy on *ngFor
            ↓ 50 ListItemComponents re-render unnecessarily
              → Solution: Add trackBy with unique ID
```

ngLens shows this entire chain visually, with timing and impact metrics.

---

## Features

### Render Timeline
Waterfall view showing WHEN components rendered, in what order, and for how long:
- Render duration per component
- Severity indicators (low/medium/high/critical)
- Scroll to zoom, click to drill down

### Component Cascade
Hierarchical view showing how renders propagated:
- Parent → Child → Grandchild nesting
- Render counts and timing
- Hotspot indicators (most expensive renders)

### Health Dashboard
Quick overview of app performance:
- Overall health score (0-100)
- Hotspot components (excessive renders)
- Session summary (what user interaction caused this?)

### Causality Analysis
Shows what triggered each render:
- Parent component update? ✓
- API response? ✓
- Signal mutation? ✓
- Timer/WebSocket? ✓

---

## Installation

**Chrome Web Store** (pending approval):
[Install ngLens](https://chrome.google.com/webstore)

**Or build from source**:

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Chrome Manifest V3 |
| Panel UI | Angular 22 |
| Styling | Tailwind CSS |
| Build | Vite + Angular CLI |
| Testing | Vitest |
| Language | TypeScript |

---

## Compatibility

- **Angular**: 14, 15, 16, 17, 18, 19, 20, 21, 22
- **Chrome**: 90+ (with Manifest V3 support)
- **Signals**: Angular 17+ (tracked automatically)
- **Works in**: Development mode AND production (heuristic analysis)
- **Standalone & Module-based**: Both architectures supported

---

## Architecture

ngLens uses a simple 3-stage pipeline:

1. **Collect** — Normalize raw render events from page-script
2. **Analyze** — Build causality chains and compute impact
3. **Format** — Prepare data for UI display

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical overview.

---

## Privacy & Security

✅ All analysis runs **locally in your browser**
✅ Source code and results **never leave your machine**
✅ **Zero telemetry** — no data collection
✅ **Minimal permissions** — `activeTab`, `storage`, `scripting` only
✅ **Production-safe** — uses DOM heuristics when DevTools APIs unavailable
✅ **MIT License** — fully open source and auditable

See [PRIVACY.md](./PRIVACY.md) and [SECURITY.md](./SECURITY.md) for details.

---

## Development

```bash
# Install dependencies
npm install

# Development mode (with hot reload)
npm run dev

# Production build
npm run build

# Run tests
npm test
```

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

- Report bugs with reproduction steps
- Suggest features for specific performance problems
- Submit PRs with tests included

---

## Roadmap

**v2.0** (Current): Render causality analysis and health scoring
**v2.5**: Memory leak detection, subscription cleanup analysis
**v3.0**: Architecture pattern detection, performance regressions

---

## Support

- **Docs**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Issues**: [GitHub Issues](https://github.com/patch-work-book/nglens/issues)
- **Discussions**: [GitHub Discussions](https://github.com/patch-work-book/nglens/discussions)

---

## License

MIT License. See LICENSE file for details.

MIT

---

*ngLens — Because "slow Angular app" doesn't have to be a life sentence.*
