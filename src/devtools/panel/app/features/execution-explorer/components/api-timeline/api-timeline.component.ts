/**
 * API Timeline Component
 * 
 * Groups API calls by execution phase and shows them with success/retry indicators.
 * Transforms flat list of 30+ APIs into 2-3 grouped phases with clear narrative.
 */
import { Component, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface APICall {
  id: string;
  method: string;           // GET, POST, etc.
  endpoint: string;         // /api/products
  status: number;           // 200, 408, 404, etc.
  duration: number;         // milliseconds
  timestamp: number;        // when it started
  isRetry: boolean;         // was this a retry?
  retryOf?: string;         // ID of original request if this is a retry
  size?: number;           // response size in bytes
}

export interface APIPhase {
  id: string;
  name: string;             // "Initial Load", "Filter Applied", "User Interaction"
  timing: {
    start: number;
    end: number;
    duration: number;
  };
  status: 'success' | 'warning' | 'failed';
  statusCount: {
    success: number;
    retried: number;
    failed: number;
  };
  apis: APICall[];
  summary: string;          // "3 successful, 1 retry" etc.
}

@Component({
  selector: 'app-api-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="api-timeline-container">
      @for (phase of phases(); track phase.id) {
        <div class="phase-container">
          <!-- Phase header -->
          <div class="phase-header" [class]="'status-' + phase.status">
            <div class="phase-title">
              <span class="phase-name">{{ phase.name }}</span>
              <span class="phase-timing">({{ formatTime(phase.timing.start) }} - {{ formatTime(phase.timing.end) }})</span>
            </div>
            <div class="phase-summary">
              <span class="status-badge" [class]="'badge-' + phase.status">
                {{ phase.status === 'success' ? '✓' : phase.status === 'warning' ? '⚠' : '✗' }}
              </span>
              {{ phase.summary }}
            </div>
          </div>

          <!-- Phase APIs -->
          <div class="api-list">
            @for (api of phase.apis; track api.id) {
              <div class="api-item" 
                   [class.api-retry]="api.isRetry"
                   (click)="onAPIClick(api)">
                <div class="api-method">{{ api.method }}</div>
                <div class="api-endpoint">{{ api.endpoint }}</div>
                <div class="api-status" [class]="'http-' + getStatusClass(api.status)">
                  {{ api.status }}
                </div>
                <div class="api-duration">{{ api.duration.toFixed(0) }}ms</div>
                @if (api.isRetry) {
                  <div class="retry-indicator" title="This was a retry">↩</div>
                }
                @if (api.size) {
                  <div class="api-size">{{ formatSize(api.size) }}</div>
                }
              </div>
            }
          </div>
        </div>
      }

      <!-- Empty state -->
      @if (phases().length === 0) {
        <div class="api-empty">
          <div class="empty-icon">∅</div>
          <div class="empty-message">No API calls detected</div>
        </div>
      }
    </div>
  `,
  styles: [`
    .api-timeline-container {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-standard);
    }

    .phase-container {
      border-radius: var(--border-radius-medium);
      overflow: hidden;
      border: 1px solid var(--color-border-default);
      background-color: var(--color-bg-secondary);
    }

    .phase-header {
      padding: var(--spacing-standard);
      background-color: var(--color-bg-tertiary);
      border-bottom: 2px solid var(--color-border-default);
      cursor: pointer;
      transition: all var(--transition-normal);
    }

    .phase-header:hover {
      background-color: var(--color-bg-quaternary);
    }

    .phase-header.status-success {
      border-bottom-color: var(--color-success);
    }

    .phase-header.status-warning {
      border-bottom-color: var(--color-warning);
    }

    .phase-header.status-failed {
      border-bottom-color: var(--color-error);
    }

    .phase-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-compact);
      margin-bottom: 8px;
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
    }

    .phase-name {
      font-size: var(--font-size-base);
    }

    .phase-timing {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      font-weight: var(--font-weight-regular);
    }

    .phase-summary {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: var(--border-radius-full);
      font-size: 0.9em;
      font-weight: var(--font-weight-bold);
    }

    .badge-success {
      background-color: rgba(34, 197, 94, 0.2);
      color: var(--color-success);
    }

    .badge-warning {
      background-color: rgba(251, 191, 36, 0.2);
      color: var(--color-warning);
    }

    .badge-failed {
      background-color: rgba(239, 68, 68, 0.2);
      color: var(--color-error);
    }

    .api-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background-color: var(--color-bg-primary);
    }

    .api-item {
      display: grid;
      grid-template-columns: 45px 1fr 45px 70px auto auto;
      gap: var(--spacing-compact);
      align-items: center;
      padding: var(--spacing-compact) var(--spacing-standard);
      background-color: var(--color-bg-secondary);
      border-bottom: 1px solid var(--color-border-subtle);
      cursor: pointer;
      transition: all var(--transition-fast);
      font-size: var(--font-size-sm);
    }

    .api-item:hover {
      background-color: var(--color-bg-tertiary);
    }

    .api-item:last-child {
      border-bottom: none;
    }

    .api-item.api-retry {
      opacity: 0.7;
      background-color: rgba(251, 191, 36, 0.05);
    }

    .api-method {
      font-family: var(--font-family-mono);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      color: var(--color-info);
      text-transform: uppercase;
    }

    .api-endpoint {
      font-family: var(--font-family-mono);
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .api-status {
      text-align: center;
      font-weight: var(--font-weight-medium);
      border-radius: var(--border-radius-small);
      padding: 2px 6px;
      font-size: var(--font-size-xs);
    }

    .http-2xx {
      background-color: rgba(34, 197, 94, 0.2);
      color: var(--color-success);
    }

    .http-3xx {
      background-color: rgba(59, 130, 246, 0.2);
      color: var(--color-info);
    }

    .http-4xx {
      background-color: rgba(251, 191, 36, 0.2);
      color: var(--color-warning);
    }

    .http-5xx {
      background-color: rgba(239, 68, 68, 0.2);
      color: var(--color-error);
    }

    .api-duration {
      text-align: right;
      color: var(--color-text-secondary);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
    }

    .retry-indicator {
      color: var(--color-warning);
      font-size: var(--font-size-xs);
      text-align: center;
      title: 'Retry';
    }

    .api-size {
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xs);
      text-align: right;
    }

    .api-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-generous);
      text-align: center;
      color: var(--color-text-tertiary);
    }

    .empty-icon {
      font-size: 28px;
      margin-bottom: var(--spacing-compact);
      opacity: 0.4;
    }

    .empty-message {
      font-size: var(--font-size-sm);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class APITimelineComponent {
  phases = input.required<APIPhase[]>();
  apiClicked = output<APICall>();

  formatTime(ms: number): string {
    return `${ms.toFixed(0)}ms`;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  getStatusClass(status: number): string {
    if (status >= 200 && status < 300) return '2xx';
    if (status >= 300 && status < 400) return '3xx';
    if (status >= 400 && status < 500) return '4xx';
    return '5xx';
  }

  onAPIClick(api: APICall): void {
    this.apiClicked.emit(api);
  }
}
