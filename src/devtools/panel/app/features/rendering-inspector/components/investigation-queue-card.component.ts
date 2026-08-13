import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface QueuedInvestigation {
  id: string;
  title: string;
  icon: string;
  category: 'api-slow' | 'over-render' | 'cascade' | 'store-heavy';
  impactScore: number;
  optimizationPotential: number;
  gainScore: number;
  alreadyOptimized: number;
  metrics: {
    affected: number;
    affectedLabel: string;
    savings: number;
    savingsLabel: string;
  };
  confidence: number;
  audit: {
    impactCalc: string;
    gainCalc: string;
  };
}

@Component({
  selector: 'app-investigation-queue-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="queue-card" (click)="onSelect.emit(investigation().id)">
      <div class="card-header">
        <div class="icon-title">
          <span class="icon">{{ investigation().icon }}</span>
          <span class="title">{{ investigation().title }}</span>
        </div>
        <span class="rank-badge">Top</span>
      </div>
      <div class="gain-score-section">
        <div class="bar-label">Priority</div>
        <div class="gain-bar-container">
          <div class="gain-bar" [style.width.%]="investigation().gainScore"></div>
          <span class="gain-value">{{ investigation().gainScore.toFixed(0) }}</span>
        </div>
      </div>
      <div class="metrics-row">
        <div class="metric">
          <span class="metric-label">Impact</span>
          <span class="metric-value">{{ investigation().impactScore.toFixed(0) }}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Potential</span>
          <span class="metric-value">{{ (investigation().optimizationPotential * 100).toFixed(0) }}%</span>
        </div>
        <div class="metric">
          <span class="metric-label">Confidence</span>
          <span class="metric-value">{{ investigation().confidence.toFixed(0) }}%</span>
        </div>
      </div>
      <div class="impact-section">
        <div class="impact-item">
          <span class="impact-icon">📊</span>
          <span class="impact-text">{{ investigation().metrics.affected }} {{ investigation().metrics.affectedLabel }}</span>
        </div>
        <div class="impact-item">
          <span class="impact-icon">💾</span>
          <span class="impact-text">{{ investigation().metrics.savings }} {{ investigation().metrics.savingsLabel }}</span>
        </div>
      </div>
      <details class="audit-trail">
        <summary>Calculation</summary>
        <div class="audit-content">
          <div class="audit-item">{{ investigation().audit.impactCalc }}</div>
          <div class="audit-item">{{ investigation().audit.gainCalc }}</div>
        </div>
      </details>
      <div class="cta">Click to investigate</div>
    </div>
  `,
  styles: [
    `
      .queue-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        background: linear-gradient(135deg, rgba(100, 181, 246, 0.05), rgba(15, 76, 117, 0.1));
        border: 1px solid rgba(100, 181, 246, 0.3);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .queue-card:hover {
        background: linear-gradient(135deg, rgba(100, 181, 246, 0.1), rgba(15, 76, 117, 0.15));
        border-color: rgba(100, 181, 246, 0.5);
        transform: translateY(-2px);
      }
      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .icon-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .icon {
        font-size: 18px;
      }
      .title {
        font-size: 13px;
        font-weight: 600;
        color: #e0e0e0;
      }
      .rank-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 3px;
        background: #ff6b6b;
        color: white;
      }
      .gain-score-section {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .bar-label {
        font-size: 10px;
        color: #90caf9;
        text-transform: uppercase;
      }
      .gain-bar-container {
        position: relative;
        height: 20px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 3px;
        overflow: hidden;
        border: 1px solid rgba(100, 181, 246, 0.2);
      }
      .gain-bar {
        height: 100%;
        background: linear-gradient(90deg, #64b5f6, #42a5f5);
        transition: width 0.3s ease;
      }
      .gain-value {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 11px;
        font-weight: 600;
        color: white;
      }
      .metrics-row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        font-size: 11px;
      }
      .metric {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
        text-align: center;
      }
      .metric-label {
        color: #78909c;
        font-size: 9px;
        text-transform: uppercase;
      }
      .metric-value {
        color: #64b5f6;
        font-weight: 600;
      }
      .impact-section {
        display: flex;
        gap: 8px;
        font-size: 11px;
      }
      .impact-item {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
      }
      .impact-icon {
        font-size: 12px;
      }
      .impact-text {
        color: #b0bec5;
        flex: 1;
      }
      .audit-trail {
        margin-top: 4px;
        padding: 6px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
        border: 1px solid rgba(100, 181, 246, 0.1);
        font-size: 9px;
        color: #90caf9;
        cursor: pointer;
      }
      .audit-trail summary {
        user-select: none;
        font-weight: 600;
      }
      .audit-content {
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .audit-item {
        padding: 3px 4px;
        border-left: 2px solid #64b5f6;
        padding-left: 6px;
      }
      .cta {
        font-size: 9px;
        color: #64b5f6;
        text-align: center;
        opacity: 0.7;
      }
      .queue-card:hover .cta {
        opacity: 1;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvestigationQueueCardComponent {
  investigation = input.required<QueuedInvestigation>();
  onSelect = output<string>();
}
