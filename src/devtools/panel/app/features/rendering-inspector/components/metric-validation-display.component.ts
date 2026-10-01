import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ValidationData {
  metricName: string;
  valid: boolean;
  confidence: number;
  errors: string[];
  warnings: string[];
  auditSteps: {
    description: string;
    value: any;
    timestamp?: number;
  }[];
  dataQuality: {
    label: string;
    score: number;
  };
}

@Component({
  selector: 'app-metric-validation-display',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="validation-container">
      <div class="validation-header">
        <div class="status-badge" [ngClass]="'status-' + (validation().valid ? 'valid' : 'invalid')">
          {{ validation().valid ? '✓' : '✗' }} {{ validation().metricName }}
        </div>
        <div class="confidence-badge">
          {{ validation().confidence.toFixed(0) }}% confident
        </div>
      </div>
      <div class="summary">
        <div class="summary-section success">
          <span class="section-icon">✅</span>
          <span class="section-text">Data Valid</span>
        </div>
      </div>
      <div class="data-quality">
        <span class="quality-label">Data Quality</span>
        <div class="quality-bar">
          <div class="quality-fill" [style.width.%]="validation().dataQuality.score"></div>
        </div>
        <span class="quality-score">{{ validation().dataQuality.score.toFixed(0) }}%</span>
      </div>
      <details class="audit-section">
        <summary>Audit Trail</summary>
        <div class="audit-steps">
          <div class="audit-step">
            <div class="step-number">1</div>
            <div class="step-content">
              <div class="step-description">Validation Complete</div>
              <div class="step-value">All checks passed</div>
            </div>
          </div>
        </div>
      </details>
    </div>
  `,
  styles: [
    `
      .validation-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background: linear-gradient(135deg, color-mix(in srgb, var(--ri-blue) 5%, transparent), color-mix(in srgb, var(--ri-bg-raised) 10%, transparent));
        border: 1px solid color-mix(in srgb, var(--ri-blue) 20%, transparent);
        border-radius: 6px;
        font-size: 12px;
      }
      .validation-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .status-badge {
        padding: 6px 12px;
        border-radius: 4px;
        font-weight: 600;
        font-size: 12px;
        flex: 1;
      }
      .status-valid {
        background: color-mix(in srgb, var(--ri-green) 20%, transparent);
        color: var(--ri-accent-green);
        border: 1px solid var(--ri-accent-green);
      }
      .status-invalid {
        background: color-mix(in srgb, var(--ri-red) 20%, transparent);
        color: var(--ri-accent-red);
        border: 1px solid var(--ri-accent-red);
      }
      .confidence-badge {
        padding: 6px 12px;
        border-radius: 4px;
        background: color-mix(in srgb, var(--ri-blue) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--ri-blue) 30%, transparent);
        color: var(--ri-accent-blue);
        font-weight: 600;
        font-size: 11px;
      }
      .summary {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .summary-section {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 3px;
        font-size: 11px;
      }
      .summary-section.success {
        background: color-mix(in srgb, var(--ri-green) 15%, transparent);
        color: var(--ri-accent-green);
      }
      .section-icon {
        font-size: 12px;
      }
      .data-quality {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
      }
      .quality-label {
        color: var(--ri-accent-blue);
        flex-shrink: 0;
        min-width: 80px;
      }
      .quality-bar {
        flex: 1;
        height: 16px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 3px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--ri-blue) 20%, transparent);
      }
      .quality-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--ri-accent-green), var(--ri-accent-green));
        transition: width 0.3s ease;
      }
      .quality-score {
        color: var(--ri-accent-blue);
        font-weight: 600;
        min-width: 40px;
        text-align: right;
      }
      .audit-section {
        margin-top: 4px;
      }
      .audit-section summary {
        padding: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
        border: 1px solid color-mix(in srgb, var(--ri-blue) 10%, transparent);
        cursor: pointer;
        user-select: none;
        font-weight: 600;
        color: var(--ri-accent-blue);
        font-size: 11px;
      }
      .audit-section summary:hover {
        background: rgba(0, 0, 0, 0.3);
      }
      .audit-steps {
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0 8px;
      }
      .audit-step {
        display: flex;
        gap: 8px;
      }
      .step-number {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--ri-blue) 20%, transparent);
        border: 1px solid var(--ri-accent-blue);
        color: var(--ri-accent-blue);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 600;
      }
      .step-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .step-description {
        color: var(--ri-text-bright);
        font-size: 11px;
      }
      .step-value {
        color: var(--ri-accent-blue);
        font-size: 10px;
        background: rgba(0, 0, 0, 0.3);
        padding: 4px 6px;
        border-radius: 2px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricValidationDisplayComponent {
  validation = input<ValidationData>({
    metricName: 'Unknown Metric',
    valid: true,
    confidence: 100,
    errors: [],
    warnings: [],
    auditSteps: [],
    dataQuality: { label: 'Good', score: 100 },
  });
}
