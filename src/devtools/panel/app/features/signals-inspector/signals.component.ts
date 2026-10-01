import { Component, ChangeDetectionStrategy, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PanelState } from '../../state/panel.state';
import { DevtoolsPortService } from '../../services/devtools-port.service';

@Component({
  selector: 'app-signals-inspector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sig-container">
      <!-- Header -->
      <div class="sig-header">
        <div>
          <h2 class="sig-header__title">Signal Dependency Graph</h2>
          <p class="sig-header__tagline">Visualize reactive chains and detect glitches in real-time.</p>
        </div>
        <div class="sig-header__actions">
          <button (click)="refreshGraph()" class="sig-btn sig-btn--primary">
            Refresh Graph
          </button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="sig-main">
        <!-- Sidebar: Signal List -->
        <div class="sig-sidebar">
          <div class="sig-sidebar__label">Active Signals</div>
          @for (s of signalsList(); track s.id) {
            <div (click)="selectedSignal.set(s.id)"
              [class.sig-signal--selected]="selectedSignal() === s.id"
              class="sig-signal">
              <div class="sig-signal__content">
                <span class="sig-signal__dot" 
                  [class.sig-signal__dot--computed]="s.type === 'computed'"
                  [class.sig-signal__dot--signal]="s.type === 'signal'"></span>
                <span class="sig-signal__label">{{ s.label }}</span>
              </div>
              <div class="sig-signal__owner">{{ s.ownerComponent }}</div>
            </div>
          }
        </div>

        <!-- Graph Visualization Area -->
        <div class="sig-graph">
          <div class="sig-graph__content">
            @if (!selectedSignal()) {
              <div class="sig-empty">
                <span class="sig-empty__icon">⚡</span>
                <span>Select a signal to explore its dependency graph</span>
              </div>
            } @else {
              <div class="sig-viz">
                <!-- Producers -->
                @if (currentSignal()?.producers?.length) {
                  <div class="sig-viz__section">
                    @for (pId of currentSignal()?.producers; track pId) {
                      <div class="sig-node sig-node--producer">
                        <div class="sig-node__type">Producer</div>
                        <div class="sig-node__label" [title]="pId">{{ pId }}</div>
                      </div>
                    }
                  </div>
                  <div class="sig-connector"></div>
                }
                
                <!-- The Node -->
                <div class="sig-node sig-node--current">
                  <div class="sig-node__type">{{ currentSignal()?.type }}</div>
                  <div class="sig-node__label">{{ currentSignal()?.label }}</div>
                  <div class="sig-node__value">{{ currentSignal()?.value }}</div>
                </div>

                <!-- Consumers -->
                @if (currentSignal()?.consumers?.length) {
                  <div class="sig-connector"></div>
                  <div class="sig-viz__section">
                    @for (cId of currentSignal()?.consumers; track cId) {
                      <div class="sig-node sig-node--consumer">
                        <div class="sig-node__type">Consumer</div>
                        <div class="sig-node__label" [title]="cId">{{ cId }}</div>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>

          <!-- Glitch Warning Badge -->
          @if (detectedGlitches().length > 0) {
            <div class="sig-warning">
              ⚠️ {{ detectedGlitches().length }} Glitches Detected
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .sig-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    .sig-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 16px;
      border-bottom: 1px solid var(--border-primary);
      gap: 16px;
    }
    .sig-header__title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .sig-header__tagline {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--text-muted);
    }
    .sig-header__actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .sig-btn {
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 4px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.2s;
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    .sig-btn--primary {
      background: var(--color-info);
      color: var(--text-primary);
      border-color: var(--color-info);
    }
    .sig-btn--primary:hover {
      opacity: 0.9;
    }

    .sig-main {
      display: flex;
      flex: 1;
      min-height: 0;
      gap: 0;
    }

    .sig-sidebar {
      width: 240px;
      border-right: 1px solid var(--border-primary);
      overflow-y: auto;
      padding: 8px;
      background: var(--bg-secondary);
      flex-shrink: 0;
    }
    .sig-sidebar__label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin-bottom: 8px;
      padding: 0 8px;
    }

    .sig-signal {
      padding: 8px;
      margin-bottom: 4px;
      border-radius: 4px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.15s;
    }
    .sig-signal:hover {
      border-color: var(--border-secondary);
    }
    .sig-signal--selected {
      background: rgba(var(--color-info), 0.12);
      border-color: rgba(var(--color-info), 0.3);
    }
    .sig-signal__content {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .sig-signal__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .sig-signal__dot--signal { background: var(--color-info); }
    .sig-signal__dot--computed { background: var(--color-render); }
    .sig-signal__label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sig-signal__owner {
      font-size: 10px;
      color: var(--text-muted);
      margin-left: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sig-graph {
      flex: 1;
      position: relative;
      background: rgba(var(--bg-tertiary), 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
    }
    .sig-graph__content {
      width: 100%;
      height: 100%;
      padding: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .sig-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 12px;
    }
    .sig-empty__icon {
      font-size: 32px;
    }

    .sig-viz {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 32px;
      max-width: 100%;
    }

    .sig-viz__section {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 16px;
      width: 100%;
    }

    .sig-connector {
      width: 1px;
      height: 32px;
      background: var(--border-primary);
      position: relative;
    }
    .sig-connector::after {
      content: '';
      position: absolute;
      bottom: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 6px solid var(--border-primary);
    }

    .sig-node {
      padding: 12px 16px;
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      text-align: center;
      min-width: 120px;
      max-width: 150px;
    }
    .sig-node__type {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .sig-node__label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      word-break: break-word;
      margin-bottom: 4px;
    }
    .sig-node__value {
      font-size: 10px;
      color: var(--text-secondary);
      font-family: inherit;
      background: var(--bg-secondary);
      border-radius: 3px;
      padding: 4px;
    }
    .sig-node--current {
      background: rgba(var(--color-info), 0.12);
      border-color: rgba(var(--color-info), 0.3);
      min-width: 160px;
    }
    .sig-node--current .sig-node__type {
      color: var(--color-info);
    }
    .sig-node--current .sig-node__label {
      font-size: 14px;
      font-weight: 700;
    }
    .sig-node--producer,
    .sig-node--consumer {
      background: var(--bg-tertiary);
    }

    .sig-warning {
      position: absolute;
      top: 16px;
      right: 16px;
      background: rgba(var(--color-critical), 0.15);
      border: 1px solid rgba(var(--color-critical), 0.3);
      color: var(--color-red-light);
      padding: 8px 12px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 700;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SignalsInspectorComponent {
  private readonly state = inject(PanelState);
  private readonly portService = inject(DevtoolsPortService);

  signalsList = signal<any[]>([]);
  selectedSignal = signal<string | null>(null);
  detectedGlitches = signal<any[]>([]);

  currentSignal = computed(() => {
    const id = this.selectedSignal();
    return this.signalsList().find(s => s.id === id);
  });

  constructor() {
    effect(() => {
      const results = this.state.lastScanResults();
      if (results) {
        const signalResult = results.results.find((r: any) => r.analyzer === 'signals-analyzer');
        if (signalResult?.metadata?.['signalGraph']) {
          const graph = signalResult.metadata['signalGraph'] as any;
          const nodes = Object.values(graph.nodes);
          this.signalsList.set(nodes);
          this.detectedGlitches.set(graph.glitches || []);
        }
      }
    });
  }

  refreshGraph(): void {
    this.portService.send({
      type: 'SCAN_REQUEST',
      payload: { analyzers: ['signals-analyzer'] },
      timestamp: Date.now()
    });
  }
}
