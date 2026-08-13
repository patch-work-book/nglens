/**
 * Render Tree View Component
 *
 * Displays the full component cascade tree (always expanded) with flow events
 * (API calls, signal writes, store dispatches) interleaved between component renders.
 * This lets developers see exactly what triggered each component render.
 *
 * Layout:
 *   🌐 GET /api/users → 200               (flow event)
 *   🗄 [AUTH] SET_USER                     (flow event)
 *   ⚡ userSignal.set()                    (flow event)
 *     LayoutComponent      ⬆️Parent  1ms  (component render)
 *       SidebarComponent   ⬆️Parent  6ms  (component render)
 *       HeaderComponent    ⚡Signal  2ms  (component render)
 */
import { Component, input, output, computed, signal, ChangeDetectionStrategy } from '@angular/core';
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
}

/** Legacy alias for backward compat */
export type TreeNodeData = CascadeNodeData & { displayName: string; severity: string; impactPct?: number; isTrigger?: boolean; expanded?: boolean; isHovered?: boolean };

/** A row in the unified timeline (either a component render or a flow event) */
interface TimelineRow {
  id: string;
  kind: 'component' | 'flow';
  // Component fields
  componentName?: string;
  displayName: string;
  count?: number;
  totalDuration?: number;
  cause?: { type: string; source?: string };
  depth: number;
  hasChildren?: boolean;
  children?: CascadeNodeData[];
  severity?: 'high' | 'medium' | 'low' | 'none';
  isHotspot?: boolean;
  reasons?: any[];
  // Flow fields
  flowIcon?: string;
  flowType?: string;
  flowLabel?: string;
}

@Component({
  selector: 'app-render-tree-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rtv">
      @for (row of timelineRows(); track row.id) {

        @if (row.kind === 'flow') {
          <!-- ═══ FLOW EVENT ROW (API / Signal / Store) ═══ -->
          <div class="rtv-flow" [class.rtv-flow--connector]="row.flowType === 'connector'" [style.padding-left.px]="row.depth * 18 + 8">
            <span class="rtv-flow__icon">{{ row.flowIcon }}</span>
            <span class="rtv-flow__label" [class]="'rtv-flow--' + row.flowType">{{ row.flowLabel }}</span>
          </div>

        } @else {
          <!-- ═══ COMPONENT RENDER ROW ═══ -->
          <div class="rtv-node"
               [style.padding-left.px]="row.depth * 18 + 8"
               [class.rtv-node--selected]="selectedNode() === row.componentName"
               [class.rtv-node--high]="row.severity === 'high'"
               [class.rtv-node--medium]="row.severity === 'medium'"
               (mouseenter)="onHover(row)"
               (mouseleave)="onHoverLeave()"
               (click)="onSelect(row)">

            <!-- Tree connector -->
            <span class="rtv-connector">{{ row.hasChildren ? '▸' : '·' }}</span>

            <!-- Component Name -->
            <span class="rtv-name">{{ row.displayName }}</span>

            <!-- Inline Badges -->
            <div class="rtv-badges">
              @if (row.isHotspot) {
                <span class="rtv-flame">🔥</span>
              }

                @if (row.cause?.type && row.cause.type !== 'parent' && row.cause.type !== 'unknown') {
                <span class="rtv-cause-badge" [class]="'rtv-cause--' + row.cause.type">
                  {{ getCauseBadgeText(row.cause) }}
                </span>
              }

              @if ((row.count || 0) > 1) {
                <span class="rtv-count-pill" [class]="getCountPillClass(row.count || 0)">
                  ×{{ row.count }}
                </span>
              }

              @if ((row.totalDuration || 0) > 0) {
                <span class="rtv-duration" [class]="getDurationColorClass(row.totalDuration || 0)">
                  {{ row.totalDuration | number:'1.0-0' }}ms
                </span>
              }
            </div>
          </div>
        }
      }

      @if (timelineRows().length === 0) {
        <div class="rtv-empty">No components rendered in this action</div>
      }
    </div>
  `,
  styles: [`
    .rtv {
      padding: 4px 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 11px;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Flow Event Row ── */
    .rtv-flow {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      min-height: 20px;
      opacity: 0.85;
    }

    .rtv-flow--connector {
      opacity: 0.5;
      min-height: 14px;
      padding: 1px 8px;
    }

    .rtv-flow--connector .rtv-flow__icon {
      color: #3B82F6;
    }

    .rtv-flow__icon {
      font-size: 10px;
      flex-shrink: 0;
      width: 14px;
      text-align: center;
    }

    .rtv-flow__label {
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rtv-flow--http-response  { color: #67E8F9; }
    .rtv-flow--signal-write   { color: #6EE7B7; }
    .rtv-flow--subject-emit   { color: #C4B5FD; }
    .rtv-flow--store-dispatch { color: #FCD34D; }
    .rtv-flow--store-select   { color: #F9A8D4; }
    .rtv-flow--facade-method  { color: #FDBA74; }
    .rtv-flow--websocket      { color: #A5B4FC; }
    .rtv-flow--route-change   { color: #FCD34D; }

    /* ── Component Render Row ── */
    .rtv-node {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 8px;
      cursor: pointer;
      border-left: 2px solid transparent;
      transition: background 0.1s, border-color 0.1s;
      min-height: 26px;
    }

    .rtv-node:hover { background: rgba(59, 130, 246, 0.05); }

    .rtv-node--selected {
      background: rgba(59, 130, 246, 0.08);
      border-left-color: #3B82F6;
    }

    .rtv-node--high {
      border-left-color: #EF4444;
      background: rgba(239, 68, 68, 0.03);
    }
    .rtv-node--high:hover { background: rgba(239, 68, 68, 0.07); }

    .rtv-node--medium {
      border-left-color: #F59E0B;
      background: rgba(245, 158, 11, 0.02);
    }
    .rtv-node--medium:hover { background: rgba(245, 158, 11, 0.05); }

    .rtv-connector {
      width: 14px;
      flex-shrink: 0;
      font-size: 8px;
      color: #718096;
      text-align: center;
    }

    .rtv-name {
      color: #E8ECF1;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
      font-size: 11px;
    }

    .rtv-badges {
      display: flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
    }

    .rtv-flame { font-size: 10px; line-height: 1; }

    .rtv-cause-badge {
      font-size: 8px;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 2px;
      white-space: nowrap;
      line-height: 1.3;
    }

    .rtv-cause--signal    { background: rgba(16, 185, 129, 0.12); color: #6EE7B7; }
    .rtv-cause--zone      { background: rgba(59, 130, 246, 0.12); color: #7CB3F9; }
    .rtv-cause--parent    { background: rgba(167, 139, 250, 0.12); color: #C4B5FD; }
    .rtv-cause--input     { background: rgba(34, 211, 238, 0.12); color: #67E8F9; }
    .rtv-cause--manual-cd { background: rgba(245, 158, 11, 0.12); color: #FCD34D; }
    .rtv-cause--unknown   { background: rgba(113, 128, 150, 0.12); color: #A0AEC0; }

    .rtv-count-pill {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      font-weight: 700;
      padding: 0px 3px;
      border-radius: 2px;
      line-height: 1.4;
    }

    .rtv-count--critical { background: rgba(239, 68, 68, 0.15); color: #FCA5A5; }
    .rtv-count--warning  { background: rgba(245, 158, 11, 0.15); color: #FCD34D; }
    .rtv-count--normal   { background: rgba(113, 128, 150, 0.1); color: #A0AEC0; }

    .rtv-duration {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      font-weight: 600;
    }

    .rtv-dur--critical { color: #FCA5A5; }
    .rtv-dur--warning  { color: #FCD34D; }
    .rtv-dur--normal   { color: #718096; }

    .rtv-empty {
      padding: 20px;
      text-align: center;
      color: #718096;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  `],
})
export class RenderTreeViewComponent {
  // Inputs
  tree = input<CascadeNodeData[]>([]);
  actionDuration = input<number>(0);
  flowEntries = input<any[]>([]);
  hotspotName = input<string | null>(null);

  // Outputs
  componentSelected = output<any>();
  componentHovered = output<any>();

  // State
  readonly selectedNode = signal<string | null>(null);

  /**
   * Build a connected causal chain:
   *
   *   EVENT (API/Signal/Store trigger)
   *     ↓
   *   AFFECTED COMPONENT (tree, fully expanded)
   *     └─ child component (render cause inline)
   *
   * Flow events are the "why", components are the "what".
   * Tree is always fully expanded — no collapse.
   */
  readonly timelineRows = computed((): TimelineRow[] => {
    const tree = this.tree();
    const flows = this.flowEntries() || [];
    const hotspot = this.hotspotName();
    const rows: TimelineRow[] = [];
    let rowId = 0;

    // Phase 1: Show triggering events (connected to tree)
    if (flows.length > 0) {
      for (const flow of flows) {
        rows.push({
          id: `flow-${rowId++}`,
          kind: 'flow',
          displayName: flow.label || 'Unknown',
          depth: 0,
          flowIcon: this.getFlowIcon(flow.type),
          flowType: flow.type,
          flowLabel: flow.label,
        });
      }

      // Connector: shows the causal link between events and renders
      rows.push({
        id: `conn-${rowId++}`,
        kind: 'flow',
        displayName: '',
        depth: 0,
        flowIcon: '↓',
        flowType: 'connector',
        flowLabel: '',
      });
    }

    // Phase 2: Component tree (fully expanded, indented under trigger)
    const treeBaseDepth = flows.length > 0 ? 1 : 0;

    const walk = (nodes: CascadeNodeData[], depth: number): void => {
      for (const node of nodes) {
        const impact = node.count * node.totalDuration;
        let severity: 'high' | 'medium' | 'low' | 'none' = 'none';
        if (impact >= 500 || node.count >= 6) severity = 'high';
        else if (impact >= 100 || node.count >= 3) severity = 'medium';
        else if (node.count > 1) severity = 'low';

        rows.push({
          id: `comp-${rowId++}`,
          kind: 'component',
          componentName: node.componentName,
          displayName: displayName(node.componentName),
          count: node.count,
          totalDuration: node.totalDuration,
          cause: node.cause || { type: 'unknown' },
          depth,
          hasChildren: node.children.length > 0,
          children: node.children,
          severity,
          isHotspot: displayName(node.componentName) === hotspot,
          reasons: node.reasons,
        });

        if (node.children.length > 0) {
          walk(node.children, depth + 1);
        }
      }
    };

    walk(tree, treeBaseDepth);
    return rows;
  });

  // ── Interactions ──

  onSelect(row: TimelineRow): void {
    if (row.kind !== 'component') return;
    this.selectedNode.set(row.componentName || null);
    this.componentSelected.emit({
      componentName: row.componentName,
      displayName: row.displayName,
      count: row.count,
      totalDuration: row.totalDuration,
      cause: row.cause,
      children: row.children,
      reasons: row.reasons,
    });
  }

  onHover(row: TimelineRow): void {
    if (row.kind !== 'component') return;
    this.componentHovered.emit({
      componentName: row.componentName,
      displayName: row.displayName,
    });
  }

  onHoverLeave(): void {
    this.componentHovered.emit(null);
  }

  // ── Helpers ──

  getFlowIcon(type: string): string {
    switch (type) {
      case 'http-response': return '🌐';
      case 'signal-write': return '⚡';
      case 'subject-emit': return '📡';
      case 'store-dispatch': return '🗄';
      case 'store-select': return '📥';
      case 'facade-method': return '🏛️';
      case 'websocket': return '🔗';
      case 'route-change': return '🧭';
      default: return '•';
    }
  }

  getCauseBadgeText(cause: { type: string; source?: string } | undefined): string {
    if (!cause) return '• Unknown';
    switch (cause.type) {
      case 'signal': return '⚡Signal';
      case 'zone': return '⚠️Zone';
      case 'parent': return '⬆️Parent';
      case 'input': return '📥Input';
      case 'manual-cd': return '🔧Manual';
      default: return '• Unknown';
    }
  }

  getCountPillClass(count: number): string {
    if (count >= 5) return 'rtv-count-pill rtv-count--critical';
    if (count >= 2) return 'rtv-count-pill rtv-count--warning';
    return 'rtv-count-pill rtv-count--normal';
  }

  getDurationColorClass(ms: number): string {
    if (ms > 50) return 'rtv-duration rtv-dur--critical';
    if (ms > 16) return 'rtv-duration rtv-dur--warning';
    return 'rtv-duration rtv-dur--normal';
  }
}
