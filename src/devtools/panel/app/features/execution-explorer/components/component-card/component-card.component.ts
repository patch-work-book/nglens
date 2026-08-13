/**
 * Component Card - Redesigned
 * 
 * Shows performance metrics and render reasons in a self-explanatory card.
 * Each card tells a story without requiring clicks to understand.
 */
import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ComponentMetrics {
  name: string;
  renderCount: number;
  totalDuration: number;
  averageDuration: number;
  reasons: RenderReason[];
  performance: 'fast' | 'warning' | 'slow';
  affectedChildren: number;
  isExpanded?: boolean;
}

export interface RenderReason {
  type: 'props' | 'signal' | 'store' | 'lifecycle' | 'manual' | 'context';
  description: string;
  count: number;
}

@Component({
  selector: 'app-component-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="component-card" 
         [class]="'performance-' + metrics().performance"
         (click)="onCardClick()">
      
      <!-- Header: Component name + duration -->
      <div class="card-header">
        <div class="component-name">{{ metrics().name }}</div>
        <div class="duration-badge" [class]="'badge-' + metrics().performance">
          ⏱ {{ metrics().totalDuration.toFixed(0) }}ms
        </div>
      </div>

      <!-- Body: Render count + reasons -->
      <div class="card-body">
        <!-- Render count -->
        <div class="metric-row">
          <span class="metric-label">Renders:</span>
          <span class="metric-value">{{ metrics().renderCount }}x</span>
          @if (metrics().averageDuration > 0) {
            <span class="metric-detail">(avg {{ metrics().averageDuration.toFixed(0) }}ms)</span>
          }
        </div>

        <!-- Render reasons -->
        @if (metrics().reasons.length > 0) {
          <div class="reasons-section">
            <div class="reasons-label">Caused by:</div>
            <div class="reasons-list">
              @for (reason of metrics().reasons | slice:0:3; track reason.type) {
                <div class="reason-item">
                  <span class="reason-type">{{ formatReasonType(reason.type) }}</span>
                  <span class="reason-description">{{ reason.description }}</span>
                  @if (reason.count > 1) {
                    <span class="reason-count">({{ reason.count }}x)</span>
                  }
                </div>
              }
              @if (metrics().reasons.length > 3) {
                <div class="reasons-more">+{{ metrics().reasons.length - 3 }} more reasons</div>
              }
            </div>
          </div>
        }

        <!-- Performance assessment -->
        <div class="assessment-row" [class]="'assessment-' + metrics().performance">
          @switch (metrics().performance) {
            @case ('fast') {
              <span>✓ Fast performance</span>
            }
            @case ('warning') {
              <span>⚠ Near threshold ({{ metrics().totalDuration.toFixed(0) }}ms)</span>
            }
            @case ('slow') {
              <span>● Slower than expected ({{ metrics().totalDuration.toFixed(0) }}ms, target: <500ms)</span>
            }
          }
        </div>

        <!-- Affected children -->
        @if (metrics().affectedChildren > 0) {
          <div class="children-info">
            Triggered {{ metrics().affectedChildren }} child renders
          </div>
        }
      </div>

      <!-- Footer: Actions -->
      <div class="card-footer">
        <button class="action-button button-secondary" 
                (click)="onDebug($event)"
                title="Debug this component">
          Debug
        </button>
        <button class="action-button button-secondary" 
                (click)="onExpand($event)"
                title="Expand details">
          Details
        </button>
        @if (metrics().performance === 'slow') {
          <button class="action-button button-accent" 
                  (click)="onOptimize($event)"
                  title="Get optimization tips">
            Optimize
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .component-card {
      border-radius: var(--border-radius-medium);
      border: 2px solid var(--color-border-default);
      background-color: var(--color-bg-secondary);
      padding: var(--spacing-standard);
      margin-bottom: var(--spacing-compact);
      cursor: pointer;
      transition: all var(--transition-normal);
      overflow: hidden;
    }

    .component-card:hover {
      background-color: var(--color-bg-tertiary);
      border-color: var(--color-border-subtle);
      box-shadow: var(--shadow-sm);
    }

    .component-card.performance-fast {
      border-left: 4px solid var(--color-success);
    }

    .component-card.performance-warning {
      border-left: 4px solid var(--color-warning);
    }

    .component-card.performance-slow {
      border-left: 4px solid var(--color-slow);
      background-color: rgba(239, 68, 68, 0.05);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-compact);
      margin-bottom: var(--spacing-compact);
    }

    .component-name {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .duration-badge {
      flex-shrink: 0;
      padding: 4px 12px;
      border-radius: var(--border-radius-small);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      white-space: nowrap;
    }

    .badge-fast {
      background-color: rgba(34, 197, 94, 0.2);
      color: var(--color-success);
    }

    .badge-warning {
      background-color: rgba(251, 191, 36, 0.2);
      color: var(--color-warning);
    }

    .badge-slow {
      background-color: rgba(239, 68, 68, 0.2);
      color: var(--color-slow);
    }

    .card-body {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-compact);
      margin-bottom: var(--spacing-standard);
    }

    .metric-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-compact);
      font-size: var(--font-size-sm);
    }

    .metric-label {
      color: var(--color-text-secondary);
      font-weight: var(--font-weight-medium);
      min-width: 70px;
    }

    .metric-value {
      color: var(--color-text-primary);
      font-weight: var(--font-weight-bold);
    }

    .metric-detail {
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xs);
    }

    .reasons-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: var(--spacing-compact);
      background-color: var(--color-bg-primary);
      border-radius: var(--border-radius-small);
    }

    .reasons-label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
    }

    .reasons-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .reason-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--font-size-xs);
      color: var(--color-text-primary);
      line-height: var(--line-height-tight);
    }

    .reason-type {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 60px;
      padding: 2px 6px;
      background-color: var(--color-info);
      color: white;
      border-radius: var(--border-radius-small);
      font-weight: var(--font-weight-bold);
      text-transform: capitalize;
      font-size: 0.75em;
    }

    .reason-description {
      flex: 1;
      color: var(--color-text-secondary);
    }

    .reason-count {
      color: var(--color-text-tertiary);
      font-size: 0.85em;
    }

    .reasons-more {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      font-style: italic;
      padding-top: 4px;
      border-top: 1px solid var(--color-border-subtle);
      padding-top: 8px;
    }

    .assessment-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px var(--spacing-compact);
      border-radius: var(--border-radius-small);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
    }

    .assessment-fast {
      background-color: rgba(34, 197, 94, 0.1);
      color: var(--color-success);
    }

    .assessment-warning {
      background-color: rgba(251, 191, 36, 0.1);
      color: var(--color-warning);
    }

    .assessment-slow {
      background-color: rgba(239, 68, 68, 0.1);
      color: var(--color-slow);
    }

    .children-info {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      padding: 4px 0;
    }

    .card-footer {
      display: flex;
      gap: var(--spacing-compact);
      flex-wrap: wrap;
    }

    .action-button {
      padding: 6px 12px;
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
      border-color: var(--color-border-subtle);
    }

    .button-accent {
      background-color: var(--color-warning);
      color: white;
    }

    .button-accent:hover {
      background-color: #F59E0B;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComponentCardComponent {
  metrics = input.required<ComponentMetrics>();
  cardClicked = output<string>();
  debugClicked = output<string>();
  expandClicked = output<string>();
  optimizeClicked = output<string>();

  formatReasonType(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  onCardClick(): void {
    this.cardClicked.emit(this.metrics().name);
  }

  onDebug(event: Event): void {
    event.stopPropagation();
    this.debugClicked.emit(this.metrics().name);
  }

  onExpand(event: Event): void {
    event.stopPropagation();
    this.expandClicked.emit(this.metrics().name);
  }

  onOptimize(event: Event): void {
    event.stopPropagation();
    this.optimizeClicked.emit(this.metrics().name);
  }
}
