import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface InlineSummary {
  duration: number;
  renderCount: number;
  uniqueComponents: number;
  frameBudgetExceeded: boolean;
  framesMissed: number;
  health: 'green' | 'yellow' | 'red';
  confidence: number;
}

@Component({
  selector: 'app-execution-summary-inline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="summary-inline">
      <!-- Single Line Summary -->
      <div class="summary-line">
        <span class="summary-badge" [ngClass]="'health-' + metrics().health">
          {{ getHealthIcon() }}
          {{ getHealthLabel() }}
        </span>
        
        <span class="metric">
          <strong>{{ metrics().duration.toFixed(0) }}ms</strong>
          {{ metrics().renderCount }} renders
        </span>
        
        <span class="metric" *ngIf="metrics().frameBudgetExceeded">
          <strong>⚠️ {{ metrics().framesMissed }} frames missed</strong>
        </span>
        
        <span class="metric" *ngIf="!metrics().frameBudgetExceeded">
          <strong>✓ On budget</strong>
        </span>
        
        <span class="metric">
          {{ metrics().uniqueComponents }} components
        </span>
        
        <details class="calculations">
          <summary>View</summary>
          <div class="calc-detail">Duration: {{ metrics().duration.toFixed(0) }}ms total</div>
          <div class="calc-detail">Renders: {{ metrics().renderCount }} across {{ metrics().uniqueComponents }} components</div>
          <div class="calc-detail">Confidence: {{ metrics().confidence.toFixed(0) }}%</div>
        </details>
      </div>
    </div>
  `,
  styles: [
    `
      .summary-inline {
        padding: 8px 12px;
        background: linear-gradient(135deg, var(--ri-bg-deep) 0%, var(--ri-bg-card) 100%);
        border: 1px solid var(--ri-bg-raised);
        border-radius: 6px;
        margin-bottom: 12px;
      }

      .summary-line {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12px;
        flex-wrap: wrap;
      }

      .summary-badge {
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: 600;
        white-space: nowrap;
      }

      .health-green {
        background: color-mix(in srgb, var(--ri-green) 20%, transparent);
        color: var(--ri-accent-green);
      }

      .health-yellow {
        background: color-mix(in srgb, var(--ri-amber) 20%, transparent);
        color: var(--ri-accent-amber);
      }

      .health-red {
        background: color-mix(in srgb, var(--ri-red) 20%, transparent);
        color: var(--ri-accent-red);
      }

      .metric {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        background: color-mix(in srgb, var(--ri-blue) 10%, transparent);
        border-radius: 3px;
        color: var(--ri-text-primary);
        white-space: nowrap;
      }

      .metric strong {
        color: var(--ri-accent-blue);
        font-weight: 600;
      }

      .calculations {
        cursor: pointer;
        color: var(--ri-accent-blue);
        font-size: 10px;
        padding: 2px 4px;
        border-radius: 2px;
      }

      .calculations summary {
        user-select: none;
      }

      .calculations summary:hover {
        background: color-mix(in srgb, var(--ri-blue) 10%, transparent);
      }

      .calc-detail {
        padding: 4px 8px;
        color: var(--ri-accent-blue);
        font-family: inherit;
        font-size: 10px;
        border-left: 2px solid var(--ri-accent-blue);
        padding-left: 8px;
        margin-top: 4px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionSummaryInlineComponent {
  metrics = input<InlineSummary>({
    duration: 0,
    renderCount: 0,
    uniqueComponents: 0,
    frameBudgetExceeded: false,
    framesMissed: 0,
    health: 'green',
    confidence: 100,
  });

  getHealthIcon(): string {
    const h = this.metrics().health;
    if (h === 'green') return '✅';
    if (h === 'yellow') return '⚠️';
    if (h === 'red') return '🔴';
    return '';
  }

  getHealthLabel(): string {
    const h = this.metrics().health;
    if (h === 'green') return 'Healthy';
    if (h === 'yellow') return 'Caution';
    if (h === 'red') return 'Critical';
    return '';
  }
}
