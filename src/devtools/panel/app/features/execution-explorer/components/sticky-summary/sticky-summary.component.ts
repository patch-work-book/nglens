import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface StickyExecutionMetrics {
  totalTime: number;
  slowRenderCount: number;
  warningCount: number;
  retryCount: number;
  otherMetrics?: {
    signalsChanged: number;
    storesAffected: number;
    componentsRendered: number;
  };
}

@Component({
  selector: 'app-sticky-summary',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sticky-summary-container">
      <div class="summary-chip-group">
        <!-- Total execution time -->
        <button class="summary-chip chip-neutral" 
                [title]="'Total execution time: ' + metrics().totalTime.toFixed(2) + 'ms'"
                (click)="onMetricClick('time')">
          <span class="chip-icon">⏱</span>
          <span class="chip-label">{{ formatTime(metrics().totalTime) }}</span>
        </button>

        <!-- Slow renders -->
        @if (metrics().slowRenderCount > 0) {
          <button class="summary-chip chip-slow"
                  [title]="'Slow renders (>500ms): ' + metrics().slowRenderCount"
                  (click)="onMetricClick('slow')">
            <span class="chip-icon">●</span>
            <span class="chip-label">{{ metrics().slowRenderCount }} Slow</span>
          </button>
        }

        <!-- Warnings -->
        @if (metrics().warningCount > 0) {
          <button class="summary-chip chip-warning"
                  [title]="'Warnings detected: ' + metrics().warningCount"
                  (click)="onMetricClick('warning')">
            <span class="chip-icon">⚠</span>
            <span class="chip-label">{{ metrics().warningCount }} Warnings</span>
          </button>
        }

        <!-- Retries -->
        @if (metrics().retryCount > 0) {
          <button class="summary-chip chip-retry"
                  [title]="'API retries: ' + metrics().retryCount"
                  (click)="onMetricClick('retry')">
            <span class="chip-icon">↩</span>
            <span class="chip-label">{{ metrics().retryCount }} Retries</span>
          </button>
        }

        <!-- More metrics button -->
        <button class="summary-chip chip-secondary"
                title="Show more metrics"
                (click)="onMetricClick('more')">
          <span class="chip-label">More</span>
          <span class="chip-icon">⊕</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .sticky-summary-container {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--color-bg-primary);
      border-bottom: 1px solid var(--color-border-default);
      padding: var(--spacing-compact);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .summary-chip-group {
      display: flex;
      gap: var(--spacing-compact);
      flex-wrap: wrap;
      align-items: center;
    }

    .summary-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: var(--border-radius-small);
      border: 1px solid transparent;
      background-color: var(--color-bg-secondary);
      color: var(--color-text-secondary);
      font-size: var(--font-size-xs);
      font-weight: 500;
      cursor: pointer;
      transition: all 150ms ease-in-out;
      white-space: nowrap;
      user-select: none;
    }

    .summary-chip:hover {
      background-color: var(--color-bg-tertiary);
      color: var(--color-text-primary);
    }

    .summary-chip:active {
      transform: scale(0.98);
    }

    /* Color variants */
    .chip-neutral {
      border-color: var(--color-border-default);
      color: var(--color-text-secondary);
    }

    .chip-slow {
      background-color: var(--color-red-bg-light);
      border-color: var(--color-slow);
      color: var(--color-slow);
    }

    .chip-slow:hover {
      background-color: var(--color-red-bg-medium);
    }

    .chip-warning {
      background-color: var(--color-yellow-bg-light);
      border-color: var(--color-warning);
      color: var(--color-warning);
    }

    .chip-warning:hover {
      background-color: var(--color-yellow-bg-medium);
    }

    .chip-retry {
      background-color: var(--color-blue-bg-lighter);
      border-color: var(--color-info);
      color: var(--color-info);
    }

    .chip-retry:hover {
      background-color: var(--color-blue-bg-stronger);
    }

    .chip-secondary {
      border-color: var(--color-border-subtle);
      color: var(--color-text-tertiary);
    }

    .chip-secondary:hover {
      border-color: var(--color-border-default);
      color: var(--color-text-secondary);
    }

    .chip-icon {
      font-size: 0.85em;
      opacity: 0.7;
    }

    .chip-label {
      font-size: var(--font-size-xs);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StickyExecutionSummaryComponent {
  metrics = input.required<StickyExecutionMetrics>();
  metricClicked = output<string>();

  formatTime(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(0)}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  }

  onMetricClick(metric: string): void {
    this.metricClicked.emit(metric);
  }
}
