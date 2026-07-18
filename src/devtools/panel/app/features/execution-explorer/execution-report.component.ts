/**
 * Execution Report Component
 * 
 * Transforms Execution Explorer from an event viewer into an Execution Intelligence Report.
 * 
 * 5 flat sections (no nested trees):
 * 1. Interaction Summary (always visible)
 * 2. Problems (pinned, highest priority)
 * 3. Execution Journey (sequential card flow)
 * 4. Impact (blast radius)
 * 5. Recommendations (actionable fixes)
 * 
 * Design principles:
 * - Story-first, not event-first
 * - Surface problems before details
 * - Progressive disclosure via expandable cards
 * - Business language, not Angular internals
 * - 30-second understanding goal
 */

import { Component, Input, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ExecutionNarrative, Chapter, Subsection } from '@nglens/types/execution-narrative';

// ─── Report data models ───

export interface Problem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  relatedStepId?: string;
  duration?: number;
}

export interface JourneyStep {
  id: string;
  label: string;
  type: 'trigger' | 'api' | 'store' | 'signal' | 'render' | 'completed';
  icon: string;
  duration?: number;
  status?: 'slow' | 'warning' | 'ok';
  // Expanded card data
  detail?: string;
  implementation?: string;
  changes?: Array<{ key: string; before: string; after: string }>;
  triggered?: string[];
  reason?: string;
  recommendation?: string;
}

export interface ImpactMetric {
  label: string;
  count: number;
  icon: string;
}

export interface Recommendation {
  issue: string;
  fix: string;
  improvement: string;
}

@Component({
  selector: 'app-execution-report',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="report">
      
      <!-- ═══ 1. INTERACTION SUMMARY ═══ -->
      <div class="summary-bar">
        <div class="summary-title">{{ title() }}</div>
        <div class="summary-metrics">
          <span class="metric">{{ duration() }}ms</span>
          <span class="metric-sep">·</span>
          <div class="health" [class]="healthClass()">{{ score() }}/100</div>
        </div>
        <div class="summary-counts">
          @if (apiCount() > 0) { <span class="count">🌐 {{ apiCount() }} API{{ apiCount() > 1 ? 's' : '' }}</span> }
          @if (renderCount() > 0) { <span class="count">📦 {{ renderCount() }} Components</span> }
          @if (storeCount() > 0) { <span class="count">💾 {{ storeCount() }} Stores</span> }
          @if (signalCount() > 0) { <span class="count">⚡ {{ signalCount() }} Signals</span> }
        </div>
      </div>
      
      <!-- ═══ 2. PROBLEMS ═══ -->
      @if (problems().length > 0) {
        <div class="section">
          <div class="section-title">Problems</div>
          <div class="problems-list">
            @for (problem of problems(); track problem.id) {
              <div class="problem-row" [class]="'severity-' + problem.severity">
                <span class="problem-dot">{{ problem.severity === 'critical' ? '🔴' : problem.severity === 'warning' ? '🟠' : '🟡' }}</span>
                <span class="problem-text">{{ problem.title }}</span>
                @if (problem.duration) {
                  <span class="problem-dur">({{ problem.duration }}ms)</span>
                }
              </div>
            }
          </div>
        </div>
      }
      
      <!-- ═══ 3. EXECUTION JOURNEY ═══ -->
      <div class="section">
        <div class="section-title">Execution Journey</div>
        <div class="journey">
          @for (step of journey(); track step.id; let last = $last) {
            <!-- Journey Card -->
            <div class="journey-card" 
                 [class.is-slow]="step.status === 'slow'"
                 [class.is-warning]="step.status === 'warning'"
                 [class.is-expanded]="expandedCards().has(step.id)"
                 (click)="toggleCard(step.id)">
              <div class="card-header">
                <span class="card-icon">{{ step.icon }}</span>
                <span class="card-label">{{ step.label }}</span>
                @if (step.duration && step.duration > 0) {
                  <span class="card-dur" [class.slow]="step.status === 'slow'">{{ step.duration }}ms</span>
                }
                @if (step.status === 'slow') {
                  <span class="card-badge slow">Slow</span>
                } @else if (step.status === 'warning') {
                  <span class="card-badge warn">Warning</span>
                }
              </div>
              
              <!-- Expanded card details -->
              @if (expandedCards().has(step.id)) {
                <div class="card-body">
                  @if (step.implementation) {
                    <div class="card-row">
                      <span class="card-key">Request</span>
                      <code class="card-code">{{ step.implementation }}</code>
                    </div>
                  }
                  @if (step.duration && step.duration > 0) {
                    <div class="card-row">
                      <span class="card-key">Duration</span>
                      <span class="card-val" [class.slow]="step.status === 'slow'">{{ step.duration }}ms</span>
                    </div>
                  }
                  @if (step.reason) {
                    <div class="card-row">
                      <span class="card-key">Reason</span>
                      <span class="card-val">{{ step.reason }}</span>
                    </div>
                  }
                  @if (step.changes && step.changes.length > 0) {
                    <div class="card-subsection">
                      <span class="card-subheading">Changed</span>
                      @for (change of step.changes; track change.key) {
                        <div class="card-diff">
                          <span class="diff-key">{{ change.key }}</span>
                          <span class="diff-val">{{ change.before }} → {{ change.after }}</span>
                        </div>
                      }
                    </div>
                  }
                  @if (step.triggered && step.triggered.length > 0) {
                    <div class="card-subsection">
                      <span class="card-subheading">Triggered</span>
                      <div class="card-chips">
                        @for (t of step.triggered; track t) {
                          <span class="chip">{{ t }}</span>
                        }
                      </div>
                    </div>
                  }
                  @if (step.recommendation) {
                    <div class="card-rec">
                      💡 {{ step.recommendation }}
                    </div>
                  }
                </div>
              }
            </div>
            
            <!-- Arrow between cards -->
            @if (!last) {
              <div class="journey-arrow">↓</div>
            }
          }
        </div>
      </div>
      
      <!-- ═══ 4. IMPACT ═══ -->
      @if (impact().length > 0) {
        <div class="section">
          <div class="section-title">Impact</div>
          <div class="impact-grid">
            @for (metric of impact(); track metric.label) {
              <div class="impact-card">
                <span class="impact-icon">{{ metric.icon }}</span>
                <span class="impact-count">{{ metric.count }}</span>
                <span class="impact-label">{{ metric.label }}</span>
              </div>
            }
          </div>
        </div>
      }
      
      <!-- ═══ 5. RECOMMENDATIONS ═══ -->
      @if (recommendations().length > 0) {
        <div class="section">
          <div class="section-title">Recommendations</div>
          <div class="rec-list">
            @for (rec of recommendations(); track rec.issue) {
              <div class="rec-card">
                <div class="rec-issue">{{ rec.issue }}</div>
                <div class="rec-fix">💡 {{ rec.fix }}</div>
                @if (rec.improvement) {
                  <div class="rec-improve">Expected: {{ rec.improvement }}</div>
                }
              </div>
            }
          </div>
        </div>
      }
      
    </div>
  `,
  styles: [`
    .report {
      height: 100%;
      overflow-y: auto;
      background: rgb(17, 24, 39);
      color: rgb(209, 213, 219);
      font-size: 12px;
    }

    /* ═══ SUMMARY BAR ═══ */
    .summary-bar {
      padding: 12px 16px;
      background: rgb(31, 41, 55);
      border-bottom: 1px solid rgb(55, 65, 81);
    }
    .summary-title { font-size: 14px; font-weight: 600; color: white; margin-bottom: 6px; }
    .summary-metrics { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .metric { color: rgb(156, 163, 175); font-family: 'Monaco', 'Menlo', monospace; font-size: 11px; }
    .metric-sep { color: rgb(75, 85, 99); }
    .health {
      padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      &.good { background: rgba(34, 197, 94, 0.15); color: rgb(134, 239, 172); }
      &.warning { background: rgba(234, 179, 8, 0.15); color: rgb(253, 224, 71); }
      &.critical { background: rgba(239, 68, 68, 0.15); color: rgb(254, 202, 202); }
    }
    .summary-counts { display: flex; gap: 12px; flex-wrap: wrap; }
    .count { color: rgb(156, 163, 175); font-size: 11px; }

    /* ═══ SECTIONS ═══ */
    .section { padding: 12px 16px; border-bottom: 1px solid rgba(55, 65, 81, 0.5); }
    .section-title {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: rgb(107, 114, 128); margin-bottom: 10px;
    }

    /* ═══ PROBLEMS ═══ */
    .problems-list { display: flex; flex-direction: column; gap: 6px; }
    .problem-row {
      display: flex; align-items: center; gap: 8px; padding: 6px 10px;
      border-radius: 4px; background: rgba(30, 41, 59, 0.6);
      &.severity-critical { border-left: 3px solid rgb(239, 68, 68); }
      &.severity-warning { border-left: 3px solid rgb(234, 179, 8); }
      &.severity-info { border-left: 3px solid rgb(59, 130, 246); }
    }
    .problem-dot { font-size: 10px; }
    .problem-text { flex: 1; color: rgb(229, 231, 235); }
    .problem-dur { color: rgb(156, 163, 175); font-size: 10px; font-family: monospace; }

    /* ═══ JOURNEY ═══ */
    .journey { display: flex; flex-direction: column; align-items: stretch; }
    .journey-arrow { text-align: center; color: rgb(75, 85, 99); font-size: 14px; padding: 2px 0; }

    .journey-card {
      padding: 10px 12px; border-radius: 6px; cursor: pointer;
      border: 1px solid rgba(55, 65, 81, 0.6); background: rgba(30, 41, 59, 0.4);
      transition: all 0.15s;
      &:hover { border-color: rgba(99, 102, 241, 0.4); background: rgba(30, 41, 59, 0.7); }
      &.is-slow { border-color: rgba(239, 68, 68, 0.4); }
      &.is-warning { border-color: rgba(234, 179, 8, 0.4); }
      &.is-expanded { background: rgba(30, 41, 59, 0.8); border-color: rgba(99, 102, 241, 0.5); }
    }

    .card-header { display: flex; align-items: center; gap: 8px; }
    .card-icon { font-size: 14px; }
    .card-label { flex: 1; font-weight: 500; color: rgb(229, 231, 235); }
    .card-dur {
      font-family: 'Monaco', 'Menlo', monospace; font-size: 10px; color: rgb(156, 163, 175);
      &.slow { color: rgb(254, 202, 202); font-weight: 600; }
    }
    .card-badge {
      padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 600;
      &.slow { background: rgba(239, 68, 68, 0.2); color: rgb(254, 202, 202); }
      &.warn { background: rgba(234, 179, 8, 0.2); color: rgb(253, 224, 71); }
    }

    .card-body {
      margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(55, 65, 81, 0.5);
    }
    .card-row { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
    .card-key { color: rgb(107, 114, 128); font-size: 10px; min-width: 60px; }
    .card-val { color: rgb(209, 213, 219); font-size: 11px; &.slow { color: rgb(254, 202, 202); } }
    .card-code { color: rgb(165, 243, 252); font-family: monospace; font-size: 10px; }

    .card-subsection { margin-top: 6px; padding-top: 4px; border-top: 1px solid rgba(55, 65, 81, 0.3); }
    .card-subheading {
      display: block; font-size: 9px; font-weight: 600; text-transform: uppercase;
      color: rgb(107, 114, 128); letter-spacing: 0.3px; margin-bottom: 4px;
    }
    .card-diff { display: flex; justify-content: space-between; padding: 2px 0; font-size: 10px; }
    .diff-key { color: rgb(165, 243, 252); }
    .diff-val { color: rgb(134, 239, 172); font-family: monospace; }
    .card-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip {
      padding: 2px 6px; border-radius: 3px; font-size: 9px;
      background: rgba(99, 102, 241, 0.12); color: rgb(165, 180, 252);
      border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .card-rec {
      margin-top: 6px; padding: 4px 8px; border-radius: 3px;
      background: rgba(34, 197, 94, 0.08); color: rgb(134, 239, 172); font-size: 10px;
    }

    /* ═══ IMPACT ═══ */
    .impact-grid { display: flex; gap: 12px; flex-wrap: wrap; }
    .impact-card {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 12px; border-radius: 6px;
      background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(55, 65, 81, 0.5);
    }
    .impact-icon { font-size: 14px; }
    .impact-count { font-size: 16px; font-weight: 700; color: white; }
    .impact-label { font-size: 10px; color: rgb(156, 163, 175); }

    /* ═══ RECOMMENDATIONS ═══ */
    .rec-list { display: flex; flex-direction: column; gap: 8px; }
    .rec-card {
      padding: 10px 12px; border-radius: 6px;
      background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(55, 65, 81, 0.5);
    }
    .rec-issue { color: rgb(229, 231, 235); font-weight: 500; margin-bottom: 4px; }
    .rec-fix { color: rgb(134, 239, 172); font-size: 11px; }
    .rec-improve { color: rgb(156, 163, 175); font-size: 10px; margin-top: 4px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionReportComponent {
  @Input() set narrative(value: ExecutionNarrative | null) {
    this.narrativeData.set(value);
  }

  readonly narrativeData = signal<ExecutionNarrative | null>(null);
  readonly expandedCards = signal<Set<string>>(new Set());

  // ─── Computed data from narrative ───

  readonly title = computed(() => this.narrativeData()?.title || 'No interaction');
  readonly duration = computed(() => this.narrativeData()?.duration || 0);
  readonly score = computed(() => this.narrativeData()?.executionScore?.score || 0);

  readonly healthClass = computed(() => {
    const s = this.narrativeData()?.executionScore?.status;
    return s === 'good' ? 'good' : s === 'warning' ? 'warning' : 'critical';
  });

  readonly apiCount = computed(() => this.narrativeData()?.metrics?.totalApiCalls || 0);
  readonly renderCount = computed(() => this.narrativeData()?.metrics?.totalComponents || 0);
  readonly storeCount = computed(() => {
    const chapters = this.narrativeData()?.chapters || [];
    return chapters.reduce((sum, ch) => sum + ch.metrics.storeUpdates.count, 0);
  });
  readonly signalCount = computed(() => {
    const chapters = this.narrativeData()?.chapters || [];
    return chapters.reduce((sum, ch) => sum + ch.metrics.signalEmissions.count, 0);
  });

  // ─── Problems (derived from narrative insights + chapter observations) ───

  readonly problems = computed((): Problem[] => {
    const n = this.narrativeData();
    if (!n) return [];

    const problems: Problem[] = [];
    const seenTitles = new Set<string>();

    // From insights (deduplicate by title)
    n.insights?.forEach((insight, idx) => {
      const title = insight.title || insight.description || 'Issue detected';
      if (seenTitles.has(title)) return;
      seenTitles.add(title);
      
      problems.push({
        id: `insight-${idx}`,
        severity: insight.severity === 'critical' ? 'critical' : insight.severity === 'warning' ? 'warning' : 'info',
        title,
        detail: insight.description || '',
        duration: undefined,
      });
    });

    // From chapters: slow APIs (only if actually slow, not just any API)
    n.chapters.forEach(ch => {
      if (ch.metrics.apiCalls.totalDuration > 300) {
        const title = `${ch.domain.name} API slow (${ch.metrics.apiCalls.totalDuration}ms)`;
        if (!seenTitles.has(title)) {
          seenTitles.add(title);
          problems.push({
            id: `slow-api-${ch.id}`,
            severity: ch.metrics.apiCalls.totalDuration > 500 ? 'critical' : 'warning',
            title,
            detail: '',
            duration: ch.metrics.apiCalls.totalDuration,
          });
        }
      }
    });

    // Aggregate render problems (single entry, not per chapter)
    const totalSlowRenders = n.chapters.reduce((sum, ch) => sum + ch.metrics.componentRenders.slowRenders, 0);
    if (totalSlowRenders > 0 && !seenTitles.has('slow-renders')) {
      seenTitles.add('slow-renders');
      problems.push({
        id: 'slow-renders-aggregate',
        severity: totalSlowRenders > 3 ? 'critical' : 'warning',
        title: `${totalSlowRenders} component${totalSlowRenders > 1 ? 's' : ''} exceed 16ms render budget`,
        detail: '',
      });
    }

    // Sort: critical first, then warning, then info
    return problems.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    }).slice(0, 5);
  });

  // ─── Journey (from original execution story steps — has real names) ───

  readonly journey = computed((): JourneyStep[] => {
    const n = this.narrativeData();
    if (!n) return [];

    const steps: JourneyStep[] = [];

    // First step: trigger
    steps.push({
      id: 'trigger',
      label: n.trigger || 'User Action',
      type: 'trigger',
      icon: '👆',
    });

    // Use originalStory.steps — these have real component/API names
    const story = n.originalStory;
    if (story?.steps?.length > 0) {
      story.steps.forEach((step: any) => {
        const duration = step.duration || 0;
        const status: 'slow' | 'warning' | 'ok' = 
          duration > 300 ? 'slow' : duration > 100 ? 'warning' : 'ok';
        
        steps.push({
          id: step.id,
          label: step.title,
          type: this.mapStepType(step.type),
          icon: this.getStepIcon(step.type),
          duration: duration > 0 ? duration : undefined,
          status: duration > 0 ? status : 'ok',
          detail: step.summary || undefined,
          implementation: step.title,
          changes: step.changes?.modified?.length > 0 
            ? step.changes.modified.slice(0, 3).map((c: any) => ({
                key: c.key,
                before: c.oldValue || '',
                after: c.newValue || '',
              }))
            : undefined,
          triggered: step.impact?.directConsumers?.length > 0 
            ? step.impact.directConsumers.slice(0, 4) 
            : undefined,
          reason: step.rootCauseChain?.summary || undefined,
          recommendation: this.getStoryStepRecommendation(step, status),
        });
      });
    }

    // Last step: completed
    steps.push({
      id: 'completed',
      label: 'Completed',
      type: 'completed',
      icon: '✓',
      duration: n.duration,
    });

    return steps;
  });

  // ─── Impact ───

  readonly impact = computed((): ImpactMetric[] => {
    const n = this.narrativeData();
    if (!n) return [];

    const metrics: ImpactMetric[] = [];
    if (n.metrics.totalComponents > 0) metrics.push({ label: 'Components', count: n.metrics.totalComponents, icon: '📦' });
    if (this.storeCount() > 0) metrics.push({ label: 'Stores', count: this.storeCount(), icon: '💾' });
    if (this.signalCount() > 0) metrics.push({ label: 'Signals', count: this.signalCount(), icon: '⚡' });
    if (n.metrics.totalApiCalls > 0) metrics.push({ label: 'APIs', count: n.metrics.totalApiCalls, icon: '🌐' });
    return metrics;
  });

  // ─── Recommendations ───

  readonly recommendations = computed((): Recommendation[] => {
    const n = this.narrativeData();
    if (!n) return [];

    const recs: Recommendation[] = [];

    // Slow APIs (per chapter, but only if actually slow)
    n.chapters.forEach(ch => {
      if (ch.metrics.apiCalls.totalDuration > 300) {
        recs.push({
          issue: `${ch.domain.name} API is slow (${ch.metrics.apiCalls.totalDuration}ms)`,
          fix: 'Cache response or add loading state',
          improvement: `-${Math.round(ch.metrics.apiCalls.totalDuration * 0.6)}ms`,
        });
      }
    });

    // Aggregate excessive renders (single recommendation, not per chapter)
    const totalRenders = n.metrics.totalComponents || 0;
    if (totalRenders > 10) {
      recs.push({
        issue: `${totalRenders} component renders triggered`,
        fix: 'Use OnPush change detection or memoize inputs',
        improvement: `Reduce cascade to essential components`,
      });
    }

    // Slow renders (aggregate)
    const totalSlowRenders = n.chapters.reduce((sum, ch) => sum + ch.metrics.componentRenders.slowRenders, 0);
    if (totalSlowRenders > 0) {
      recs.push({
        issue: `${totalSlowRenders} component(s) exceed 16ms frame budget`,
        fix: 'Optimize template expressions or use trackBy in *ngFor',
        improvement: 'Sub-16ms render time per component',
      });
    }

    return recs.slice(0, 5);
  });

  // ─── Actions ───

  toggleCard(id: string): void {
    this.expandedCards.update(set => {
      const newSet = new Set(set);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  // ─── Helpers ───

  private getStepStatus(sub: Subsection): 'slow' | 'warning' | 'ok' {
    if (sub.duration && sub.duration > 300) return 'slow';
    if (sub.duration && sub.duration > 100) return 'warning';
    if (sub.isSlowOperation) return 'slow';
    return 'ok';
  }

  private mapSubsectionType(type: string): JourneyStep['type'] {
    switch (type) {
      case 'api': return 'api';
      case 'store': return 'store';
      case 'signal': case 'computed': return 'signal';
      case 'render': case 'component': return 'render';
      default: return 'render';
    }
  }

  private mapStepType(type: string): JourneyStep['type'] {
    switch (type) {
      case 'data-fetch': return 'api';
      case 'state-update': return 'store';
      case 'computation': return 'signal';
      case 'ui-update': return 'render';
      case 'user-interaction': return 'trigger';
      default: return 'render';
    }
  }

  private getStepIcon(type: string): string {
    switch (type) {
      case 'data-fetch': return '🌐';
      case 'state-update': return '💾';
      case 'computation': return '⚡';
      case 'ui-update': return '🎨';
      case 'user-interaction': return '👆';
      default: return '📌';
    }
  }

  private mapChapterType(chapter: Chapter): JourneyStep['type'] {
    if (chapter.metrics.apiCalls.count > 0) return 'api';
    if (chapter.metrics.storeUpdates.count > 0) return 'store';
    if (chapter.metrics.signalEmissions.count > 0) return 'signal';
    if (chapter.metrics.componentRenders.count > 0) return 'render';
    return 'render';
  }

  private getStoryStepRecommendation(step: any, status: string): string | undefined {
    if (status === 'ok') return undefined;
    switch (step.type) {
      case 'data-fetch': return 'Consider caching or request batching';
      case 'ui-update': return step.duration > 16 ? 'Optimize template or use OnPush' : undefined;
      case 'state-update': return 'Check for unnecessary subscriptions';
      default: return undefined;
    }
  }

  private getStepRecommendation(sub: Subsection, status: string): string | undefined {
    if (status === 'ok') return undefined;
    if (sub.type === 'api' && status === 'slow') return 'Consider caching or request batching';
    if (sub.type === 'render' && (sub.duration || 0) > 16) return 'Optimize template or use OnPush';
    if (sub.type === 'store' && status === 'slow') return 'Check for unnecessary store subscriptions';
    return undefined;
  }
}
