/**
 * RenderFlowComponent
 *
 * Visualizes the causality around a single component as a three-column graph:
 *
 *   TRIGGER            COMPONENT             TRIGGERED
 *   ┌───────────┐      ┌────────────┐       ┌───────────┐
 *   │ Signal ⚡ │──▶  │  Selected   │  ──▶  │ ChildA 8× │
 *   │ API 🌐    │──▶  │  Comp 52×   │  ──▶  │ ChildB 4× │
 *   └───────────┘      └────────────┘       └───────────┘
 *
 * All counts are REAL (observed render counts). ms values are estimates and are
 * shown with a leading ~ and an "estimated" tooltip. Trigger cards carry an
 * honest confidence label (Observed / Inferred / Unattributed).
 */
import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface RenderFlowTrigger {
  icon: string;
  label: string;
  type: string;
  confidence: string;
  confidenceLabel: string;
}

export interface RenderFlowTriggered {
  name: string;
  rawName: string;
  count: number;
  totalDuration: number;
  severity: string;
  node: any;
}

export interface RenderFlowModel {
  triggers: RenderFlowTrigger[];
  component: { name: string; rawName: string; count: number; totalDuration: number };
  triggered: RenderFlowTriggered[];
  childrenTotal: number;
}

@Component({
  selector: 'app-render-flow',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (model(); as m) {
      <div class="rf">
        <h3 class="rf__title">Why did {{ m.component.name }} render?</h3>

        <div class="rf__tree">
          <!-- Trigger(s) -->
          @if (m.triggers.length > 0) {
            @for (t of m.triggers; track $index) {
              <div class="rf__row rf__row--trigger">
                <span class="rf__glyph">▪</span>
                <span class="rf__name">{{ t.label }}</span>
                <span class="rf__conf" [class]="'rf-conf--' + t.confidence">{{ t.confidenceLabel }}</span>
              </div>
            }
          } @else {
            <div class="rf__row rf__row--muted"><span class="rf__glyph">·</span><span class="rf__name">No observed trigger</span></div>
          }

          <!-- Connector down to the component -->
          <div class="rf__pipe">│</div>

          <!-- The component itself -->
          <div class="rf__row rf__row--self">
            <span class="rf__glyph">▸</span>
            <span class="rf__name">{{ m.component.name }}</span>
            <span class="rf__meta">{{ m.component.count }}× · <span [title]="'Estimated: frame time split across components'">~{{ m.component.totalDuration | number:'1.0-0' }}ms</span></span>
          </div>

          <!-- Children rendered (indented under the component) -->
          @if (m.triggered.length > 0) {
            @for (c of m.triggered; track c.rawName; let last = $last) {
              <button class="rf__row rf__row--child" (click)="selectComponent.emit(c)">
                <span class="rf__branch">{{ last && m.childrenTotal <= m.triggered.length ? '└' : '├' }}</span>
                <span class="rf__name" [class.rf__name--hot]="c.severity === 'high'">{{ c.name }}</span>
                <span class="rf__meta">{{ c.count }}× · <span [title]="'Estimated: frame time split across components in this cycle'">~{{ c.totalDuration | number:'1.0-0' }}ms</span></span>
              </button>
            }
            @if (m.childrenTotal > m.triggered.length) {
              <div class="rf__row rf__row--more"><span class="rf__branch">└</span><span class="rf__name ri-muted">+{{ m.childrenTotal - m.triggered.length }} more</span></div>
            }
          } @else {
            <div class="rf__row rf__row--child rf__row--muted"><span class="rf__branch">└</span><span class="rf__name">No child renders</span></div>
          }
        </div>

        <p class="rf__foot">Children rendered in the same change-detection cycle. Co-occurrence is observed; a direct causal edge is not proven.</p>
      </div>
    } @else {
      <div class="rf__placeholder">
        <p>Select a component to see why it rendered and what it triggered.</p>
      </div>
    }
  `,
  styles: [`
    .rf {
      display: flex; flex-direction: column; height: 100%;
      padding: 12px 14px; overflow: auto;
      font-size: 12px; color: var(--ri-text-primary);
    }
    .rf__title { margin: 0 0 12px; font-size: 12px; font-weight: 600; color: var(--ri-text-bright); }

    .rf__tree { display: flex; flex-direction: column; }

    .rf__row {
      display: flex; align-items: baseline; gap: 8px;
      padding: 3px 4px; border: none; background: none; text-align: left; width: 100%;
      color: inherit; font: inherit;
    }
    .rf__glyph { width: 14px; flex-shrink: 0; color: var(--ri-text-muted); }
    .rf__branch { width: 14px; flex-shrink: 0; color: var(--ri-border); padding-left: 14px; }
    .rf__name { flex: 1; min-width: 0; color: var(--ri-text-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rf__name--hot { color: var(--ri-accent-amber); }
    .rf__meta { flex-shrink: 0; color: var(--ri-text-muted); font-size: 11px; }
    .rf__conf { flex-shrink: 0; font-size: 10px; }

    .rf__row--self .rf__name { font-weight: 700; }
    .rf__row--self { background: color-mix(in srgb, var(--ri-blue) 6%, transparent); border-radius: 3px; }

    .rf__row--child { cursor: pointer; border-radius: 3px; }
    .rf__row--child:hover { background: color-mix(in srgb, var(--ri-text-muted) 8%, transparent); }

    .rf__row--muted .rf__name { color: var(--ri-text-muted); font-style: italic; }
    .rf__row--more .rf__name { font-size: 11px; }

    .rf__pipe { color: var(--ri-border); padding-left: 6px; line-height: 1.1; }

    /* Confidence shown as quiet text, not colored pills */
    .rf-conf--direct   { color: var(--ri-accent-green); }
    .rf-conf--inferred { color: var(--ri-accent-amber); }
    .rf-conf--uncertain{ color: var(--ri-text-muted); }
    .ri-muted { color: var(--ri-text-muted); }

    .rf__foot { margin: 14px 0 0; padding-top: 10px; border-top: 1px solid var(--ri-border); font-size: 10.5px; color: var(--ri-text-muted); line-height: 1.5; }

    .rf__placeholder {
      height: 100%; display: flex; align-items: center; justify-content: center;
      text-align: center; color: var(--ri-text-muted); font-size: 12px; padding: 30px;
    }
  `],
})
export class RenderFlowComponent {
  model = input<RenderFlowModel | null>(null);
  selectComponent = output<RenderFlowTriggered>();
}
