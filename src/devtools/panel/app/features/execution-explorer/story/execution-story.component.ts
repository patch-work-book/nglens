/**
 * ExecutionStoryComponent — the vertical execution PHASE trace.
 *
 * Renders a StoryPhaseModel as a debugger-style runtime trace grouped into
 * chronological phases (Trigger → Network → State → Signal → Component
 * activity …). It answers "what happened during this execution", not "here is a
 * flat list of component renders".
 *
 * Trust rules (all enforced upstream in the pure story-model / story-evidence):
 *   - Phases are grouped purely by chronological, same-category runs — grouping
 *     asserts no causality beyond ordering.
 *   - Evidence for a transition is shown ONCE at the phase boundary, never
 *     repeated under every row. DOM-derived edges read "Inferred from DOM".
 *   - Component render timing is a frame-split estimate; it is shown only as a
 *     phase aggregate (and omitted when sub-meaningful) — never as a fake
 *     per-component "~1ms". API timing is measured and shown per row.
 *   - Unknown transitions stay Unknown; no fabricated arrows.
 *
 * No cards, no emoji, no gradients — a professional debugging instrument.
 */
import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { StoryPhaseModel, StoryPhase, StoryNode, StoryCategory } from '../utils/story-model';

@Component({
  selector: 'app-execution-story',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (model(); as m) {
      @if (m.phases.length > 0) {
        <div class="es">
          @for (phase of m.phases; track phase.id; let first = $first) {

            <!-- Transition evidence between phases (shown ONCE, not per row) -->
            @if (!first && phase.upstream) {
              <div class="es-edge">
                <span class="es-edge__line"></span>
                <span class="es-edge__evidence"
                      [class]="'es-ev--' + phase.upstream.level"
                      [title]="phase.upstream.detail">{{ phase.upstream.label }}</span>
              </div>
            } @else if (!first) {
              <div class="es-edge"><span class="es-edge__line"></span></div>
            }

            <!-- Phase header -->
            <div class="es-phase" [class]="'es-cat--' + phase.category">
              <span class="es-phase__dot"></span>
              <span class="es-phase__label">{{ phaseLabel(phase.category) }}</span>
              <span class="es-phase__summary">{{ phaseSummary(phase) }}</span>
              @if (phase.aggregateMs != null) {
                <span class="es-phase__ms" [title]="phase.aggregateEstimated
                        ? 'Estimated. Sum of per-component frame-time estimates (frame time split across components in a change-detection cycle) — not measured per-component time.'
                        : 'Measured total request time for this phase.'">
                  {{ phase.aggregateEstimated ? '~' : '' }}{{ phase.aggregateMs }}ms{{ phase.aggregateEstimated ? ' est' : '' }}
                </span>
              }
            </div>

            <!-- Phase body -->
            <div class="es-body">
              @if (phase.category === 'component' && density() === 'coalesced') {
                <!-- Coalesced: per-component render-count rollup -->
                @for (r of phase.rollup; track r.name) {
                  <button class="es-row"
                          [class.es-row--selected]="selectedId() === r.node.id"
                          (click)="selectNode.emit(r.node)">
                    <span class="es-row__name" [title]="r.name">{{ r.name }}</span>
                    @if (r.count > 1) { <span class="es-row__count">{{ r.count }}×</span> }
                  </button>
                }
              } @else {
                <!-- Expanded (or non-component phase): individual nodes -->
                @for (node of phase.nodes; track node.id) {
                  <button class="es-row"
                          [class.es-row--selected]="selectedId() === node.id"
                          (click)="selectNode.emit(node)">
                    <span class="es-row__name" [title]="node.title">{{ node.title }}</span>
                    @if (node.count && node.count > 1) { <span class="es-row__count">{{ node.count }}×</span> }
                    @if (node.metric) { <span class="es-row__metric">{{ node.metric }}</span> }
                  </button>
                }
              }
            </div>
          }

          <div class="es-foot">
            Phases are ordered by time. Relationships are labelled by evidence; a transition with no observed link reads Unknown. Render timing is an estimate; API timing is measured.
          </div>
        </div>
      } @else {
        <div class="es-empty"><p>No ordered activity to replay for this execution.</p></div>
      }
    } @else {
      <div class="es-empty"><p>Select an execution to follow its story.</p></div>
    }
  `,
  styles: [`
    :host { display: block; }
    .es {
      display: flex; flex-direction: column;
      padding: 10px 14px 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 11px;
      color: var(--text-secondary);
    }

    /* ── Phase header ── */
    .es-phase {
      display: flex; align-items: baseline; gap: 8px;
      padding: 3px 0;
    }
    .es-phase__dot {
      width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; align-self: center;
      background: var(--text-muted);
    }
    .es-phase__label {
      flex-shrink: 0;
      font-size: 9px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase;
      color: var(--text-muted);
    }
    .es-phase__summary { flex: 1; min-width: 0; color: var(--text-muted); font-size: 10px; }
    .es-phase__ms { flex-shrink: 0; font-family: inherit; font-size: 9px; color: var(--text-muted); }

    /* Category accents (color = category, matching the swimlane palette) */
    .es-cat--user   .es-phase__dot, .es-cat--router .es-phase__dot { background: var(--color-api); }
    .es-cat--api    .es-phase__dot { background: var(--color-api); }
    .es-cat--state  .es-phase__dot { background: var(--color-store); }
    .es-cat--signal .es-phase__dot { background: var(--color-signal); }
    .es-cat--component .es-phase__dot { background: var(--color-render); }
    .es-cat--other  .es-phase__dot { background: var(--text-muted); }
    .es-cat--user .es-phase__label, .es-cat--router .es-phase__label { color: var(--color-api); }
    .es-cat--api .es-phase__label { color: var(--color-api); }
    .es-cat--state .es-phase__label { color: var(--color-store); }
    .es-cat--signal .es-phase__label { color: var(--color-signal); }
    .es-cat--component .es-phase__label { color: var(--color-render); }

    /* ── Phase body rows (indented under the phase) ── */
    .es-body { display: flex; flex-direction: column; padding-left: 17px; margin: 1px 0 4px; }
    .es-row {
      display: flex; align-items: baseline; gap: 8px;
      width: 100%; text-align: left;
      background: none; border: none; cursor: pointer;
      padding: 2px 6px; border-radius: 3px;
      color: inherit; font: inherit;
    }
    .es-row:hover { background: var(--color-gray-bg-lighter); }
    .es-row--selected { background: var(--color-blue-bg-lighter); }
    .es-row__name {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--text-primary);
    }
    .es-row__count { flex-shrink: 0; font-family: inherit; font-size: 9px; color: var(--text-muted); }
    .es-row__metric { flex-shrink: 0; font-family: inherit; font-size: 9px; color: var(--text-muted); }

    /* ── Connector + transition evidence between phases ── */
    .es-edge { display: flex; align-items: center; gap: 8px; padding: 1px 0; margin-left: 4px; }
    .es-edge__line { width: 2px; height: 12px; background: var(--border-primary); flex-shrink: 0; }
    .es-edge__evidence {
      font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
      padding: 0 4px; border-radius: 3px;
    }
    /* Distinct treatment per evidence level (spec §9). */
    .es-ev--observed   { color: var(--color-signal); background: rgba(var(--color-signal), 0.12); border: 1px solid var(--color-green-border); }
    .es-ev--correlated { color: var(--color-store); background: rgba(var(--color-store), 0.08); border: 1px solid var(--color-orange-border); }
    .es-ev--inferred   { color: var(--text-muted); background: transparent; border: 1px dashed rgba(var(--text-muted),0.5); }
    .es-ev--unknown    { color: var(--text-muted); background: transparent; border: none; font-style: italic; font-weight: 600; }

    .es-foot {
      margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border-primary);
      font-size: 9.5px; color: var(--text-muted); line-height: 1.5;
    }
    .es-empty {
      display: flex; align-items: center; justify-content: center;
      padding: 30px; text-align: center; color: var(--text-muted); font-size: 11px;
    }
  `],
})
export class ExecutionStoryComponent {
  model = input<StoryPhaseModel | null>(null);
  /** Currently selected node id (shared selection with the Timeline). */
  selectedId = input<string | null>(null);
  /** Coalesced = per-component rollup; Expanded = individual nodes. */
  density = input<'coalesced' | 'expanded'>('coalesced');
  selectNode = output<StoryNode>();

  phaseLabel(cat: StoryCategory): string {
    switch (cat) {
      case 'user': return 'Trigger';
      case 'router': return 'Router';
      case 'api': return 'Network';
      case 'state': return 'State';
      case 'signal': return 'Signal';
      case 'component': return 'Component activity';
      default: return 'Activity';
    }
  }

  /** Compact summary line for a phase header. */
  phaseSummary(phase: StoryPhase): string {
    if (phase.category === 'component') {
      const renders = `${phase.total} render${phase.total === 1 ? '' : 's'}`;
      const comps = `${phase.uniqueCount} component${phase.uniqueCount === 1 ? '' : 's'}`;
      return `${renders} · ${comps}`;
    }
    if (phase.category === 'api') {
      // Single call: show its name; multiple: count.
      return phase.total === 1 ? phase.nodes[0].title : `${phase.total} calls`;
    }
    // trigger/router/state/signal: show the single event's name, else a count.
    return phase.total === 1 ? phase.nodes[0].title : `${phase.total} events`;
  }
}
