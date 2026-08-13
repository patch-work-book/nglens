import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface HeadlineData {
  headline: string;
  reason: string;
  impact: string;
  assessment: {
    status: 'fast' | 'warning' | 'slow';
    message: string;
  };
}

@Component({
  selector: 'app-execution-headline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="headline-container">
      <div class="headline-content">
        <!-- Main headline -->
        <h2 class="headline-title">{{ data().headline }}</h2>

        <!-- Metadata section -->
        <div class="metadata-section">
          <!-- Reason -->
          <div class="metadata-item">
            <span class="metadata-label">Reason:</span>
            <span class="metadata-value">{{ data().reason }}</span>
          </div>

          <!-- Impact -->
          <div class="metadata-item">
            <span class="metadata-label">Impact:</span>
            <span class="metadata-value">{{ data().impact }}</span>
          </div>

          <!-- Assessment -->
          <div class="metadata-item">
            <span class="metadata-label">Assessment:</span>
            <span class="metadata-value"
                  [ngClass]="'assessment-' + data().assessment.status">
              {{ data().assessment.message }}
            </span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="actions-section">
          <button class="action-button button-secondary" title="View detailed timeline">
            View Timeline
          </button>
          <button class="action-button button-secondary" title="View raw events">
            View Raw Events
          </button>
          <button class="action-button button-primary" title="Enter focus mode">
            Focus Mode
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .headline-container {
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border-default);
      border-radius: var(--border-radius-medium);
      padding: var(--spacing-generous);
      margin: var(--spacing-generous) 0;
    }

    .headline-content {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-standard);
    }

    .headline-title {
      margin: 0;
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      line-height: var(--line-height-tight);
      color: var(--color-text-primary);
      letter-spacing: -0.5px;
    }

    .metadata-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-compact);
      padding: var(--spacing-standard) 0;
      border-top: 1px solid var(--color-border-subtle);
      border-bottom: 1px solid var(--color-border-subtle);
    }

    .metadata-item {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-compact);
      font-size: var(--font-size-sm);
    }

    .metadata-label {
      flex-shrink: 0;
      color: var(--color-text-secondary);
      font-weight: var(--font-weight-medium);
      min-width: 80px;
    }

    .metadata-value {
      flex: 1;
      color: var(--color-text-primary);
      line-height: var(--line-height-normal);
    }

    .metadata-value.assessment-fast {
      color: var(--color-success);
    }

    .metadata-value.assessment-warning {
      color: var(--color-warning);
      font-weight: var(--font-weight-medium);
    }

    .metadata-value.assessment-slow {
      color: var(--color-slow);
      font-weight: var(--font-weight-medium);
    }

    .actions-section {
      display: flex;
      gap: var(--spacing-compact);
      flex-wrap: wrap;
    }

    .action-button {
      padding: 8px 16px;
      border-radius: var(--border-radius-small);
      border: 1px solid transparent;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      transition: all 150ms ease-in-out;
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
      border-color: var(--color-border-subtle);
    }

    .button-primary {
      background-color: var(--color-primary);
      color: white;
      font-weight: var(--font-weight-bold);
    }

    .button-primary:hover {
      background-color: var(--color-primary-hover);
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
    }

    .button-primary:active {
      transform: scale(0.98);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionHeadlineComponent {
  data = input.required<HeadlineData>();
}
