/**
 * Focus Mode Component
 * 
 * When a component is selected, shows only information relevant to that component:
 * - Execution path (how/why it rendered)
 * - Affected stores and signals
 * - Child components impacted
 * - Optimization suggestions
 */
import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ExecutionStep {
  time: number;
  description: string;
  type: 'api' | 'store' | 'signal' | 'lifecycle' | 'render' | 'detection';
  icon: string;
  detail?: string;
}

export interface StateReference {
  name: string;
  type: 'store' | 'signal';
  changed: boolean;
  value?: string;
}

export interface FocusData {
  componentName: string;
  executionPath: ExecutionStep[];
  affectedStores: StateReference[];
  affectedSignals: StateReference[];
  childComponents: string[];
  totalDuration: number;
  renderCount: number;
}

@Component({
  selector: 'app-focus-mode',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="focus-mode-container">
      <!-- Header with back button -->
      <div class="focus-header">
        <button class="back-button" (click)="onBack()" title="Exit focus mode">
          ← Back
        </button>
        <h2 class="focus-title">{{ data().componentName }}</h2>
        <div class="focus-metrics">
          <span>⏱ {{ data().totalDuration.toFixed(0) }}ms</span>
          <span>{{ data().renderCount }}x renders</span>
        </div>
      </div>

      <!-- Main content sections -->
      <div class="focus-content">
        <!-- Execution Path -->
        <section class="focus-section">
          <h3 class="section-title">Execution Path</h3>
          <p class="section-description">How and why this component rendered</p>
          <div class="execution-timeline">
            @for (step of data().executionPath; track step.time) {
              <div class="timeline-item">
                <div class="timeline-marker" [class]="'marker-' + step.type">
                  {{ step.icon }}
                </div>
                <div class="timeline-content">
                  <div class="timeline-time">[{{ step.time }}ms]</div>
                  <div class="timeline-description">{{ step.description }}</div>
                  @if (step.detail) {
                    <div class="timeline-detail">{{ step.detail }}</div>
                  }
                </div>
              </div>
            }
          </div>
        </section>

        <!-- Affected State -->
        @if ((data().affectedStores.length + data().affectedSignals.length) > 0) {
          <section class="focus-section">
            <h3 class="section-title">Affected State</h3>
            <div class="state-groups">
              <!-- Stores -->
              @if (data().affectedStores.length > 0) {
                <div class="state-group">
                  <h4 class="state-label">Stores</h4>
                  <div class="state-list">
                    @for (store of data().affectedStores; track store.name) {
                      <div class="state-item" [class.state-changed]="store.changed">
                        <span class="state-name">• {{ store.name }}</span>
                        @if (store.changed) {
                          <span class="state-badge changed">changed</span>
                        }
                        @if (!store.changed) {
                          <span class="state-badge readonly">read</span>
                        }
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- Signals -->
              @if (data().affectedSignals.length > 0) {
                <div class="state-group">
                  <h4 class="state-label">Signals</h4>
                  <div class="state-list">
                    @for (signal of data().affectedSignals; track signal.name) {
                      <div class="state-item" [class.state-changed]="signal.changed">
                        <span class="state-name">• {{ signal.name }}</span>
                        @if (signal.changed) {
                          <span class="state-badge changed">changed</span>
                        }
                        @if (!signal.changed) {
                          <span class="state-badge readonly">read</span>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          </section>
        }

        <!-- Child Components -->
        @if (data().childComponents.length > 0) {
          <section class="focus-section">
            <h3 class="section-title">Child Components Impacted</h3>
            <p class="section-description">{{ data().childComponents.length }} child components affected</p>
            <div class="child-components">
              @for (child of data().childComponents; track child) {
                <div class="child-item">
                  ↳ {{ child }}
                </div>
              }
            </div>
          </section>
        }

        <!-- Optimization Suggestions -->
        <section class="focus-section">
          <h3 class="section-title">Optimization Tips</h3>
          <div class="optimization-tips">
            @if (data().renderCount > 3) {
              <div class="tip tip-warning">
                <span class="tip-icon">⚠</span>
                <span class="tip-text">Component renders {{ data().renderCount }} times. Consider using trackBy or OnPush strategy.</span>
              </div>
            }
            @if (data().totalDuration > 500) {
              <div class="tip tip-error">
                <span class="tip-icon">●</span>
                <span class="tip-text">Rendering takes {{ data().totalDuration.toFixed(0) }}ms. Optimize change detection or split component.</span>
              </div>
            }
            @if (data().childComponents.length > 10) {
              <div class="tip tip-info">
                <span class="tip-icon">ℹ</span>
                <span class="tip-text">{{ data().childComponents.length }} child components may benefit from lazy loading.</span>
              </div>
            }
          </div>
        </section>
      </div>

      <!-- Footer actions -->
      <div class="focus-footer">
        <button class="action-button button-secondary" (click)="onCopy()">
          Copy Execution Path
        </button>
        <button class="action-button button-secondary" (click)="onExport()">
          Export as JSON
        </button>
      </div>
    </div>
  `,
  styles: [`
    .focus-mode-container {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-generous);
      padding: var(--spacing-generous);
    }

    .focus-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-standard);
      padding-bottom: var(--spacing-standard);
      border-bottom: 1px solid var(--color-border-default);
    }

    .back-button {
      padding: 6px 12px;
      background-color: var(--color-bg-secondary);
      border: 1px solid var(--color-border-default);
      border-radius: var(--border-radius-small);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
      white-space: nowrap;
    }

    .back-button:hover {
      background-color: var(--color-bg-tertiary);
      color: var(--color-text-primary);
    }

    .focus-title {
      margin: 0;
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      flex: 1;
    }

    .focus-metrics {
      display: flex;
      gap: var(--spacing-compact);
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .focus-content {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-generous);
    }

    .focus-section {
      border-radius: var(--border-radius-medium);
      border: 1px solid var(--color-border-default);
      background-color: var(--color-bg-secondary);
      padding: var(--spacing-standard);
    }

    .section-title {
      margin: 0 0 4px 0;
      font-size: var(--font-size-md);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
    }

    .section-description {
      margin: 0 0 var(--spacing-compact) 0;
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .execution-timeline {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-compact);
      padding: var(--spacing-compact) 0;
    }

    .timeline-item {
      display: flex;
      gap: var(--spacing-compact);
      padding: 8px var(--spacing-compact);
      border-radius: var(--border-radius-small);
      background-color: var(--color-bg-primary);
    }

    .timeline-marker {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--border-radius-small);
      font-size: 14px;
    }

    .marker-api {
      background-color: var(--color-blue-bg-stronger);
      color: var(--color-info);
    }

    .marker-store {
      background-color: var(--color-yellow-bg-medium);
      color: var(--color-warning);
    }

    .marker-signal {
      background-color: var(--color-purple-bg);
      color: var(--color-render);
    }

    .marker-lifecycle {
      background-color: var(--color-green-bg);
      color: var(--color-success);
    }

    .marker-render {
      background-color: var(--color-red-bg-stronger);
      color: var(--color-error);
    }

    .marker-detection {
      background-color: var(--color-cyan-bg);
      color: var(--color-api);
    }

    .timeline-content {
      flex: 1;
    }

    .timeline-time {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      font-weight: var(--font-weight-bold);
      margin-bottom: 2px;
    }

    .timeline-description {
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      line-height: var(--line-height-normal);
    }

    .timeline-detail {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      font-style: italic;
      margin-top: 4px;
      padding-left: 12px;
      border-left: 2px solid var(--color-border-subtle);
    }

    .state-groups {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-standard);
    }

    .state-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .state-label {
      margin: 0;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
    }

    .state-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .state-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--font-size-sm);
      padding: 6px 0;
    }

    .state-name {
      color: var(--color-text-primary);
      flex: 1;
      font-family: var(--font-family-mono);
    }

    .state-item.state-changed {
      color: var(--color-warning);
    }

    .state-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 6px;
      border-radius: var(--border-radius-small);
      font-size: 0.75em;
      font-weight: var(--font-weight-bold);
      text-transform: uppercase;
      white-space: nowrap;
    }

    .state-badge.changed {
      background-color: var(--color-yellow-bg-medium);
      color: var(--color-warning);
    }

    .state-badge.readonly {
      background-color: var(--color-gray-bg-light);
      color: var(--color-text-tertiary);
    }

    .child-components {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: var(--spacing-compact);
      background-color: var(--color-bg-primary);
      border-radius: var(--border-radius-small);
    }

    .child-item {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      font-family: var(--font-family-mono);
      padding: 4px 0;
      line-height: var(--line-height-normal);
    }

    .optimization-tips {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-compact);
    }

    .tip {
      display: flex;
      gap: var(--spacing-compact);
      align-items: flex-start;
      padding: var(--spacing-compact);
      border-radius: var(--border-radius-small);
      font-size: var(--font-size-sm);
      line-height: var(--line-height-normal);
    }

    .tip-icon {
      flex-shrink: 0;
      font-size: 1.2em;
      line-height: 1.4;
    }

    .tip-text {
      flex: 1;
    }

    .tip-warning {
      background-color: var(--color-yellow-bg-light);
      color: var(--color-warning);
    }

    .tip-error {
      background-color: var(--color-red-bg-light);
      color: var(--color-error);
    }

    .tip-info {
      background-color: var(--color-blue-bg-lighter);
      color: var(--color-info);
    }

    .focus-footer {
      display: flex;
      gap: var(--spacing-compact);
      padding-top: var(--spacing-standard);
      border-top: 1px solid var(--color-border-default);
    }

    .action-button {
      padding: 8px 16px;
      border-radius: var(--border-radius-small);
      border: 1px solid transparent;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      transition: all var(--transition-fast);
      white-space: nowrap;
    }

    .button-secondary {
      background-color: var(--color-bg-tertiary);
      color: var(--color-text-secondary);
      border-color: var(--color-border-default);
    }

    .button-secondary:hover {
      background-color: var(--color-bg-quaternary);
      color: var(--color-text-primary);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusModeComponent {
  data = input.required<FocusData>();
  backClicked = output<void>();
  copyClicked = output<string>();
  exportClicked = output<string>();

  onBack(): void {
    this.backClicked.emit();
  }

  onCopy(): void {
    const path = this.data()
      .executionPath.map(s => `[${s.time}ms] ${s.description}`)
      .join('\n');
    this.copyClicked.emit(path);
  }

  onExport(): void {
    const json = JSON.stringify(this.data(), null, 2);
    this.exportClicked.emit(json);
  }
}
