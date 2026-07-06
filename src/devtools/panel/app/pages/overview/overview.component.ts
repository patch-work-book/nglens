import { Component, inject, computed, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { PanelState } from '../../state/panel.state';
import { displayName } from '../../utils/display-name';
import {
  buildRecommendationActions,
  confidenceClass,
  difficultyClass,
  gainClass,
  topQuickWins,
  type RecommendationAction,
} from '../../utils/recommendation-actions';
import type { ComponentHotspot, SnapshotComparison, Issue } from '../../../../../types/panel';

interface HealthSummary {
  label: string;
  detail: string;
  className: string;
  bannerClass: string;
  icon: string;
}

interface CompareMetric {
  label: string;
  baseline: string;
  current: string;
  delta: string;
  verdict: 'better' | 'worse' | 'same';
}

type EvidenceTab = 'hotspots' | 'environment' | 'compare';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [NgClass],
  template: `
    <div class="h-full overflow-auto flex flex-col">

      <!-- ═══════════════════════════════════════════════════════════════════════
           TIER 1: STATUS BANNER — Immediate health at a glance
           ═══════════════════════════════════════════════════════════════════════ -->
      <section class="status-banner" [ngClass]="healthSummary().bannerClass">
        <div class="flex items-center gap-3 px-4 py-2.5">
          <span class="text-lg flex-shrink-0">{{ healthSummary().icon }}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-bold" [ngClass]="healthSummary().className">
                {{ healthSummary().label }}
              </h2>
              @if (bannerIssueSummary(); as summary) {
                <span class="text-xs text-gray-300 truncate">— {{ summary }}</span>
              }
            </div>
            <p class="text-[11px] text-gray-400 mt-0.5 truncate">{{ healthSummary().detail }}</p>
          </div>

          <!-- Key numbers -->
          <div class="flex gap-3 text-center flex-shrink-0">
            <div class="banner-metric">
              <strong [ngClass]="scoreClass(highestHotspotScore())">{{ highestHotspotScore() }}</strong>
              <span>Risk</span>
            </div>
            <div class="banner-metric">
              <strong>{{ issuesCount() }}</strong>
              <span>Issues</span>
            </div>
            <div class="banner-metric">
              <strong>{{ actions().length }}</strong>
              <span>Fixes</span>
            </div>
          </div>

          <!-- Action buttons -->
          @if (hasActivity() && topHotspots().length > 0) {
            <div class="flex gap-1.5 flex-shrink-0">
              <button type="button" class="cta-button primary text-[10px] py-1 px-2" (click)="navigateToComponent(topHotspots()[0].componentName)">
                Investigate
              </button>
              <button type="button" class="cta-button text-[10px] py-1 px-2" (click)="goToTab('recommendations')">
                Recommendations
              </button>
            </div>
          }
        </div>
      </section>

      <!-- ═══════════════════════════════════════════════════════════════════════
           TIER 2: HINTS — Collapsible, one-line summaries pointing to the right tab
           ═══════════════════════════════════════════════════════════════════════ -->
      <section class="flex-1 p-3 space-y-2 overflow-auto">

        @if (!hasActivity()) {
          <div class="border border-dashed border-gray-700 rounded p-5 bg-gray-800/30 text-center">
            <div class="text-sm text-gray-300 font-medium">No tracking data yet</div>
            <p class="text-xs text-gray-400 mt-1">
              Click <strong>Start</strong>, use your Angular page, then return here.
            </p>
          </div>
        } @else {

          <!-- HINT: Top Issue -->
          @if (topHotspots()[0]; as hotspot) {
            <div class="hint-card">
              <button type="button" class="hint-header" (click)="toggleSection('issue')">
                <span class="hint-icon" [ngClass]="scoreClass(hotspot.score)">{{ expanded().issue ? '▼' : '▶' }}</span>
                <span class="hint-label">Top Issue</span>
                <span class="flex-1 text-xs text-gray-200 truncate">
                  {{ displayName(hotspot.componentName) }} — {{ hotspot.rendersPerMinute.toFixed(0) }}/min from {{ formatCauses(hotspot.primaryCause) }}
                </span>
                <span class="hint-badge" [ngClass]="scoreClass(hotspot.score)">{{ hotspot.score }}/100</span>
                <button type="button" class="hint-go" (click)="navigateToComponentInRenderTab(hotspot.componentName); $event.stopPropagation()">Go →</button>
              </button>
              @if (expanded().issue) {
                <div class="hint-body">
                  <div class="grid grid-cols-4 gap-3 text-xs">
                    <div><span class="text-gray-500">Renders</span><br><strong>{{ hotspot.renderCount }}</strong></div>
                    <div><span class="text-gray-500">Rate</span><br><strong>{{ hotspot.rendersPerMinute.toFixed(1) }}/min</strong></div>
                    <div><span class="text-gray-500">Avg Cost</span><br><strong>{{ hotspot.averageDuration.toFixed(1) }}ms</strong></div>
                    <div><span class="text-gray-500">Cause</span><br><strong [ngClass]="scoreClass(hotspot.score)">{{ formatCauses(hotspot.primaryCause) }}</strong></div>
                  </div>
                  @if (topIssue(); as issue) {
                    <p class="text-[11px] text-gray-400 mt-2">{{ issue.description }}</p>
                  }
                </div>
              }
            </div>
          }

          <!-- HINT: Quick Fix -->
          @if (topAction(); as action) {
            <div class="hint-card">
              <button type="button" class="hint-header" (click)="toggleSection('fix')">
                <span class="hint-icon text-green-400">{{ expanded().fix ? '▼' : '▶' }}</span>
                <span class="hint-label">Fix</span>
                <span class="flex-1 text-xs text-gray-200 truncate">
                  {{ action.title }} → {{ displayName(action.componentName) }}
                </span>
                <span class="badge" [ngClass]="gainClass(action.expectedGain)">{{ action.expectedGain }}</span>
                <button type="button" class="hint-go" (click)="goToTab('recommendations'); $event.stopPropagation()">Go →</button>
              </button>
              @if (expanded().fix) {
                <div class="hint-body">
                  <div class="flex gap-4 text-xs">
                    <span>Difficulty: <strong [ngClass]="difficultyClass(action.difficulty)">{{ action.difficulty }}</strong></span>
                    <span>Confidence: <strong [ngClass]="confidenceClass(action.confidence)">{{ action.confidence }}</strong></span>
                  </div>
                  <p class="text-[11px] text-gray-400 mt-1">{{ action.suggestedFix }}</p>
                </div>
              }
            </div>
          }

          <!-- HINT: Memory -->
          @if (memoryRiskCount() > 0) {
            <div class="hint-card">
              <button type="button" class="hint-header" (click)="goToTab('memory')">
                <span class="hint-icon text-red-400">⚠</span>
                <span class="hint-label">Memory</span>
                <span class="flex-1 text-xs text-gray-200">{{ memoryRiskCount() }} cleanup risk(s) — missing teardown</span>
                <button type="button" class="hint-go">Go →</button>
              </button>
            </div>
          }

          <!-- HINT: Environment -->
          <div class="hint-card">
            <button type="button" class="hint-header" (click)="toggleSection('env')">
              <span class="hint-icon" [ngClass]="environmentHealthClass()">{{ expanded().env ? '▼' : '▶' }}</span>
              <span class="hint-label">Environment</span>
              <span class="flex-1 text-xs truncate" [ngClass]="environmentHealthClass()">{{ environmentProfile() }}</span>
              <span class="text-[10px] text-gray-500">{{ idleCdRate() }}/sec idle · {{ activeZoneSources().length }} zone</span>
            </button>
            @if (expanded().env) {
              <div class="hint-body">
                <div class="grid grid-cols-3 gap-3 text-xs">
                  <div><span class="text-gray-500">Idle CD Rate</span><br><strong>{{ idleCdRate() }}/sec</strong></div>
                  <div><span class="text-gray-500">Zone Pollution</span><br><strong>{{ activeZoneSources().length }} source(s)</strong></div>
                  <div><span class="text-gray-500">Active Streams</span><br><strong>{{ state.interactionProfiles().length }}</strong></div>
                </div>
                @if (activeZoneSources().length > 0) {
                  <div class="mt-2 text-[11px] text-gray-400">
                    Sources: {{ activeZoneSources()[0].source }}@if (activeZoneSources().length > 1) {, +{{ activeZoneSources().length - 1 }} more}
                  </div>
                }
              </div>
            }
          </div>

          <!-- ═══════════════════════════════════════════════════════════════════
               TIER 3: EVIDENCE TABS — Hotspots list + Compare Runs
               ═══════════════════════════════════════════════════════════════════ -->
          <div class="border border-gray-800 rounded bg-gray-900 overflow-hidden">
            <!-- Tab bar -->
            <div class="flex border-b border-gray-800 overflow-x-auto">
              @for (tab of evidenceTabs; track tab.id) {
                <button
                  type="button"
                  class="tab-button"
                  [ngClass]="{'tab-active': activeEvidenceTab() === tab.id}"
                  (click)="activeEvidenceTab.set(tab.id)"
                >
                  {{ tab.label }}
                  @if (tab.count() > 0) {
                    <span class="tab-badge">{{ tab.count() }}</span>
                  }
                </button>
              }
            </div>

            <!-- Tab content -->
            <div class="p-4">

              <!-- HOTSPOTS TAB -->
              @if (activeEvidenceTab() === 'hotspots') {
                @if (state.componentHotspots().length === 0) {
                  <div class="text-sm text-gray-500">No component hotspots in this recording.</div>
                } @else {
                  <div class="divide-y divide-gray-800">
                    @for (hotspot of state.componentHotspots().slice(0, 10); track hotspot.componentName; let i = $index) {
                      <button type="button" (click)="selectHotspot(hotspot)" class="w-full text-left py-3 hover:bg-gray-800/40 transition-colors flex items-start gap-3">
                        <div class="rank-pill" [ngClass]="scoreClass(hotspot.score)">{{ i + 1 }}</div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <div class="text-sm font-medium text-gray-100 truncate flex items-center gap-2">
                                <span>{{ displayName(hotspot.componentName) }}</span>
                                @if (hotspot.route) {
                                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/45 text-indigo-300 border border-indigo-900/30 uppercase font-semibold">
                                    🧭 {{ hotspot.route }}
                                  </span>
                                }
                              </div>
                              <div class="text-xs text-gray-500 mt-0.5 truncate">{{ hotspot.reasons.join(', ') }}</div>
                            </div>
                            <div class="text-right flex-shrink-0">
                              <div class="text-sm font-bold" [ngClass]="scoreClass(hotspot.score)">{{ hotspot.score }}/100</div>
                              <div class="text-[10px] text-gray-500">{{ causeLabel(hotspot.primaryCause) }}</div>
                            </div>
                          </div>
                          <div class="flex gap-2 mt-2 text-xs">
                            <span class="evidence-chip">{{ hotspot.renderCount }} renders</span>
                            <span class="evidence-chip">{{ hotspot.rendersPerMinute.toFixed(1) }}/min</span>
                            <span class="evidence-chip">{{ hotspot.averageDuration.toFixed(1) }}ms avg</span>
                          </div>
                        </div>
                      </button>
                    }
                  </div>
                }
              }

              <!-- ENVIRONMENT TAB -->
              @if (activeEvidenceTab() === 'environment') {
                <div class="space-y-4">
                  <!-- Raw metrics (moved from top-level) -->
                  <div>
                    <div class="text-xs font-semibold text-gray-400 uppercase mb-2">Recording Metrics</div>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <div class="metric-cell">
                        <span>Recorded renders</span>
                        <strong>{{ state.renderEvents().length }}</strong>
                        <small>events captured</small>
                      </div>
                      <div class="metric-cell">
                        <span>Components seen</span>
                        <strong>{{ componentsCount() }}</strong>
                        <small>rendered at least once</small>
                      </div>
                      <div class="metric-cell">
                        <span>Render frequency</span>
                        <strong>{{ renderRate() }}/min</strong>
                        <small>all components</small>
                      </div>
                      <div class="metric-cell">
                        <span>Avg render cost</span>
                        <strong>{{ averageRenderDuration() }}ms</strong>
                        <small>per captured render</small>
                      </div>
                      <div class="metric-cell">
                        <span>Cleanup risks</span>
                        <strong>{{ memoryRiskCount() }}</strong>
                        <small>missing teardown</small>
                      </div>
                      <div class="metric-cell">
                        <span>Action windows</span>
                        <strong>{{ interactionsCount() }}</strong>
                        <small>render bursts grouped</small>
                      </div>
                    </div>
                  </div>

                  <!-- Zone pollution details -->
                  @if (activeZoneSources().length > 0) {
                    <div>
                      <div class="text-xs font-semibold text-gray-400 uppercase mb-2">Zone Pollution Sources</div>
                      <div class="space-y-2">
                        @for (source of activeZoneSources(); track source.source) {
                          <div class="p-2 border border-amber-500/30 bg-amber-500/5 rounded">
                            <div class="text-xs font-medium text-amber-300">{{ source.source }}</div>
                            <div class="text-[11px] text-gray-400 mt-1">
                              {{ source.cdCyclesPerMinute.toFixed(1) }} CD cycles/min
                              &middot; Severity: {{ source.severity }}
                            </div>
                            @if (source.fixSuggestion) {
                              <div class="text-[11px] text-gray-300 mt-1">Fix: {{ source.fixSuggestion }}</div>
                            }
                          </div>
                        }
                      </div>
                    </div>
                  }

                  <!-- Environment recommendation -->
                  <div>
                    <div class="text-xs font-semibold text-gray-400 uppercase mb-2">System Recommendation</div>
                    <p class="text-xs text-gray-300 leading-relaxed">{{ state.environmentRecommendation() }}</p>
                  </div>
                </div>
              }

              <!-- COMPARE RUNS TAB -->
              @if (activeEvidenceTab() === 'compare') {
                <div class="space-y-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <p class="text-xs text-gray-500">{{ comparisonStatus() }}</p>
                    <div class="flex flex-wrap gap-1.5">
                      <button type="button" class="cta-button" (click)="saveBaseline()">Save Baseline</button>
                      <button
                        type="button"
                        class="cta-button"
                        [class.opacity-50]="state.snapshots().length === 0"
                        [disabled]="state.snapshots().length === 0"
                        (click)="captureCurrent()"
                      >Capture Current</button>
                      @if (state.snapshots().length > 0) {
                        <button type="button" class="cta-button muted" (click)="resetComparison()">Reset</button>
                      }
                    </div>
                  </div>

                  @if (state.latestComparison(); as comparison) {
                    <table class="w-full text-xs">
                      <thead>
                        <tr class="text-gray-500 border-b border-gray-800">
                          <th class="text-left py-2 px-2 font-medium">Metric</th>
                          <th class="text-right py-2 px-2 font-medium">{{ comparison.baseline.label }}</th>
                          <th class="text-right py-2 px-2 font-medium">{{ comparison.current.label }}</th>
                          <th class="text-right py-2 px-2 font-medium">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (metric of comparisonMetrics(comparison); track metric.label) {
                          <tr class="border-b border-gray-900 last:border-b-0">
                            <td class="py-2 px-2 text-gray-300 font-medium">{{ metric.label }}</td>
                            <td class="py-2 px-2 text-right text-gray-400">{{ metric.baseline }}</td>
                            <td class="py-2 px-2 text-right text-gray-200">{{ metric.current }}</td>
                            <td class="py-2 px-2 text-right" [title]="metricWhyLabel(metric.label, metric.verdict)">
                              <span class="change-pill" [ngClass]="changeClass(metric.verdict)">{{ metric.delta }}</span>
                              <span class="text-[10px] font-medium ml-1" [ngClass]="verdictClass(metric.verdict)">{{ verdictLabel(metric.verdict) }}</span>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  } @else {
                    <div class="text-xs text-gray-400 bg-gray-800/40 border border-gray-700/50 rounded p-3 space-y-2">
                      <div class="font-semibold text-gray-200">How to use Compare Runs:</div>
                      <ol class="space-y-1 list-decimal list-inside">
                        <li><strong>Save Baseline</strong> — record current metrics as reference</li>
                        <li><strong>Make Changes</strong> — modify your component (OnPush, fix leak, etc.)</li>
                        <li><strong>Capture Current</strong> — record metrics after changes</li>
                        <li><strong>Review</strong> — green = improved, red = regressed</li>
                      </ol>
                    </div>
                  }
                </div>
              }

            </div>
          </div>
        }
      </section>
    </div>
  `,

  styles: [`
    /* ── TIER 1: Status Banner ── */
    .status-banner {
      border-bottom: 1px solid rgb(55 65 81 / 0.6);
      flex-shrink: 0;
    }
    .status-banner.banner-red {
      background: linear-gradient(135deg, rgb(127 29 29 / 0.25), rgb(17 24 39 / 0.95));
      border-left: 4px solid #ef4444;
    }
    .status-banner.banner-amber {
      background: linear-gradient(135deg, rgb(120 53 15 / 0.2), rgb(17 24 39 / 0.95));
      border-left: 4px solid #f59e0b;
    }
    .status-banner.banner-green {
      background: linear-gradient(135deg, rgb(6 78 59 / 0.15), rgb(17 24 39 / 0.95));
      border-left: 4px solid #10b981;
    }
    .status-banner.banner-neutral {
      background: rgb(17 24 39 / 0.85);
      border-left: 4px solid #6b7280;
    }

    .banner-metric {
      min-width: 44px;
    }
    .banner-metric strong {
      display: block;
      font-size: 15px;
      color: #f3f4f6;
      line-height: 1.2;
    }
    .banner-metric span {
      display: block;
      font-size: 9px;
      color: #9ca3af;
      text-transform: uppercase;
      font-weight: 600;
      margin-top: 1px;
    }

    /* ── CTA Buttons ── */
    .cta-button {
      border: 1px solid rgb(75 85 99 / 0.75);
      border-radius: 4px;
      color: #d1d5db;
      background: rgb(31 41 55 / 0.65);
      font-size: 11px;
      font-weight: 700;
      padding: 6px 10px;
      transition: background 120ms ease, border-color 120ms ease;
      cursor: pointer;
    }
    .cta-button:hover:not(:disabled) {
      background: rgb(55 65 81 / 0.85);
      border-color: rgb(96 165 250 / 0.55);
      color: #f3f4f6;
    }
    .cta-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .cta-button.primary {
      background: rgb(59 130 246 / 0.2);
      border-color: rgb(59 130 246 / 0.5);
      color: #93c5fd;
    }
    .cta-button.primary:hover:not(:disabled) {
      background: rgb(59 130 246 / 0.35);
      border-color: rgb(96 165 250 / 0.7);
    }
    .cta-button.muted {
      color: #9ca3af;
      background: rgb(17 24 39 / 0.45);
    }

    /* ── TIER 2: Hint Cards (collapsible) ── */
    .hint-card {
      background: rgb(17 24 39 / 0.5);
      border: 1px solid rgb(55 65 81 / 0.5);
      border-radius: 6px;
      overflow: hidden;
    }
    .hint-header {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background 100ms;
      text-align: left;
    }
    .hint-header:hover {
      background: rgb(31 41 55 / 0.6);
    }
    .hint-icon {
      font-size: 9px;
      flex-shrink: 0;
      width: 12px;
    }
    .hint-label {
      font-size: 10px;
      font-weight: 700;
      color: #9ca3af;
      text-transform: uppercase;
      flex-shrink: 0;
      min-width: 60px;
    }
    .hint-badge {
      font-size: 11px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .hint-go {
      font-size: 10px;
      font-weight: 700;
      color: #93c5fd;
      background: rgb(59 130 246 / 0.15);
      border: 1px solid rgb(59 130 246 / 0.3);
      border-radius: 3px;
      padding: 2px 8px;
      flex-shrink: 0;
      cursor: pointer;
      transition: background 100ms;
    }
    .hint-go:hover {
      background: rgb(59 130 246 / 0.3);
    }
    .hint-body {
      padding: 8px 12px 12px 32px;
      border-top: 1px solid rgb(55 65 81 / 0.4);
    }

    /* ── TIER 3: Evidence Tabs ── */
    .tab-button {
      padding: 8px 14px;
      font-size: 11px;
      font-weight: 600;
      color: #9ca3af;
      border-bottom: 2px solid transparent;
      background: transparent;
      transition: color 120ms, border-color 120ms;
      white-space: nowrap;
      cursor: pointer;
    }
    .tab-button:hover {
      color: #d1d5db;
    }
    .tab-button.tab-active {
      color: #93c5fd;
      border-bottom-color: #3b82f6;
    }
    .tab-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      margin-left: 4px;
      padding: 0 4px;
      border-radius: 8px;
      background: rgb(55 65 81 / 0.7);
      font-size: 9px;
      font-weight: 700;
      color: #d1d5db;
    }

    /* ── Shared ── */
    .metric-cell {
      background: rgb(31 41 55 / 0.45);
      border: 1px solid rgb(55 65 81 / 0.55);
      border-radius: 4px;
      padding: 8px;
    }
    .metric-cell span {
      display: block;
      color: #9ca3af;
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .metric-cell strong {
      display: block;
      color: #f3f4f6;
      font-size: 14px;
      margin-top: 2px;
    }
    .metric-cell small {
      display: block;
      color: #6b7280;
      font-size: 10px;
      margin-top: 2px;
    }

    .rank-pill {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      border: 1px solid rgb(75 85 99 / 0.7);
      background: rgb(31 41 55 / 0.55);
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .evidence-chip {
      border: 1px solid rgb(75 85 99 / 0.55);
      border-radius: 4px;
      padding: 2px 6px;
      color: #d1d5db;
      background: rgb(17 24 39 / 0.45);
      font-size: 11px;
    }

    .badge {
      border: 1px solid rgb(75 85 99 / 0.55);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .change-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 56px;
      border-radius: 4px;
      border: 1px solid rgb(75 85 99 / 0.6);
      padding: 2px 6px;
      font-size: 11px;
      font-weight: 800;
    }
  `],
})

export class OverviewComponent {
  private readonly router = inject(Router);
  readonly state = inject(PanelState);
  readonly displayName = displayName;
  readonly confidenceClass = confidenceClass;
  readonly difficultyClass = difficultyClass;
  readonly gainClass = gainClass;

  // ── Collapse/Expand state ──
  readonly expanded = signal<{ issue: boolean; fix: boolean; env: boolean }>({ issue: false, fix: false, env: false });

  toggleSection(section: 'issue' | 'fix' | 'env'): void {
    this.expanded.update(s => ({ ...s, [section]: !s[section] }));
  }

  // ── Evidence Tab state ──
  readonly activeEvidenceTab = signal<EvidenceTab>('hotspots');

  readonly evidenceTabs = [
    { id: 'hotspots' as EvidenceTab, label: 'Hotspots', count: computed(() => this.state.componentHotspots().length) },
    { id: 'environment' as EvidenceTab, label: 'Environment', count: computed(() => this.activeZoneSources().length) },
    { id: 'compare' as EvidenceTab, label: 'Compare Runs', count: computed(() => this.state.snapshots().length) },
  ];

  // ── Core computed data ──
  readonly actions = computed(() => buildRecommendationActions({
    trackByIssues: this.state.trackByIssues(),
    onPushRecommendations: this.state.onPushRecommendations(),
    hotspots: this.state.componentHotspots(),
    zonePollutionSources: this.state.zonePollutionSources(),
    leakEvents: this.state.leakEvents(),
  }));

  readonly quickWins = computed(() => topQuickWins(this.actions(), 3));
  readonly topAction = computed(() => this.quickWins()[0] ?? this.actions()[0] ?? null);
  readonly topHotspots = computed(() => this.state.componentHotspots().slice(0, 5));

  readonly issuesCount = computed(() => this.state.allIssues().length);
  readonly componentsCount = computed(() => this.state.componentStats().length);
  readonly memoryRiskCount = computed(() => this.state.leakEvents().length);
  readonly interactionsCount = computed(() => this.state.interactionProfiles().length);
  readonly highestHotspotScore = computed(() => this.topHotspots()[0]?.score ?? 0);

  readonly hasActivity = computed(() =>
    this.state.renderEvents().length > 0 ||
    this.state.leakEvents().length > 0 ||
    this.state.trackByIssues().length > 0 ||
    this.state.onPushRecommendations().length > 0 ||
    this.state.zonePollutionSources().length > 0
  );

  // ── Environment computeds ──
  readonly idleCdRate = computed(() => {
    const events = this.state.renderEvents();
    if (events.length === 0) return 0;
    const idleEvents = events.filter(e => !e.interactionComponent);
    const first = events[0].timestamp;
    const last = events[events.length - 1].timestamp;
    const seconds = Math.max((last - first) / 1000, 1);
    return Number((idleEvents.length / seconds).toFixed(2));
  });

  readonly activeZoneSources = computed(() => {
    return this.state.zonePollutionSources().filter(source => source.severity !== 'low');
  });

  readonly environmentProfile = computed(() => {
    const idleRate = this.idleCdRate();
    const zoneSources = this.activeZoneSources().length;
    const hasHighActivity = idleRate > 5;
    const hasZonePollution = zoneSources > 0;

    if (hasZonePollution && hasHighActivity) return 'High Idle + Zone Pollution';
    if (hasZonePollution) return 'Zone Pollution Detected';
    if (hasHighActivity) return 'High Idle Activity';
    return 'Clean Environment';
  });

  readonly environmentHealthClass = computed(() => {
    const profile = this.environmentProfile();
    if (profile.includes('High Idle') && profile.includes('Zone')) return 'text-red-400';
    if (profile.includes('Zone') || profile.includes('High Idle')) return 'text-amber-400';
    return 'text-green-400';
  });

  // ── Issue computeds ──
  readonly topIssue = computed(() => {
    const criticalIssues = this.state.allIssues().filter(i => i.severity === 'CRITICAL');
    return criticalIssues[0] ?? null;
  });

  readonly impactEstimate = computed(() => {
    const topAction = this.topAction();
    if (!topAction) return 0;
    const match = topAction.expectedGain.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 15;
  });

  // ── Health Summary (Tier 1) ──
  readonly healthSummary = computed<HealthSummary>(() => {
    if (!this.hasActivity()) {
      return {
        label: 'Waiting for tracking data',
        detail: 'Start tracking, interact with your Angular page, then return here for analysis.',
        className: 'text-gray-200',
        bannerClass: 'banner-neutral',
        icon: '⏸',
      };
    }

    const topScore = this.topHotspots()[0]?.score ?? 0;
    const criticalMemory = this.state.leakEvents().some(e => e.severity === 'CRITICAL');
    const criticalZone = this.state.zonePollutionSources().some(s => s.severity === 'critical');

    if (topScore >= 90 || criticalMemory || criticalZone) {
      return {
        label: 'Critical Performance Issue',
        detail: 'Start with the highest-ranked fix. This recording contains a critical hotspot, zone trigger, or cleanup risk.',
        className: 'text-red-400',
        bannerClass: 'banner-red',
        icon: '🔴',
      };
    }

    if (topScore >= 70 || this.actions().length > 0) {
      return {
        label: 'Needs Review',
        detail: 'Actionable fixes ranked and ready. Start with quick wins for maximum impact.',
        className: 'text-amber-400',
        bannerClass: 'banner-amber',
        icon: '🟡',
      };
    }

    return {
      label: 'Healthy Performance',
      detail: 'No major hotspots detected. Keep this as a baseline before making changes.',
      className: 'text-green-400',
      bannerClass: 'banner-green',
      icon: '🟢',
    };
  });

  readonly bannerIssueSummary = computed<string | null>(() => {
    const hotspot = this.topHotspots()[0];
    if (!hotspot) return null;
    const cause = this.formatCauses(hotspot.primaryCause);
    const gain = this.impactEstimate();
    return `${displayName(hotspot.componentName)} renders ${hotspot.rendersPerMinute.toFixed(0)}x/min from ${cause}${gain > 0 ? ` — ${gain}% gain if fixed` : ''}`;
  });

  // ── Navigation ──
  goToTab(tab: 'memory' | 'recommendations' | 'rendering'): void {
    this.state.activeTab.set(tab as any);
    this.router.navigate(['/' + tab]);
  }

  navigateToComponent(name: string): void {
    this.state.selectedComponent.set(name);
  }

  navigateToComponentInRenderTab(name: string): void {
    this.state.selectedComponent.set(name);
    this.state.activeTab.set('rendering');
    this.router.navigate(['/rendering']);
  }

  selectHotspot(hotspot: ComponentHotspot): void {
    this.state.selectedComponent.set(hotspot.componentName);
  }

  selectAction(action: RecommendationAction): void {
    this.state.selectedComponent.set(action.componentName);
    const matchingIssue = this.state.allIssues().find(issue =>
      issue.id === action.id ||
      issue.id === `zone-pollution-${action.componentName}` ||
      issue.id === `hotspot-${action.componentName}`
    );
    if (matchingIssue) {
      this.state.selectedIssue.set(matchingIssue);
    }
  }

  // ── Compare Runs ──
  saveBaseline(): void {
    this.state.clearSnapshots();
    this.state.captureSnapshot('Baseline');
  }

  captureCurrent(): void {
    if (this.state.snapshots().length === 0) return;
    this.state.captureSnapshot('Current');
  }

  resetComparison(): void {
    this.state.clearSnapshots();
  }

  comparisonStatus(): string {
    const count = this.state.snapshots().length;
    if (count === 0) return 'Save a baseline before comparing a later run.';
    if (count === 1) return 'Baseline saved. Capture current after the next run.';
    return 'Lower render cost, risk, and cleanup counts are better.';
  }

  comparisonMetrics(comparison: SnapshotComparison): CompareMetric[] {
    const baseline = comparison.baseline.metrics;
    const current = comparison.current.metrics;
    const delta = comparison.delta;

    return [
      this.lowerIsBetter('Render events', baseline.renders, current.renders, delta.renders),
      this.lowerIsBetter('Render frequency', baseline.rendersPerMinute, current.rendersPerMinute, delta.rendersPerMinute, '/min'),
      this.lowerIsBetter('Avg render cost', baseline.averageRenderDuration, current.averageRenderDuration, delta.averageRenderDuration, 'ms'),
      this.lowerIsBetter('Total render cost', baseline.totalRenderDuration, current.totalRenderDuration, delta.totalRenderDuration, 'ms'),
      this.lowerIsBetter('Open risks', baseline.issues, current.issues, delta.issues),
      this.lowerIsBetter('Cleanup risks', baseline.leaks, current.leaks, delta.leaks),
      this.lowerIsBetter('Render hotspots', baseline.hotspots, current.hotspots, delta.hotspots),
    ];
  }

  // ── Formatting helpers ──
  renderRate(): string {
    const events = this.state.renderEvents();
    if (events.length === 0) return '0.0';
    const first = events[0].timestamp;
    const last = events[events.length - 1].timestamp;
    const minutes = Math.max((last - first) / 60000, 1 / 60);
    return (events.length / minutes).toFixed(1);
  }

  averageRenderDuration(): string {
    const events = this.state.renderEvents();
    if (events.length === 0) return '0.0';
    const total = events.reduce((sum, e) => sum + e.duration, 0);
    return (total / events.length).toFixed(1);
  }

  formatCauses(cause: string): string {
    const map: Record<string, string> = {
      zone: 'Zone Pollution',
      parent: 'Parent Cascade',
      input: 'Input Changes',
      signal: 'Signal Update',
      'manual-cd': 'Manual Trigger',
      unknown: 'Unknown',
    };
    return map[cause] || cause;
  }

  scoreClass(score: number): string {
    if (score >= 90) return 'text-red-400';
    if (score >= 70) return 'text-amber-400';
    if (score >= 40) return 'text-yellow-300';
    return 'text-green-400';
  }

  riskLabel(score: number): string {
    if (score >= 90) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 40) return 'watch';
    return 'low';
  }

  causeLabel(cause: ComponentHotspot['primaryCause']): string {
    switch (cause) {
      case 'signal': return 'Signal';
      case 'input': return 'Input';
      case 'zone': return 'Zone';
      case 'parent': return 'Cascade';
      case 'manual-cd': return 'Manual CD';
      default: return 'Unknown';
    }
  }

  changeClass(verdict: CompareMetric['verdict']): string {
    switch (verdict) {
      case 'better': return 'text-green-300 bg-green-500/15 border-green-500/30';
      case 'worse': return 'text-red-300 bg-red-500/15 border-red-500/30';
      case 'same': return 'text-gray-300 bg-gray-700/25 border-gray-600/60';
    }
  }

  verdictClass(verdict: CompareMetric['verdict']): string {
    switch (verdict) {
      case 'better': return 'text-green-400';
      case 'worse': return 'text-red-400';
      case 'same': return 'text-gray-400';
    }
  }

  verdictLabel(verdict: CompareMetric['verdict']): string {
    switch (verdict) {
      case 'better': return '✓ Better';
      case 'worse': return '✗ Worse';
      case 'same': return '— Same';
    }
  }

  metricWhyLabel(label: string, verdict: CompareMetric['verdict']): string {
    if (verdict === 'same') return '';
    const better = verdict === 'better';
    switch (label) {
      case 'Render events': return better ? 'Fewer total re-renders' : 'More components re-rendering';
      case 'Render frequency': return better ? 'Lower render rate per minute' : 'Higher render rate — longer recording may skew this';
      case 'Avg render cost': return better ? 'Each render is faster' : 'Each render takes longer';
      case 'Total render cost': return better ? 'Less total CPU time in renders' : 'More total CPU time spent rendering';
      case 'Open risks': return better ? 'Fewer issues detected' : 'New issues surfaced';
      case 'Cleanup risks': return better ? 'Fewer memory leak risks' : 'New teardown issues appeared';
      case 'Render hotspots': return better ? 'Fewer high-frequency components' : 'More components rendering excessively';
      default: return '';
    }
  }

  // ── Private helpers ──
  private lowerIsBetter(label: string, baseline: number, current: number, delta: number, unit = ''): CompareMetric {
    return {
      label,
      baseline: this.fmtValue(baseline, unit),
      current: this.fmtValue(current, unit),
      delta: this.fmtDelta(delta, unit),
      verdict: delta < 0 ? 'better' : delta > 0 ? 'worse' : 'same',
    };
  }

  private fmtValue(value: number, unit: string): string {
    const rounded = Math.abs(value) >= 10 || unit === ''
      ? Math.round(value).toString()
      : value.toFixed(1);
    return unit ? `${rounded}${unit}` : rounded;
  }

  private fmtDelta(value: number, unit: string): string {
    if (value === 0) return unit ? `0${unit}` : '0';
    const rounded = Math.abs(value) >= 10 || unit === ''
      ? Math.round(Math.abs(value)).toString()
      : Math.abs(value).toFixed(1);
    return `${value > 0 ? '+' : '-'}${rounded}${unit}`;
  }
}
