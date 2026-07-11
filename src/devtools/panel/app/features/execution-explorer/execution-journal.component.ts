/**
 * Execution Journal Component (REDESIGNED - Tree Structure)
 * 
 * New design: Shows chapters (business domains) as collapsible tree.
 * 
 * Structure:
 * ① ▼ Revenue Module        (320ms) ███████████
 *    ├─ Revenue API
 *    ├─ Revenue Store
 *    ├─ Revenue Signal
 *    └─ RevenueChart Rendered
 * ② ▼ Orders Module         (450ms) ████████████████████
 *    ├─ Orders API
 *    ...
 * 
 * Input: ExecutionNarrative with chapters
 * Output: (chapterSelected) or (stepSelected) events
 */

import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Chapter, Subsection } from '../../../../../types/execution-narrative';

@Component({
  selector: 'app-execution-journal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="h-full flex flex-col bg-gray-900 text-2xs overflow-hidden">
      <!-- Ultra-compact header -->
      <div class="px-2 py-0.5 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <span class="font-semibold text-gray-100">📖 Execution Story</span>
      </div>

      <!-- Chapters tree -->
      <div class="flex-1 overflow-y-auto overflow-x-hidden">
        @for (chapter of chapters; track chapter.id) {
          <!-- Chapter Row -->
          <div 
            class="border-b border-gray-700 cursor-pointer hover:bg-gray-800/50 transition-colors"
            (click)="toggleChapter(chapter.id)"
          >
            <!-- Chapter Header -->
            <div class="px-2 py-0.5 flex items-center gap-1 bg-gray-850">
              <!-- Expand/Collapse Arrow -->
              <span class="text-xs w-4 flex-shrink-0">
                {{ isChapterExpanded(chapter.id) ? '▼' : '▶' }}
              </span>

              <!-- Sequence Number -->
              <span class="font-semibold text-blue-400 w-4 flex-shrink-0">
                {{ chapter.sequenceNumber }}
              </span>

              <!-- Domain Icon + Name -->
              <span class="text-xs flex-shrink-0">{{ chapter.domain.icon }}</span>
              <span class="text-gray-100 font-semibold truncate flex-1">
                {{ chapter.domain.name }} Module
              </span>

              <!-- Duration -->
              <span class="text-gray-400 flex-shrink-0">{{ chapter.duration }}ms</span>

              <!-- Progress bar (percentage of total time) -->
              @if (totalDuration > 0) {
                <div class="w-12 h-1 bg-gray-700 rounded flex-shrink-0 overflow-hidden">
                  <div 
                    class="h-full bg-blue-500"
                    [style.width.%]="(chapter.duration / totalDuration) * 100"
                  ></div>
                </div>
              }
            </div>

            <!-- Subsections (expandable) -->
            @if (isChapterExpanded(chapter.id)) {
              <div class="bg-gray-900">
                @for (subsection of chapter.subsections; track subsection.id) {
                  <div 
                    class="px-6 py-0.5 border-l-2 border-gray-700 text-gray-300 hover:bg-gray-800/30 cursor-pointer"
                    (click)="onSubsectionClick(subsection, $event)"
                  >
                    <!-- Subsection Icon + Label + Duration -->
                    <div class="flex items-center gap-1">
                      <span class="text-xs flex-shrink-0">{{ subsection.icon }}</span>
                      <span class="truncate flex-1">{{ subsection.label }}</span>
                      @if (subsection.duration) {
                        <span class="text-gray-500 flex-shrink-0">{{ subsection.duration }}ms</span>
                      }
                    </div>

                    <!-- Implementation detail (smaller text) -->
                    <div class="text-2xs text-gray-500 truncate ml-4">
                      {{ subsection.implementation }}
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }

        @if (chapters.length === 0) {
          <div class="p-2 text-center text-gray-500">No chapters</div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionJournalComponent {
  @Input() chapters: Chapter[] = [];
  @Input() totalDuration = 0;
  @Input() selectedChapterId: string | null = null;

  @Output() chapterSelected = new EventEmitter<Chapter>();
  @Output() subsectionSelected = new EventEmitter<Subsection>();

  // UI state for expanded chapters
  private expandedChapters = signal<Set<string>>(new Set());

  toggleChapter(chapterId: string): void {
    const expanded = new Set(this.expandedChapters());
    if (expanded.has(chapterId)) {
      expanded.delete(chapterId);
    } else {
      expanded.add(chapterId);
    }
    this.expandedChapters.set(expanded);
  }

  isChapterExpanded(chapterId: string): boolean {
    return this.expandedChapters().has(chapterId);
  }

  onSubsectionClick(subsection: Subsection, event: Event): void {
    event.stopPropagation();
    this.subsectionSelected.emit(subsection);
  }
}
