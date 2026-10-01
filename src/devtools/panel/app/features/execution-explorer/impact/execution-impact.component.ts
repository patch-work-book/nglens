/**
 * ExecutionImpactComponent — the "What happened?" Impact Explorer view.
 *
 * Three panes (per the approved mock), all driven by pure models:
 *   LEFT   Execution Impact rail — counts (from StoryStats) + jump targets.
 *   CENTER Story spine — timestamped chronological events, "Nms to next" gaps,
 *          expandable phases, per-component rollup, terminal "Execution complete".
 *          + Impact Flow strip (category presence; reactive lanes honestly show
 *          "No activity observed"; NO fabricated arrows).
 *   RIGHT  Event Details inspector — selected node's detail rows + related
 *          activity grouped by REAL evidence level (Observed only for a genuine
 *          captured edge), plus actions (Inspect in Components, Copy URL, …).
 *
 * Trust rules live in the pure utils (story-model / story-evidence / event-detail).
 * This component only presents them. No cards, gradients, emoji, or AI copy.
 */
import { Component, input, output, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { StoryPhaseModel, StoryPhase, StoryNode, StoryCategory, StoryStats } from '../utils/story-model';
// StoryCategory is used in template-helper signatures below.
import type { EventDetail } from '../utils/event-detail';
import type { ExecutionImpact, ImpactNode } from '../utils/execution-impact-model';

type JumpTarget = 'first-api' | 'largest-render' | 'duplicates' | 'slowest' | 'last';

@Component({
  selector: 'app-execution-impact',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ei">
      <!-- ─── LEFT RAIL ─── -->
      <aside class="ei-rail">
        <div class="ei-rail__title">Execution Impact</div>
        @if (stats(); as s) {
          <nav class="ei-rail__nav">
            <div class="ei-railitem ei-railitem--active">
              <span class="ei-railitem__label">What happened?</span>
              <span class="ei-railitem__sub">Full execution story</span>
            </div>
            <div class="ei-railitem">
              <span class="ei-railitem__label">Network activity</span>
              <span class="ei-railitem__sub">{{ s.apiCalls }} API call{{ s.apiCalls === 1 ? '' : 's' }}</span>
            </div>
            <div class="ei-railitem">
              <span class="ei-railitem__label">Reactive activity</span>
              <span class="ei-railitem__sub">{{ s.stateUpdates }} state · {{ s.signals }} signals · {{ s.rxjs }} rxjs</span>
            </div>
            <div class="ei-railitem">
              <span class="ei-railitem__label">Render impact</span>
              <span class="ei-railitem__sub">{{ s.renders }} renders · {{ s.components }} components</span>
            </div>
            <div class="ei-railitem" [class.ei-railitem--warn]="s.duplicates > 0 || s.slow > 0">
              <span class="ei-railitem__label">Issues</span>
              <span class="ei-railitem__sub">{{ s.duplicates }} duplicate{{ s.duplicates === 1 ? '' : 's' }} · {{ s.slow }} slow</span>
            </div>
          </nav>

          <div class="ei-rail__jumps">
            <div class="ei-rail__jumpstitle">Jumps</div>
            <button class="ei-jump" (click)="jump.emit('first-api')">First API call</button>
            <button class="ei-jump" (click)="jump.emit('largest-render')">Largest render group</button>
            @if (s.duplicates > 0) { <button class="ei-jump" (click)="jump.emit('duplicates')">Duplicate requests</button> }
            <button class="ei-jump" (click)="jump.emit('slowest')">Slowest operation</button>
            <button class="ei-jump" (click)="jump.emit('last')">Last activity</button>
          </div>
        }
      </aside>

      <!-- ─── CENTER: IMPACT CENTERPIECE + STORY SPINE ─── -->
      <section class="ei-main">
        @if (model(); as m) {
          @if (m.phases.length > 0) {

            <!-- EXECUTION IMPACT — a FINGERPRINT of independent observed facets.
                 Deliberately NOT a top→bottom flow: these are things observed
                 during the execution, side by side, so no reading implies one
                 caused another. The causal sequence (with evidence labels) lives
                 in the Story spine below. -->
            @if (impact(); as imp) {
              <div class="ei-impact">
                <div class="ei-impact__title">Execution impact</div>
                <div class="ei-fingerprint">
                  @for (facet of facets(imp); track $index) {
                    <button class="ei-facet" [class]="'ei-cat--' + facet.kind" [class.ei-facet--warn]="facet.warn"
                            [class.is-dimmed]="isDimmed(facet.targetId)"
                            [disabled]="!facet.targetId"
                            (click)="facet.targetId && selectById.emit(facet.targetId)">
                      <span class="ei-facet__value">{{ facet.value }}</span>
                      <span class="ei-facet__label">{{ facet.label }}</span>
                    </button>
                  }
                </div>
                <div class="ei-impact__note">Observed during this execution. Relationships are shown only where evidence exists.</div>
              </div>
            }

            <!-- Focus banner (evidence-only) -->
            @if (focusActive()) {
              <div class="ei-focusbar">
                @if (focusHasRelationship()) {
                  <span class="ei-focusbar__msg">Focused on the selected event's observed chain. Unrelated activity is dimmed.</span>
                } @else {
                  <span class="ei-focusbar__msg ei-focusbar__msg--muted">No causal relationship observed for the selected event.</span>
                }
                <button class="ei-focusbar__clear" (click)="clearFocus.emit()">Clear focus</button>
              </div>
            }

            <div class="ei-storyhead">
              <span class="ei-storyhead__title">Execution story</span>
              <span class="ei-storyhead__sub">A step-by-step view of what happened in this execution.</span>
            </div>

            <div class="ei-spine">
              @for (phase of m.phases; track phase.id; let first = $first) {
                @if (!first && phase.upstream) {
                  <div class="ei-edge">
                    <span class="ei-edge__line"></span>
                    <span class="ei-edge__ev" [class]="'ei-ev--' + phase.upstream.level" [title]="phase.upstream.detail">{{ phase.upstream.label }}</span>
                  </div>
                } @else if (!first) {
                  <div class="ei-edge"><span class="ei-edge__line"></span></div>
                }

                <div class="ei-event" [class.ei-event--selected]="isPhaseSelected(phase)" [class.is-dimmed]="isPhaseDimmed(phase)">
                  <div class="ei-event__time">{{ fmtTime(phase.nodes[0].timestamp) }}</div>
                  <div class="ei-event__dot" [class]="'ei-cat--' + phase.category"></div>
                  <div class="ei-event__body">
                    <div class="ei-event__head">
                      <span class="ei-event__cat" [class]="'ei-cat--' + phase.category">{{ phaseLabel(phase.category) }}</span>
                      @if (phaseGap(phase); as g) { <span class="ei-event__gap">{{ g }}</span> }
                      @if (phase.category === 'component' && phase.rollup.length > 1) {
                        <button class="ei-event__expand" (click)="toggle(phase.id)">{{ isExpanded(phase.id) ? '▾' : '▸' }}</button>
                      }
                    </div>

                    @if (phase.category === 'component') {
                      <div class="ei-event__title">{{ phase.total }} component render{{ phase.total === 1 ? '' : 's' }}</div>
                      <div class="ei-event__meta">
                        {{ phase.uniqueCount }} component{{ phase.uniqueCount === 1 ? '' : 's' }}
                        @if (phase.aggregateMs != null) { · ~{{ phase.aggregateMs }}ms est }
                        @if (largestGroup(phase); as lg) { · largest: {{ lg }} }
                      </div>
                      @if (isExpanded(phase.id)) {
                        <div class="ei-rollup">
                          @for (r of phase.rollup; track r.name) {
                            <button class="ei-rollup__row" [class.ei-rollup__row--selected]="selectedId() === r.node.id" (click)="select.emit(r.node)">
                              <span class="ei-rollup__name" [title]="r.name">{{ r.name }}</span>
                              @if (r.count > 1) { <span class="ei-rollup__count">{{ r.count }}×</span> }
                            </button>
                          }
                        </div>
                      }
                    } @else {
                      @for (node of phase.nodes; track node.id) {
                        <button class="ei-event__row" [class.ei-event__row--selected]="selectedId() === node.id" (click)="select.emit(node)">
                          <span class="ei-event__name" [title]="node.title">{{ node.title }}</span>
                          @if (node.metric) { <span class="ei-event__metric">{{ node.metric }}</span> }
                          @if (isSlowApi(node)) { <span class="ei-badge ei-badge--warn">SLOW</span> }
                        </button>
                      }
                    }
                  </div>
                </div>
              }

              <!-- Terminal: execution complete -->
              @if (stats(); as s) {
                <div class="ei-edge"><span class="ei-edge__line"></span></div>
                <div class="ei-event ei-event--complete">
                  <div class="ei-event__time">{{ fmtTime(lastTimestamp()) }}</div>
                  <div class="ei-event__dot ei-cat--complete"></div>
                  <div class="ei-event__body">
                    <span class="ei-event__cat ei-cat--complete">Execution complete</span>
                    <div class="ei-event__meta">{{ fmtSpan(s.spanMs) }} total span · {{ s.apiCalls }} APIs · {{ s.renders }} renders · {{ s.stateUpdates }} state · {{ s.signals }} signals</div>
                  </div>
                </div>
              }
            </div>

          } @else {
            <div class="ei-empty"><p>No ordered activity to replay for this execution.</p></div>
          }
        } @else {
          <div class="ei-empty"><p>Select an execution to follow its story.</p></div>
        }
      </section>

      <!-- ─── RIGHT: EVENT DETAILS ─── -->
      <aside class="ei-inspect">
        <div class="ei-inspect__title">Event details</div>
        @if (detail(); as d) {
          <div class="ei-inspect__head">
            <span class="ei-inspect__cat" [class]="'ei-cat--' + d.category">{{ inspectCat(d.category) }}</span>
            <span class="ei-inspect__name" [title]="d.title">{{ d.title }}</span>
          </div>

          <div class="ei-inspect__rows">
            @for (row of d.rows; track row.label) {
              <div class="ei-kv">
                <span class="ei-kv__k">{{ row.label }}</span>
                <span class="ei-kv__v" [class.ei-kv__v--ev]="!!row.evidence" [class]="row.evidence ? 'ei-ev--' + row.evidence : ''">{{ row.value }}</span>
              </div>
            }
          </div>

          @for (group of d.related; track group.heading) {
            <div class="ei-inspect__section">
              <div class="ei-inspect__sectitle" [class]="'ei-ev--' + group.level">{{ group.heading }}</div>
              @for (item of group.items; track item.id) {
                <div class="ei-related">
                  <span class="ei-related__label" [title]="item.label">{{ item.label }}</span>
                  @if (item.detail) { <span class="ei-related__detail">{{ item.detail }}</span> }
                </div>
              }
            </div>
          }

          <div class="ei-inspect__actions">
            @if (d.isComponent) { <button class="ei-action" (click)="inspectComponent.emit(d.title)">Inspect in Components →</button> }
            <button class="ei-action" (click)="focusChain.emit()">Focus chain</button>
            @if (d.isApi && d.requestLabel) { <button class="ei-action" (click)="copyUrl(d.requestLabel!)">Copy request URL</button> }
          </div>
        } @else {
          <div class="ei-inspect__empty"><p>Select an event to see its details, evidence, and related activity.</p></div>
        }
      </aside>
    </div>
  `,
  styleUrl: './execution-impact.component.scss',
})
export class ExecutionImpactComponent {
  model = input<StoryPhaseModel | null>(null);
  impact = input<ExecutionImpact | null>(null);
  stats = input<StoryStats | null>(null);
  detail = input<EventDetail | null>(null);
  selectedId = input<string | null>(null);
  /** Story-node ids in the focused chain (empty when focus is off). */
  focusedIds = input<Set<string>>(new Set<string>());
  focusActive = input<boolean>(false);
  focusHasRelationship = input<boolean>(false);

  select = output<StoryNode>();
  selectById = output<string>();
  jump = output<JumpTarget>();
  inspectComponent = output<string>();
  focusChain = output<void>();
  clearFocus = output<void>();

  /** A node is dimmed when focus is active and the node is not in the chain. */
  isDimmed(nodeId: string | null): boolean {
    if (!this.focusActive() || !nodeId) return false;
    return !this.focusedIds().has(nodeId);
  }
  /** A phase is dimmed only when ALL its nodes are outside the focus chain. */
  isPhaseDimmed(phase: StoryPhase): boolean {
    if (!this.focusActive()) return false;
    return !phase.nodes.some(n => this.focusedIds().has(n.id));
  }

  fmtSpanShort(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  }
  impactNodeLabel(kind: ImpactNode['kind']): string {
    switch (kind) {
      case 'trigger': return 'Trigger';
      case 'api': return 'API activity';
      case 'duplicate': return 'Duplicate calls';
      case 'slow': return 'Slow request';
      case 'render': return 'Render impact';
      default: return 'Impact';
    }
  }

  /**
   * Flatten the impact model into independent "fingerprint" facets — unordered,
   * side-by-side observed facts. Each maps to a Story node for click-through.
   * The order here is presentational only and asserts NO causality (that lives
   * in the Story spine with evidence labels).
   */
  facets(imp: ExecutionImpact): Array<{ kind: string; value: string; label: string; warn: boolean; targetId: string | null }> {
    const fp = imp.footprint;
    // Resolve representative click targets from the impact tree nodes.
    const spineNodes = imp.spine;
    const findTarget = (kind: ImpactNode['kind']): string | null => {
      for (const n of spineNodes) {
        if (n.kind === kind) return n.targetId;
        const b = n.branches.find(x => x.kind === kind);
        if (b) return b.targetId;
      }
      return null;
    };
    const out: Array<{ kind: string; value: string; label: string; warn: boolean; targetId: string | null }> = [];
    if (fp.apis > 0) out.push({ kind: 'api', value: String(fp.apis), label: fp.apis === 1 ? 'network call' : 'network calls', warn: false, targetId: findTarget('api') });
    // "Render impact" (session consequence) — deliberately NOT just "renders",
    // to keep it distinct from the Components tab where a render is the event
    // being diagnosed. Here it is activity observed during the execution.
    if (fp.renders > 0) out.push({ kind: 'render', value: String(fp.renders), label: 'render impact', warn: false, targetId: findTarget('render') });
    if (fp.components > 0) out.push({ kind: 'render', value: String(fp.components), label: fp.components === 1 ? 'component affected' : 'components affected', warn: false, targetId: findTarget('render') });
    if (fp.duplicates > 0) out.push({ kind: 'duplicate', value: String(fp.duplicates), label: fp.duplicates === 1 ? 'duplicate call' : 'duplicate calls', warn: true, targetId: findTarget('duplicate') });
    if (fp.slow > 0) out.push({ kind: 'slow', value: String(fp.slow), label: fp.slow === 1 ? 'slow operation' : 'slow operations', warn: true, targetId: findTarget('slow') });
    out.push({ kind: 'span', value: this.fmtSpanShort(fp.spanMs), label: 'span', warn: false, targetId: null });
    return out;
  }

  private readonly expanded = signal<Set<string>>(new Set());

  isExpanded(id: string): boolean { return this.expanded().has(id); }
  toggle(id: string): void {
    const next = new Set(this.expanded());
    next.has(id) ? next.delete(id) : next.add(id);
    this.expanded.set(next);
  }

  isPhaseSelected(phase: StoryPhase): boolean {
    const id = this.selectedId();
    return !!id && phase.nodes.some(n => n.id === id);
  }

  isSlowApi(node: StoryNode): boolean {
    return node.category === 'api' && node.measuredMs != null && node.measuredMs > 300;
  }

  phaseGap(phase: StoryPhase): string | null {
    const last = phase.nodes[phase.nodes.length - 1];
    const g = last?.gapToNextMs;
    if (g == null || g <= 0) return null;
    return g >= 1000 ? `${(g / 1000).toFixed(1)}s to next` : `${Math.round(g)}ms to next`;
  }

  largestGroup(phase: StoryPhase): string | null {
    if (phase.rollup.length === 0) return null;
    const top = phase.rollup[0];
    return top.count > 1 ? `${top.name} ${top.count}×` : null;
  }

  readonly lastTimestamp = computed((): number => {
    const m = this.model();
    if (!m || m.phases.length === 0) return 0;
    const lastPhase = m.phases[m.phases.length - 1];
    const lastNode = lastPhase.nodes[lastPhase.nodes.length - 1];
    return lastNode?.timestamp ?? 0;
  });

  copyUrl(label: string): void {
    try { navigator.clipboard?.writeText(label); } catch { /* ignore */ }
  }

  fmtTime(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  }

  fmtSpan(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  }

  phaseLabel(cat: StoryCategory): string {
    switch (cat) {
      case 'user': return 'User interaction';
      case 'router': return 'Router navigation';
      case 'api': return 'API request';
      case 'state': return 'State update';
      case 'signal': return 'Signal change';
      case 'component': return 'Component activity';
      default: return 'Activity';
    }
  }
  inspectCat(cat: StoryCategory): string {
    switch (cat) {
      case 'api': return 'API REQUEST';
      case 'component': return 'COMPONENT';
      case 'user': return 'USER INTERACTION';
      case 'router': return 'ROUTER';
      case 'state': return 'STATE';
      case 'signal': return 'SIGNAL';
      default: return 'EVENT';
    }
  }
}
