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
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #0f4c75;
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
        background: #1b5e20;
        color: #4caf50;
      }

      .health-yellow {
        background: #f57f17;
        color: #fff;
      }

      .health-red {
        background: #b71c1c;
        color: #ff5252;
      }

      .metric {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        background: rgba(100, 181, 246, 0.1);
        border-radius: 3px;
        color: #b0bec5;
        white-space: nowrap;
      }

      .metric strong {
        color: #64b5f6;
        font-weight: 600;
      }

      .calculations {
        cursor: pointer;
        color: #64b5f6;
        font-size: 10px;
        padding: 2px 4px;
        border-radius: 2px;
      }

      .calculations summary {
        user-select: none;
      }

      .calculations summary:hover {
        background: rgba(100, 181, 246, 0.1);
      }

      .calc-detail {
        padding: 4px 8px;
        color: #90caf9;
        font-family: monospace;
        font-size: 10px;
        border-left: 2px solid #64b5f6;
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
