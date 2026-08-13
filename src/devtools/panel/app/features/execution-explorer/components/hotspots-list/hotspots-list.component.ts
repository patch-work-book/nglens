import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Hotspot {
  id: string;
  component: string;
  metric: string;
  reason: string;
  action: string;
  severity: 'slow' | 'warning' | 'info';
}

export interface HotspotsData {
  slowRenders: Hotspot[];
  warnings: Hotspot[];
  info: Hotspot[];
}

@Component({
  selector: 'app-hotspots-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="hotspots-container">
      <!-- Slow Renders -->
      @if (data().slowRenders.length > 0) {
        <div class="hotspot-section">
          <h3 class="section-title">
            <span class="severity-indicator severity-slow">●</span>
            Slow Renders ({{ data().slowRenders.length }})
          </h3>
          <div class="hotspot-list">
            @for (hotspot of data().slowRenders; track hotspot.id) {
              <div class="hotspot-item" (click)="onHotspotClick(hotspot)">
                <div class="hotspot-header">
                  <span class="hotspot-component">{{ hotspot.component }}</span>
                  <span class="hotspot-metric">{{ hotspot.metric }}</span>
                </div>
                <div class="hotspot-reason">{{ hotspot.reason }}</div>
                <div class="hotspot-action">{{ hotspot.action }}</div>
              </div>
            }
          </div>
        </div>
      }

      <!-- Warnings -->
      @if (data().warnings.length > 0) {
        <div class="hotspot-section">
          <h3 class="section-title">
            <span class="severity-indicator severity-warning">⚠</span>
            Warnings ({{ data().warnings.length }})
          </h3>
          <div class="hotspot-list">
            @for (hotspot of data().warnings; track hotspot.id) {
              <div class="hotspot-item" (click)="onHotspotClick(hotspot)">
                <div class="hotspot-header">
                  <span class="hotspot-component">{{ hotspot.component }}</span>
                  <span class="hotspot-metric">{{ hotspot.metric }}</span>
                </div>
                <div class="hotspot-reason">{{ hotspot.reason }}</div>
                <div class="hotspot-action">{{ hotspot.action }}</div>
              </div>
            }
          </div>
        </div>
      }

      <!-- Info -->
      @if (data().info.length > 0) {
        <div class="hotspot-section">
          <h3 class="section-title">
            <span class="severity-indicator severity-info">ℹ</span>
            Insights ({{ data().info.length }})
          </h3>
          <div class="hotspot-list">
            @for (hotspot of data().info; track hotspot.id) {
              <div class="hotspot-item" (click)="onHotspotClick(hotspot)">
                <div class="hotspot-header">
                  <span class="hotspot-component">{{ hotspot.component }}</span>
                  <span class="hotspot-metric">{{ hotspot.metric }}</span>
                </div>
                <div class="hotspot-reason">{{ hotspot.reason }}</div>
                <div class="hotspot-action">{{ hotspot.action }}</div>
              </div>
            }
          </div>
        </div>
      }

      <!-- Empty state -->
      @if (data().slowRenders.length === 0 && data().warnings.length === 0 && data().info.length === 0) {
        <div class="hotspot-empty">
          <div class="empty-icon">✓</div>
          <div class="empty-title">All Clear</div>
          <div class="empty-message">No performance issues detected</div>
        </div>
      }
    </div>
  `,
  styles: [`
    .hotspots-container {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-standard);
      padding: 0;
    }

    .hotspot-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-compact);
    }

    .section-title {
      margin: 0;
      font-size: var(--font-size-md);
      font-weight: var(--font-weight-bold);
      line-height: var(--line-height-tight);
      color: var(--color-text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .severity-indicator {
      font-size: 0.9em;
      opacity: 0.7;
    }

    .severity-slow {
      color: var(--color-slow);
    }

    .severity-warning {
      color: var(--color-warning);
    }

    .severity-info {
      color: var(--color-info);
    }

    .hotspot-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-compact);
    }

    .hotspot-item {
      background-color: var(--color-bg-secondary);
      border: 1px solid var(--color-border-default);
      border-radius: var(--border-radius-medium);
      padding: var(--spacing-compact);
      cursor: pointer;
      transition: all var(--transition-normal);
    }

    .hotspot-item:hover {
      background-color: var(--color-bg-tertiary);
      border-color: var(--color-border-subtle);
      box-shadow: var(--shadow-sm);
    }

    .hotspot-item:active {
      transform: scale(0.98);
    }

    .hotspot-header {
      display: flex;
      align-items: baseline;
      gap: var(--spacing-compact);
      margin-bottom: 6px;
    }

    .hotspot-component {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      flex: 1;
    }

    .hotspot-metric {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      white-space: nowrap;
    }

    .hotspot-reason {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin-bottom: 4px;
      line-height: var(--line-height-normal);
    }

    .hotspot-action {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      font-style: italic;
    }

    .hotspot-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-generous);
      text-align: center;
      color: var(--color-text-tertiary);
    }

    .empty-icon {
      font-size: 32px;
      margin-bottom: var(--spacing-compact);
      opacity: 0.5;
    }

    .empty-title {
      font-size: var(--font-size-md);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-secondary);
      margin-bottom: 4px;
    }

    .empty-message {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HotspotsListComponent {
  data = input.required<HotspotsData>();
  hotspotClicked = output<Hotspot>();

  onHotspotClick(hotspot: Hotspot): void {
    this.hotspotClicked.emit(hotspot);
  }
}
