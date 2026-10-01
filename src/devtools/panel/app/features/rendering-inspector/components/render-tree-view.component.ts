/**
 * Render Tree View Component
 *
 * Component-first render tree. Shows what loaded on the page as a real
 * parent-child hierarchy, with a render COUNT on every node (the honest,
 * measured signal) and a count-weighted heat bar. Timing (ms) is an estimate
 * (frame time split across components) and is shown as a secondary, ~-labelled
 * value only.
 *
 * Interactions:
 * - Search filters the tree by component name.
 * - Chevrons expand/collapse subtrees (collapsed by default; the path to the
 *   worst offender is auto-expanded via `autoExpandPath`).
 * - Clicking a node emits the full node data (including the cause histogram)
 *   so the details panel can explain WHY it rendered multiple times.
 */
import { Component, input, output, computed, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { displayName } from '../../../utils/display-name';

export interface CascadeNodeData {
  componentName: string;
  count: number;
  totalDuration: number;
  cause: { type: string; source?: string };
  depth: number;
  children: CascadeNodeData[];
  reasons?: any[];
  causeBreakdown?: Record<string, number>;
  parentRenders?: number;
  ownRenders?: number;
}

/** Legacy alias for backward compat */
export type TreeNodeData = CascadeNodeData & { displayName: string; severity: string; impactPct?: number; isTrigger?: boolean; expanded?: boolean; isHovered?: boolean };

/** A flattened, display-ready component row. */
interface TreeRow {
  id: string;
  componentName: string;
  displayName: string;
  count: number;
  totalDuration: number;
  cause: { type: string; source?: string };
  causeBreakdown?: Record<string, number>;
  parentRenders?: number;
  ownRenders?: number;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  children: CascadeNodeData[];
  severity: 'high' | 'medium' | 'low' | 'none';
  isHotspot: boolean;
  /** 0..1 heat, scaled by render count relative to the hottest node. */
  heat: number;
  reasons?: any[];
  parentName?: string;
}

@Component({
  selector: 'app-render-tree-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rtv">
      <!-- Search -->
      <div class="rtv-search">
        <span class="rtv-search__icon">⌕</span>
        <input
          class="rtv-search__input"
          type="text"
          placeholder="Search components…"
          [value]="searchTerm()"
          (input)="onSearch($event)" />
        @if (searchTerm()) {
          <button class="rtv-search__clear" (click)="clearSearch()" title="Clear">×</button>
        }
        <button class="rtv-legend-toggle" (click)="showLegend.set(!showLegend())" title="What the symbols mean">?</button>
      </div>

      <!-- Symbol legend (opt-in, so the glyphs aren't an arbitrary language) -->
      @if (showLegend()) {
        <div class="rtv-legend">
          <span><b>S</b> signal · <b>I</b> input · <b>P</b> parent (inferred) · <b>?</b> unknown</span>
          <span>🔥 hotspot · <b>N</b> render count · ~ms est.</span>
        </div>
      }

      <!-- Tree rows -->
      <div class="rtv-rows">
        @for (row of visibleRows(); track row.id) {
          <div class="rtv-node"
               [style.padding-left.px]="row.depth * 16 + 6"
               [class.rtv-node--selected]="selectedName() === row.displayName"
               [class.rtv-node--high]="row.severity === 'high'"
               [class.rtv-node--medium]="row.severity === 'medium'"
               (mouseenter)="onHover(row)"
               (mouseleave)="onHoverLeave()"
               (click)="onSelect(row)">

            <!-- Expand/collapse chevron -->
            @if (row.hasChildren) {
              <button class="rtv-chevron"
                      [class.rtv-chevron--open]="row.isExpanded"
                      (click)="toggleExpand(row, $event)">▸</button>
            } @else {
              <span class="rtv-chevron rtv-chevron--leaf">·</span>
            }

            <!-- Component name -->
            <span class="rtv-name">{{ row.displayName }}</span>

            <!-- Badges -->
            <div class="rtv-badges">
              @if (row.isHotspot) {
                <span class="rtv-flame">🔥</span>
              }

              <span class="rtv-origin" [class]="originClass(row)" [title]="originTitle(row)">{{ originGlyph(row) }}</span>

              <span class="rtv-count-pill" [class]="getCountPillClass(row.count)">
                {{ row.count }}
              </span>

              @if (row.totalDuration > 0) {
                <span class="rtv-duration" [class]="getDurationColorClass(row.totalDuration)"
                      title="Estimated: frame time split across components in this cycle">
                  ~{{ row.totalDuration | number:'1.0-0' }}ms
                </span>
              }
            </div>

            <!-- Count-weighted heat bar -->
            <div class="rtv-heat">
              <div class="rtv-heat__fill" [class]="getCountPillClass(row.count)" [style.width.%]="row.heat * 100"></div>
            </div>
          </div>
        }

        @if (visibleRows().length === 0) {
          <div class="rtv-empty">
            @if (searchTerm()) {
              No components match "{{ searchTerm() }}"
            } @else {
              No components rendered in this action
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .rtv {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 11px;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Search ── */
    .rtv-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--ri-border);
      flex-shrink: 0;
    }
    .rtv-search__icon { color: var(--ri-text-muted); font-size: 12px; }
    .rtv-search__input {
      flex: 1;
      background: var(--ri-bg-deep);
      border: 1px solid var(--ri-border);
      border-radius: 4px;
      color: var(--ri-text-bright);
      font-size: 11px;
      padding: 4px 8px;
      outline: none;
    }
    .rtv-search__input:focus { border-color: var(--ri-accent-blue); }
    .rtv-search__clear {
      background: none; border: none; color: var(--ri-text-muted);
      font-size: 14px; cursor: pointer; padding: 0 4px;
    }
    .rtv-search__clear:hover { color: var(--ri-text-bright); }
    .rtv-legend-toggle {
      background: none; border: 1px solid var(--ri-border); border-radius: 3px;
      color: var(--ri-text-muted); font-size: 10px; width: 18px; height: 18px; cursor: pointer; padding: 0;
      flex-shrink: 0;
    }
    .rtv-legend-toggle:hover { color: var(--ri-text-bright); border-color: var(--ri-border-hover); }
    .rtv-legend {
      display: flex; flex-direction: column; gap: 2px;
      padding: 5px 10px; border-bottom: 1px solid var(--ri-border);
      font-size: 9.5px; color: var(--ri-text-muted); line-height: 1.5;
      b { color: var(--ri-text-secondary); font-weight: 700; }
    }

    .rtv-rows { flex: 1; overflow-y: auto; padding: 4px 0; }

    /* ── Component Render Row ── */
    .rtv-node {
      position: relative;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 8px;
      cursor: pointer;
      border-left: 2px solid transparent;
      transition: background 0.1s, border-color 0.1s;
      min-height: 26px;
    }
    .rtv-node:hover { background: color-mix(in srgb, var(--ri-blue) 5%, transparent); }
    .rtv-node--selected {
      background: color-mix(in srgb, var(--ri-blue) 8%, transparent);
      border-left-color: var(--ri-accent-blue);
    }
    .rtv-node--high { border-left-color: var(--ri-accent-red); background: color-mix(in srgb, var(--ri-red) 3%, transparent); }
    .rtv-node--high:hover { background: color-mix(in srgb, var(--ri-red) 7%, transparent); }
    .rtv-node--medium { border-left-color: var(--ri-accent-amber); background: color-mix(in srgb, var(--ri-amber) 2%, transparent); }
    .rtv-node--medium:hover { background: color-mix(in srgb, var(--ri-amber) 5%, transparent); }

    .rtv-chevron {
      width: 14px;
      flex-shrink: 0;
      font-size: 9px;
      color: var(--ri-text-muted);
      text-align: center;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      transition: transform 0.12s ease;
    }
    .rtv-chevron--open { transform: rotate(90deg); }
    .rtv-chevron--leaf { cursor: default; font-size: 8px; opacity: 0.5; }

    .rtv-name {
      color: var(--ri-text-bright);
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
      font-size: 11px;
    }

    .rtv-badges { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .rtv-flame { font-size: 10px; line-height: 1; }

    /* Render-origin glyph — subtle, revealed on row hover to avoid clutter */
    .rtv-origin {
      font-family: inherit;
      font-size: 9px;
      font-weight: 700;
      width: 13px;
      height: 13px;
      line-height: 13px;
      text-align: center;
      border-radius: 3px;
      color: var(--ri-text-secondary);
      background: color-mix(in srgb, var(--ri-text-muted) 15%, transparent);
      opacity: 0;
      transition: opacity 0.12s;
    }
    .rtv-node:hover .rtv-origin,
    .rtv-node--selected .rtv-origin { opacity: 1; }
    /* Concept-coded origin glyph — matches the flow diagram + why-list colors. */
    .rtv-origin--parent { color: var(--sem-parent); background: var(--sem-parent-bg); }
    .rtv-origin--signal { color: var(--sem-signal); background: var(--sem-signal-bg); }
    .rtv-origin--input  { color: var(--sem-input);  background: var(--sem-input-bg); }
    .rtv-origin--unknown{ color: var(--sem-unknown); background: var(--sem-unknown-bg); }

    .rtv-count-pill {
      font-family: inherit;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
      line-height: 1.4;
      min-width: 22px;
      text-align: center;
    }
    .rtv-count--critical { background: color-mix(in srgb, var(--ri-red) 15%, transparent); color: var(--ri-accent-red); }
    .rtv-count--warning  { background: color-mix(in srgb, var(--ri-amber) 15%, transparent); color: var(--ri-accent-amber); }
    .rtv-count--normal   { background: color-mix(in srgb, var(--ri-text-muted) 10%, transparent); color: var(--ri-text-secondary); }

    .rtv-duration {
      font-family: inherit;
      font-size: 9px;
      font-weight: 600;
    }
    .rtv-dur--critical { color: var(--ri-accent-red); }
    .rtv-dur--warning  { color: var(--ri-accent-amber); }
    .rtv-dur--normal   { color: var(--ri-text-muted); }

    /* ── Count-weighted heat bar (sits at the bottom edge of the row) ── */
    .rtv-heat {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 2px;
      background: transparent;
      pointer-events: none;
    }
    .rtv-heat__fill { height: 100%; opacity: 0.55; }
    .rtv-heat__fill.rtv-count--critical { background: var(--ri-accent-red); }
    .rtv-heat__fill.rtv-count--warning  { background: var(--ri-accent-amber); }
    .rtv-heat__fill.rtv-count--normal   { background: var(--ri-border); }

    .rtv-empty {
      padding: 20px;
      text-align: center;
      color: var(--ri-text-muted);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.03em;
    }
  `],
})
export class RenderTreeViewComponent {
  // Inputs
  tree = input<CascadeNodeData[]>([]);
  actionDuration = input<number>(0);
  flowEntries = input<any[]>([]);
  hotspotName = input<string | null>(null);
  /** Component names on the ancestor path to the worst offender (auto-expanded). */
  autoExpandPath = input<string[]>([]);
  /**
   * Display name of the currently-selected component, driven by the parent.
   * The tree highlight is derived from THIS (single source of truth) so the
   * selection is identical across the tree, hotspots, flow, and detail panels —
   * regardless of which surface the selection was made from.
   */
  selectedName = input<string | null>(null);

  // Outputs
  componentSelected = output<any>();
  componentHovered = output<any>();

  // State
  readonly searchTerm = signal<string>('');
  /** Whether the symbol legend is shown (opt-in via the ? button). */
  readonly showLegend = signal(false);
  /** Component names whose subtrees are expanded. */
  readonly expanded = signal<Set<string>>(new Set());

  /** The last auto-expand path we seeded, so we only seed once per distinct path. */
  private lastSeededPath = '';

  /** Signature of the tree we last auto-expanded, so we only do it once per tree. */
  private lastAutoExpandedTreeKey = '';

  constructor() {
    // Seed expansion from the auto-expand path, but only when the path actually
    // changes (a new worst offender). Otherwise we'd stomp the user's manual
    // expand/collapse every time the tree recomputes during live profiling.
    effect(() => {
      const path = this.autoExpandPath();
      const key = path.join('>');
      if (path.length > 0 && key !== this.lastSeededPath) {
        this.lastSeededPath = key;
        this.expanded.update(prev => {
          const next = new Set(prev);
          for (const name of path) next.add(name);
          return next;
        });
      }
    });

    // For small trees, expand everything by default so the displayed renders
    // fully reconcile with the headline count (no hidden nodes under collapsed
    // parents). Large trees stay collapsed for scannability. Runs once per tree.
    effect(() => {
      const tree = this.tree();
      const names: string[] = [];
      const collect = (nodes: CascadeNodeData[]): void => {
        for (const n of nodes) {
          names.push(n.componentName);
          if (n.children?.length) collect(n.children);
        }
      };
      collect(tree);
      const key = names.join('|');
      if (names.length === 0 || key === this.lastAutoExpandedTreeKey) return;
      this.lastAutoExpandedTreeKey = key;
      if (names.length <= 20) {
        this.expanded.update(prev => {
          const next = new Set(prev);
          for (const n of names) next.add(n);
          return next;
        });
      }
    });
  }

  /** Max render count in the tree, for heat normalization. */
  private readonly maxCount = computed(() => {
    let max = 1;
    const walk = (nodes: CascadeNodeData[]): void => {
      for (const n of nodes) {
        if (n.count > max) max = n.count;
        if (n.children?.length) walk(n.children);
      }
    };
    walk(this.tree());
    return max;
  });

  /**
   * Flatten the tree into visible rows, honoring expand/collapse state and
   * the search filter. When searching, all matching nodes (and their ancestors)
   * are shown regardless of collapse state.
   */
  readonly visibleRows = computed((): TreeRow[] => {
    const tree = this.tree();
    const term = this.searchTerm().trim().toLowerCase();
    const expanded = this.expanded();
    const hotspot = this.hotspotName();
    const maxCount = this.maxCount();
    const rows: TreeRow[] = [];
    let rowId = 0;

    // Determine which nodes match the search (by display name).
    const matches = (node: CascadeNodeData): boolean =>
      !term || displayName(node.componentName).toLowerCase().includes(term);

    // A node is kept if it matches OR any descendant matches.
    const subtreeMatches = (node: CascadeNodeData): boolean => {
      if (matches(node)) return true;
      return (node.children ?? []).some(subtreeMatches);
    };

    const severityOf = (count: number): 'high' | 'medium' | 'low' | 'none' => {
      if (count >= 5) return 'high';
      if (count >= 3) return 'medium';
      if (count > 1) return 'low';
      return 'none';
    };

    const walk = (nodes: CascadeNodeData[], depth: number, parentName?: string): void => {
      for (const node of nodes) {
        if (term && !subtreeMatches(node)) continue;

        const hasChildren = (node.children?.length ?? 0) > 0;
        // When searching, force-expand so matches are visible.
        const isExpanded = term ? true : expanded.has(node.componentName);

        rows.push({
          id: `comp-${rowId++}`,
          componentName: node.componentName,
          displayName: displayName(node.componentName),
          count: node.count,
          totalDuration: node.totalDuration,
          cause: node.cause || { type: 'unknown' },
          causeBreakdown: node.causeBreakdown,
          parentRenders: node.parentRenders,
          ownRenders: node.ownRenders,
          depth,
          hasChildren,
          isExpanded,
          children: node.children ?? [],
          severity: severityOf(node.count),
          isHotspot: displayName(node.componentName) === hotspot,
          heat: Math.min(1, node.count / maxCount),
          reasons: node.reasons,
          parentName,
        });

        if (hasChildren && isExpanded) {
          walk(node.children, depth + 1, displayName(node.componentName));
        }
      }
    };

    walk(tree, 0);
    return rows;
  });

  // ── Interactions ──

  onSearch(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.searchTerm.set('');
  }

  toggleExpand(row: TreeRow, event: Event): void {
    event.stopPropagation();
    const next = new Set(this.expanded());
    if (next.has(row.componentName)) {
      next.delete(row.componentName);
    } else {
      next.add(row.componentName);
    }
    this.expanded.set(next);
  }

  onSelect(row: TreeRow): void {
    // No local selection state — the parent owns the selection and feeds it back
    // via [selectedName], so every panel highlights the same component.
    this.componentSelected.emit({
      componentName: row.componentName,
      displayName: row.displayName,
      count: row.count,
      totalDuration: row.totalDuration,
      cause: row.cause,
      causeBreakdown: row.causeBreakdown,
      parentRenders: row.parentRenders,
      ownRenders: row.ownRenders,
      children: row.children,
      reasons: row.reasons,
      parentName: row.parentName,
    });
  }

  onHover(row: TreeRow): void {
    this.componentHovered.emit({
      componentName: row.componentName,
      displayName: row.displayName,
    });
  }

  onHoverLeave(): void {
    this.componentHovered.emit(null);
  }

  // ── Helpers ──

  getCountPillClass(count: number): string {
    if (count >= 5) return 'rtv-count-pill rtv-count--critical';
    if (count >= 3) return 'rtv-count-pill rtv-count--warning';
    return 'rtv-count-pill rtv-count--normal';
  }

  /** Render-origin glyph: S=signal, I=input, P=parent propagation, ?=unknown. */
  originGlyph(row: TreeRow): string {
    const b = row.causeBreakdown ?? {};
    const parent = b['parent'] ?? 0;
    const signal = b['signal'] ?? 0;
    const input = b['input'] ?? 0;
    const own = signal + input + (b['manual-cd'] ?? 0);
    if (own > 0 && own >= parent) return input > signal ? 'I' : 'S';
    if (parent > 0) return 'P';
    return '?';
  }

  originTitle(row: TreeRow): string {
    switch (this.originGlyph(row)) {
      case 'S': return 'Own trigger — signal change observed';
      case 'I': return 'Own trigger — input change observed';
      case 'P': return 'Parent propagation (inferred, same change-detection cycle)';
      default: return 'Unknown origin — no attributable trigger observed';
    }
  }

  /** Concept color class for the origin glyph — matches the flow diagram + why-list. */
  originClass(row: TreeRow): string {
    switch (this.originGlyph(row)) {
      case 'S': return 'rtv-origin--signal';
      case 'I': return 'rtv-origin--input';
      case 'P': return 'rtv-origin--parent';
      default: return 'rtv-origin--unknown';
    }
  }

  getDurationColorClass(ms: number): string {
    if (ms > 50) return 'rtv-duration rtv-dur--critical';
    if (ms > 16) return 'rtv-duration rtv-dur--warning';
    return 'rtv-duration rtv-dur--normal';
  }
}
