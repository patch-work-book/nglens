import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface GlanceMetrics {
  duration: number;
  renderCount: number;
  uniqueComponents: number;
  frameBudgetExceeded: boolean;
  framesMissed: number;
  primaryBottleneck: { icon: string; label: string } | null;
  health: 'green' | 'yellow' | 'red';
  confidence: number;
  audit: {
    durationCalculation: string;
    renderCountValidation: boolean;
    healthCalculation: string;
  };
}

@Component({
  selector: 'app-execution-detective-glance',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="glance-container">
      <div class="glance-header">
        <span class="action-trigger">📊 Execution Summary</span>
        <span class="health-badge" [ngClass]="'health-' + metrics().health">
          {{ getHealthIcon() }} {{ getHealthLabel() }}
        </span>
      </div>
      <div class="metric-cards">
        <div class="metric-card">
          <div class="metric-value">{{ metrics().duration.toFixed(1) }}<span class="unit">ms</span></div>
          <div class="metric-label">Duration</div>
          <div class="metric-detail" [ngClass]="metrics().frameBudgetExceeded ? 'exceeded' : 'ok'">
            {{ metrics().frameBudgetExceeded ? 'Frames missed' : 'On budget' }}
          </div>
        </div>
        <div class="metric-card">
          <div class="metric-value">{{ metrics().renderCount }}</div>
          <div class="metric-label">Renders</div>
          <div class="metric-detail">{{ metrics().uniqueComponents }} components</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">{{ metrics().primaryBottleneck ? metrics().primaryBottleneck!.icon : '✅' }}</div>
          <div class="metric-label">{{ metrics().primaryBottleneck ? metrics().primaryBottleneck!.label : 'Healthy' }}</div>
          <div class="metric-detail">{{ metrics().primaryBottleneck ? 'Highest impact' : 'No issues' }}</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">{{ metrics().confidence }}%</div>
          <div class="metric-label">Confidence</div>
          <div class="metric-detail">Data quality</div>
        </div>
      </div>
      <details class="audit-trail">
        <summary>View Calculations</summary>
        <div class="audit-content">
          <div class="audit-item"><strong>Duration:</strong> {{ metrics().audit.durationCalculation }}</div>
          <div class="audit-item"><strong>Valid:</strong> {{ metrics().audit.renderCountValidation ? 'Yes' : 'No' }}</div>
          <div class="audit-item"><strong>Health:</strong> {{ metrics().audit.healthCalculation }}</div>
        </div>
      </details>
    </div>
  `,
  styles: [
    `
      .glance-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #0f4c75;
        border-radius: 8px;
      }
      .glance-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
      }
      .action-trigger {
        color: #64b5f6;
        font-weight: 600;
      }
      .health-badge {
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
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
      .metric-cards {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .metric-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(100, 181, 246, 0.2);
        border-radius: 6px;
        text-align: center;
      }
      .metric-value {
        font-size: 20px;
        font-weight: 700;
        color: #64b5f6;
      }
      .unit {
        font-size: 12px;
        color: #90caf9;
        font-weight: 400;
      }
      .metric-label {
        font-size: 11px;
        color: #b0bec5;
        font-weight: 600;
        text-transform: uppercase;
      }
      .metric-detail {
        font-size: 10px;
        color: #78909c;
      }
      .metric-detail.exceeded {
        color: #ffb74d;
      }
      .metric-detail.ok {
        color: #81c784;
      }
      .audit-trail {
        margin-top: 8px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 4px;
        border: 1px solid rgba(100, 181, 246, 0.1);
        font-size: 10px;
        color: #90caf9;
        cursor: pointer;
      }
      .audit-trail summary {
        user-select: none;
      }
      .audit-content {
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .audit-item {
        padding: 4px;
        border-left: 2px solid #64b5f6;
        padding-left: 8px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionDetectiveGlanceComponent {
  metrics = input<GlanceMetrics>({
    duration: 0,
    renderCount: 0,
    uniqueComponents: 0,
    frameBudgetExceeded: false,
    framesMissed: 0,
    primaryBottleneck: null,
    health: 'green',
    confidence: 100,
    audit: {
      durationCalculation: '',
      renderCountValidation: true,
      healthCalculation: '',
    },
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
