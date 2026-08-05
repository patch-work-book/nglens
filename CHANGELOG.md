# Changelog

All notable changes to ngLens will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-30

### 🚀 Production Release - First Stable Version

**5 Zero-UX Features (Zero Configuration):**
- ✅ Render Count - Deduplicated render tracking with 50ms coalescing
- ✅ Tooltip on Hover - Execution timeline hover indicator with time labels
- ✅ Bottleneck Detection - Automatic hotspot highlighting with red pulse animation
- ✅ Extended API Visibility - 280px name column (expanded from 180px) for full URL visibility
- ✅ Auto-Select Latest Action - Smart Render Inspector default that preserves user selection

**Render Inspector Updates:**
- Auto-select latest action on first load (only on initial load, preserves user choice after)
- Removed bottom hotspot/suggestion/performance rating area for cleaner UI
- Component Cascade + Data Flow side-by-side layout

**Dark Theme:**
- Complete dark theme implementation throughout extension
- CSS variable system supporting both light and dark modes
- Presentation slides updated with dark gradient backgrounds
- Proper contrast and accessibility across all components
- Scrollbar styling for dark devtools aesthetic

**Accuracy & Confidence Framework:**
- 3-layer accuracy model documented (99.9% → 40-70% range)
- Handles diverse architectures (micro-frontends, facade pattern, SSR)
- ACCURACY_VALIDATION_FRAMEWORK.md for transparency
- CONFIDENCE_SCORING_IMPLEMENTATION.md for scoring system

**Build & Quality:**
- Clean production build: 342.59 kB initial chunk, 6 lazy chunks
- Zero warnings, zero errors
- Unused imports removed (TooltipDirective, TitleCasePipe)
- Optimized bundle with tree-shaking enabled
- Ready for Chrome Web Store submission

**Documentation:**
- Release notes with comprehensive feature overview
- Known limitations clearly documented
- System requirements specified (Chrome 90+, Angular 12+)
- Accuracy variance by architecture explained

### Fixed 🔧
- Removed unused component imports causing build warnings
- Cleaned up execution-report component template
- Extended waterfall timeline API name column to 280px for full visibility

### Known Limitations ⚠️
- Confidence varies by architecture (60-85% range)
- Micro-frontends may show split causality chains
- SSR apps may have overlapping render events
- Facade patterns may obscure direct API→component links
- Memory usage: ~2-5MB during recording on heavy apps

## [1.1.4] - 2026-07-09

### Fixed 🔧

**Chrome Web Store Validation:**
- Disabled minification for extension scripts (content.js, background.js) for Chrome Web Store compliance
- Ensures readable source code for security review
- Fixed "Package is invalid. Could not load javascript 'content.js'" error on publish
- All JavaScript now includes source maps for debugging

**UI Improvements:**
- Fixed duplicate component instantiation when clicking same navigation link repeatedly
- Prevents state duplication in Render Inspector, Memory Analyzer, and other tabs
- Improved toolbar navigation with smart route checking

### Build & Architecture 🏗️

- Reorganized DevTools panel from `pages/` to `features/` directory structure
- Added path aliases (@nglens/*, @types/*, @utils/*, @analyzers/*, @instrumentation/*)
- Updated build configuration for better readability and maintainability
- All lazy-loaded chunks properly generated and included in package

## [1.1.0] - 2026-05-15

### Added ⚡

**Signals Analyzer (NEW):**
- Added Signals performance analysis for supported Angular apps
- Detects expensive computed signals with nested operations
- Identifies O(n²) complexity in computed signals
- Warns about large collections without proper equality
- Detects Signal/RxJS mixing without interop (toSignal/toObservable)
- Flags over-granular signal splitting
- Reviews effect usage (suggests computed instead)

**Professional UI Redesign:**
- Chrome DevTools-style dark theme
- Lighthouse-style circular score gauge with animation
- Tab navigation (Issues / Performance)
- Expandable/collapsible issue cards
- Severity and category filtering
- Smooth animations and transitions
- Monospace fonts for technical data

**Overlay Feature (V1 Completion):**
- Visual DOM overlays highlight performance issues
- Color-coded by severity (red/orange/yellow/blue/gray)
- Auto-fade after 5 seconds
- Click to dismiss manually
- "Show All Issues" and "Clear Overlays" controls
- Works in production mode

**Security Hardening:**
- MIT License (permissive open-source license)
- Content Security Policy (strict CSP)
- PRIVACY.md (transparency document)
- SECURITY.md (vulnerability reporting)
- TRADEMARK.md (name protection)
- Copyright headers on all source files
- .gitignore for secrets
- Minimal permissions in manifest
- Signed commits required for contributors

### Changed

- UI completely redesigned with professional dark theme
- manifest.json hardened with CSP and minimal permissions
- README updated with security information

### Fixed

- None (initial security-hardened release)

## [1.0.0] - 2026-05-14

### Added

- Angular Detection (dev & production mode)
- Performance Score (0-100 weighted)
- DOM Inspector (complexity, layout thrashing)
- Production Heuristics (works without window.ng)
- OnPush Detection
- trackBy Detection
- Best Practices analyzer
- Performance Budget monitoring (<3% CPU, <50MB RAM)
- Subscription Leak Detector (10+ cleanup patterns)
- Learning mode with educational content
- Action Items prioritization
- Chrome Extension Manifest V3
- TypeScript + Vite build system

---

## Version History

- **v1.1.0** - Signals analyzer, professional UI, security hardening
- **v1.0.0** - Initial release with core analyzers

## Upgrade Notes

### v1.0.0 → v1.1.0

**No breaking changes.** Simply update the extension.

**New Features:**
- Signals performance analysis for supported Angular apps
- Visual overlays on page
- Professional dark UI
- Enhanced security

**Benefits:**
- Detect expensive computed signals
- Find Signal/RxJS mixing issues
- Better visual feedback
- Improved trust and security

---

## Reporting Issues

Found a bug? [Create an issue](https://github.com/gowtham-labs/nglens/issues)

Security vulnerability? See [SECURITY.md](./SECURITY.md)

---

[1.1.0]: https://github.com/gowtham-labs/nglens/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/gowtham-labs/nglens/releases/tag/v1.0.0
