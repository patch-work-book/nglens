/**
 * Inspector Panel Component (REDESIGNED - Causality-Focused)
 * 
 * New focus: Show WHY (causality chain) instead of WHAT (metrics).
 * 
 * Centerpiece: Timeline showing exact sequence
 * 0ms    → Revenue API initiated
 * 245ms  → Revenue API completed
 * 246ms  → Revenue Store updated
 * 247ms  → Revenue Signal emitted
 * 272ms  → RevenueChart re-rendered
 */

import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Chapter, Subsection } from '@nglens/types/execution-narrative';
import type { CausalityChain } from '../../../../services/causality-chain-detector.service';
import { CausalityNarrativeService } from '../../../../services/causality-narrative.service';

@Component({
  selector: 'app-inspector-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (chapter || subsection) {
      <div class="h-full flex flex-col bg-gray-900 text-2xs overflow-auto">
        <!-- Header: Chapter name -->
        <div class="px-2 py-0.5 border-b border-gray-700 bg-gray-800 flex-shrink-0">
          <div class="flex items-center gap-2">
            <span class="text-xs">
              @if (chapter?.domain) {
                {{ chapter.domain.icon }}
              } @else if (subsection?.icon) {
                {{ subsection.icon }}
              } @else {
                📌
              }
            </span>
            <span class="font-semibold text-gray-100 truncate">
              @if (chapter?.domain) {
                {{ chapter.domain.name }}
              } @else if (subsection?.label) {
                {{ subsection.label }}
              } @else {
                Details
              }
            </span>
            <span class="text-gray-400 ml-auto flex-shrink-0">
              {{ chapter?.duration || subsection?.duration || 0 }}ms
            </span>
          </div>
        </div>

        <!-- Content: Causality narrative first -->
        <div class="flex-1 overflow-auto px-2 py-1 space-y-1 text-2xs">
          <!-- 🎯 WHAT TO LOOK AT (Priority) -->
          @if (chapter) {
            @if (getBottleneck(); as bottleneck) {
              <div class="bg-red-900/40 rounded px-2 py-1 border-l-2 border-red-500">
                <div class="font-semibold text-red-300 mb-0.5">🎯 What's Slow?</div>
                <div class="text-red-200 text-2xs">
                  <div class="font-semibold">{{ bottleneck.name }}</div>
                  <div class="text-red-300">{{ bottleneck.duration }}ms</div>
                  <div class="text-gray-400 text-2xs mt-0.5">
                    {{ getBottleneckReason(bottleneck) }}
                  </div>
                </div>
              </div>
            }
          }

          <!-- 🔗 WHY (Causality Timeline) - THE CENTERPIECE -->
          @if (chapter) {
            <div class="bg-gray-800 rounded px-2 py-1 border-l-2 border-blue-500">
              <div class="font-semibold text-blue-300 mb-0.5">🔗 What Happened</div>
              
              <!-- Timeline of causality -->
              <div class="space-y-0.5 font-mono text-2xs">
                @for (entry of causalityTimeline; track entry.time) {
                  <div class="flex items-start gap-1" [class.text-red-300]="isSlow(entry)">
                    <span class="text-gray-500 flex-shrink-0 w-8">{{ formatTime(entry.time) }}</span>
                    <span class="text-gray-400">→</span>
                    <span class="text-gray-300 flex-1">{{ entry.icon }} {{ entry.event }}</span>
                    @if (entry.duration) {
                      <span [class]="getDurationClass(entry.duration)" class="flex-shrink-0">
                        ({{ entry.duration }}ms)
                      </span>
                    }
                  </div>
                }
              </div>
            </div>
          }

          <!-- 📊 WHAT CHANGED (Data Changes) -->
          @if (chapter?.changes && chapter.changes.length > 0) {
            <div class="bg-gray-800 rounded px-2 py-1 border-l-2 border-yellow-500">
              <div class="font-semibold text-yellow-300 mb-0.5">📊 What Changed?</div>
              <div class="space-y-0.5">
                @for (change of chapter.changes.slice(0, 5); track change.field) {
                  <div class="text-gray-300 text-2xs">
                    <span class="font-semibold">{{ change.field }}</span>
                    <span class="text-gray-500 mx-1">{{ change.before }}</span>
                    <span class="text-gray-400">→</span>
                    <span class="text-green-300 mx-1">{{ change.after }}</span>
                  </div>
                }
                @if (chapter.changes.length > 5) {
                  <div class="text-gray-500 text-2xs">+{{ chapter.changes.length - 5 }} more</div>
                }
              </div>
            </div>
          }

          <!-- 👥 WHO CARES (Affected Components) -->
          @if (affectedComponents && affectedComponents.length > 0) {
            <div class="bg-gray-800 rounded px-2 py-1 border-l-2 border-purple-500">
              <div class="font-semibold text-purple-300 mb-0.5">👥 Who Cares?</div>
              <div class="flex flex-wrap gap-1">
                @for (comp of affectedComponents.slice(0, 5); track comp) {
                  <span class="bg-purple-600/30 text-purple-300 px-1.5 py-0.5 rounded text-2xs">
                    {{ comp }}
                  </span>
                }
                @if (affectedComponents.length > 5) {
                  <span class="text-gray-500 px-1.5 py-0.5 text-2xs">+{{ affectedComponents.length - 5 }}</span>
                }
              </div>
            </div>
          }

          <!-- ⚠️ OBSERVATIONS (Insights & Issues) -->
          @if (chapter?.observations && chapter.observations.length > 0) {
            <div class="bg-gray-800 rounded px-2 py-1 border-l-2 border-orange-500">
              <div class="font-semibold text-orange-300 mb-0.5">⚠️ Issues</div>
              <div class="space-y-0.5">
                @for (obs of chapter.observations.slice(0, 3); track obs) {
                  <div class="text-gray-300 text-2xs">• {{ obs }}</div>
                }
              </div>
            </div>
          }
        </div>
      </div>
    } @else {
      <div class="h-full flex items-center justify-center bg-gray-900 text-gray-500 text-2xs">
        Select a chapter
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorPanelComponent {
  @Input() chapter: Chapter | null = null;
  @Input() subsection: Subsection | null = null;
  @Input() causalityChain: CausalityChain | null = null;
  @Input() eventCount = 0;

  @Output() expandRawEvents = new EventEmitter<void>();

  private causalityNarrative = new CausalityNarrativeService();

  get causalityTimeline() {
    if (!this.causalityChain) return [];
    const narrative = this.causalityNarrative.generateNarrative(this.causalityChain);
    return narrative.timeline;
  }

  get affectedComponents(): string[] {
    return this.chapter?.affectedComponents || [];
  }

  // Identify the primary bottleneck in this chapter
  getBottleneck(): { name: string; duration: number } | null {
    if (!this.chapter || !this.causalityTimeline) return null;

    // Find the slowest step
    let slowest = { name: '', duration: 0, index: 0 };
    this.causalityTimeline.forEach((entry: any, idx: number) => {
      const duration = entry.duration || 0;
      if (duration > slowest.duration) {
        slowest = { name: entry.event, duration, index: idx };
      }
    });

    return slowest.duration > 0 ? { name: slowest.name, duration: slowest.duration } : null;
  }

  // Get reason why this is slow
  getBottleneckReason(bottleneck: { name: string; duration: number }): string {
    if (bottleneck.duration > 1000) {
      return 'This is much slower than normal. Check network or backend.';
    }
    if (bottleneck.duration > 500) {
      return 'This is slower than expected. Worth investigating.';
    }
    if (bottleneck.duration > 100) {
      return 'This is a bit slow. Might be optimizable.';
    }
    return 'This is the slowest part of this operation.';
  }

  // Check if a timeline entry is slow (> 100ms)
  isSlow(entry: any): boolean {
    return (entry.duration || 0) > 100;
  }

  // Get CSS class for duration display
  getDurationClass(duration: number): string {
    if (duration > 500) return 'text-red-400 font-semibold';
    if (duration > 100) return 'text-yellow-400';
    return 'text-gray-500';
  }

  formatTime(ms: number): string {
    return `${Math.round(ms)}ms`;
  }

  onExpandRawEvents(): void {
    this.expandRawEvents.emit();
  }
}
