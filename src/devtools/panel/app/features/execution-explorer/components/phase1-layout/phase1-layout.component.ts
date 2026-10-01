/**
 * Phase 1 Layout Component
 * 
 * Implements the hierarchical progressive disclosure pattern:
 * 1. Sticky Summary (always visible)
 * 2. Hero/Headline (5-second understanding)
 * 3. Hotspots (top 3-5 problems)
 * 4. Expandable sections (full details on demand)
 */
import { Component, input, output, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StickyExecutionSummaryComponent } from '../sticky-summary/sticky-summary.component';
import { ExecutionHeadlineComponent, type HeadlineData } from '../execution-headline/execution-headline.component';
import { HotspotsListComponent, type HotspotsData } from '../hotspots-list/hotspots-list.component';
import type { ExecutionNarrative } from '@nglens/types/execution-narrative';

@Component({
  selector: 'app-phase1-layout',
  standalone: true,
  imports: [CommonModule, StickyExecutionSummaryComponent, ExecutionHeadlineComponent, HotspotsListComponent],
  template: `
    <div class="phase1-container">
      <!-- STICKY SUMMARY (always visible) -->
      <app-sticky-summary 
        [metrics]="metrics()"
        (metricClicked)="onMetricFilter($event)" />

      <!-- HERO SECTION (Headline) -->
      @if (headline()) {
        <app-execution-headline [data]="headline()!" />
      }

      <!-- HOTSPOTS SECTION -->
      @if (hotspots()) {
        <div class="hotspots-section">
          <h2 class="section-header">Problems & Insights</h2>
          <app-hotspots-list 
            [data]="hotspots()!"
            (hotspotClicked)="onHotspotClick($event)" />
        </div>
      }

      <!-- EXPANDABLE SECTIONS -->
      <div class="expandable-sections">
        <button class="expand-button" 
                [class.expanded]="expandedSections().includes('tree')"
                (click)="toggleSection('tree')">
          <span class="expand-icon">{{ expandedSections().includes('tree') ? '▼' : '▶' }}</span>
          Component Tree ({{ componentCount() }} components)
        </button>
        @if (expandedSections().includes('tree')) {
          <div class="section-content">
            <!-- Component tree will be inserted here -->
            <div class="placeholder">Component tree section</div>
          </div>
        }

        <button class="expand-button" 
                [class.expanded]="expandedSections().includes('apis')"
                (click)="toggleSection('apis')">
          <span class="expand-icon">{{ expandedSections().includes('apis') ? '▼' : '▶' }}</span>
          API Execution Phases ({{ apiCount() }} calls)
        </button>
        @if (expandedSections().includes('apis')) {
          <div class="section-content">
            <!-- API timeline will be inserted here -->
            <div class="placeholder">API execution phases section</div>
          </div>
        }

        <button class="expand-button" 
                [class.expanded]="expandedSections().includes('events')"
                (click)="toggleSection('events')">
          <span class="expand-icon">{{ expandedSections().includes('events') ? '▼' : '▶' }}</span>
          Raw Events ({{ eventCount() }} events)
        </button>
        @if (expandedSections().includes('events')) {
          <div class="section-content">
            <!-- Raw events will be inserted here -->
            <div class="placeholder">Raw events section</div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .phase1-container {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-generous);
      padding: var(--spacing-generous);
      padding-top: 0;
    }

    .hotspots-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-standard);
    }

    .section-header {
      margin: 0;
      font-size: var(--font-size-md);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      line-height: var(--line-height-tight);
    }

    .expandable-sections {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-tight);
    }

    .expand-button {
      display: flex;
      align-items: center;
      gap: var(--spacing-compact);
      padding: var(--spacing-compact) var(--spacing-standard);
      background-color: var(--color-bg-secondary);
      border: 1px solid var(--color-border-default);
      border-radius: var(--border-radius-medium);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      transition: all var(--transition-normal);
      text-align: left;
    }

    .expand-button:hover {
      background-color: var(--color-bg-tertiary);
      border-color: var(--color-border-subtle);
    }

    .expand-button.expanded {
      background-color: var(--color-bg-tertiary);
      border-color: var(--color-info);
    }

    .expand-icon {
      font-size: 0.8em;
      opacity: 0.7;
      flex-shrink: 0;
    }

    .section-content {
      padding: var(--spacing-standard);
      background-color: var(--color-bg-secondary);
      border: 1px solid var(--color-border-default);
      border-top: none;
      border-radius: 0 0 var(--border-radius-medium) var(--border-radius-medium);
    }

    .placeholder {
      padding: var(--spacing-standard);
      text-align: center;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xs);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Phase1LayoutComponent {
  narrative = input<ExecutionNarrative | null>(null);
  sectionClicked = output<string>();

  // UI state
  readonly expandedSections = signal<string[]>([]);

  // Computed metrics
  readonly metrics = computed(() => {
    const n = this.narrative();
    if (!n) {
      return {
        totalTime: 0,
        slowRenderCount: 0,
        warningCount: 0,
        retryCount: 0,
      };
    }

    return {
      totalTime: n.duration || 0,
      slowRenderCount: 0, // Derived from insights
      warningCount: n.insights?.length || 0,
      retryCount: 0, // Derived from observations
    };
  });

  readonly headline = computed(() => {
    const n = this.narrative();
    if (!n) return null;

    return {
      headline: n.title || 'Execution analysis',
      reason: n.executionNarrative?.split('.')[0] || 'Execution occurred',
      impact: `${n.metrics.totalComponents || 0} components affected`,
      assessment: {
        status: n.duration > 500 ? 'slow' : n.insights?.length > 0 ? 'warning' : 'fast',
        message: this.assessmentMessage(n),
      },
    } as HeadlineData;
  });

  readonly hotspots = computed((): HotspotsData | null => {
    const n = this.narrative();
    if (!n) {
      return null;
    }

    return {
      slowRenders: n.chapters?.slice(0, 3).map((c: any, i: number) => ({
        id: `slow-${i}`,
        component: c.domain?.name || 'Unknown',
        metric: `${c.metrics?.totalRenders || 0}x, ${c.duration.toFixed(0)}ms`,
        reason: c.summary || 'Chapter execution',
        action: c.duration > 500 ? 'Slower than expected' : 'Normal',
        severity: 'slow' as const,
      })) || [],
      warnings: n.insights?.slice(0, 2).map((w: any, i: number) => ({
        id: `warn-${i}`,
        component: w.type || 'Insight',
        metric: '1',
        reason: w.message || 'Issue detected',
        action: 'Review needed',
        severity: 'warning' as const,
      })) || [],
      info: [],
    };
  });

  readonly componentCount = computed(() => this.narrative()?.metrics.totalComponents || 0);
  readonly apiCount = computed(() => this.narrative()?.metrics.totalApiCalls || 0);
  readonly eventCount = computed(() => this.narrative()?.chapters?.length || 0);

  toggleSection(section: string): void {
    const sections = this.expandedSections();
    if (sections.includes(section)) {
      this.expandedSections.set(sections.filter(s => s !== section));
    } else {
      this.expandedSections.set([...sections, section]);
    }
  }

  onMetricFilter(metric: string): void {
    this.sectionClicked.emit(`filter:${metric}`);
  }

  onHotspotClick(hotspot: any): void {
    this.sectionClicked.emit(`hotspot:${hotspot.id}`);
  }

  private assessmentMessage(narrative: ExecutionNarrative): string {
    const time = narrative.duration || 0;
    if (time > 500) {
      return `${time.toFixed(0)}ms (slow, expected <500ms)`;
    } else if (time > 100) {
      return `${time.toFixed(0)}ms (warning)`;
    } else {
      return `${time.toFixed(0)}ms (good)`;
    }
  }
}
