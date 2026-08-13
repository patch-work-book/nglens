/**
 * Execution Tree Component
 * 
 * Main orchestrator for the 4-level execution tree.
 * Inspector is now INLINE (Level 4 expands under the step node).
 * 
 * Layout:
 * ┌────────────────────────────────────┐
 * │ HEADER (Session + Metrics)         │
 * ├────────────────────────────────────┤
 * │ ▼ Dashboard Bootstrap              │
 * │   ├─ ▼ Load Revenue                │
 * │   │  ├─ ▼ GET /revenue (310ms)     │
 * │   │  │  ├─ 📖 What Happened?       │
 * │   │  │  ├─ ⏱️ Timeline             │
 * │   │  │  └─ 👥 Who Cares?           │
 * │   │  ├─ ▶ updateRevenue (10ms)     │
 * │   │  └─ ▶ RevenueChart (20ms)      │
 * │   └─ ...                           │
 * └────────────────────────────────────┘
 */

import { Component, inject, Input, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ExecutionNarrative } from '@nglens/types/execution-narrative';
import type { TreeNode } from '@nglens/types/execution-tree';
import { TreeNodeBuilderService } from '../../../services/tree-node-builder.service';
import { ExecutionTreeNodeComponent } from './node/execution-tree-node.component';

@Component({
  selector: 'app-execution-tree',
  standalone: true,
  imports: [CommonModule, ExecutionTreeNodeComponent],
  template: `
    <div class="h-full flex flex-col bg-gray-900 text-xs overflow-hidden">
      <!-- ═══ HEADER ═══ -->
      @if (root(); as root) {
        <div class="px-3 py-2 border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
          <div class="flex items-center gap-3 text-2xs">
            <span class="font-semibold text-gray-100">🎯 {{ root.label }}</span>
            <span class="text-gray-400">{{ root.duration }}ms</span>
            
            @if (narrativeData(); as n) {
              @if (n.metrics.totalApiCalls > 0) {
                <span class="text-gray-400">🌐 {{ n.metrics.totalApiCalls }} API</span>
              }
              @if (n.metrics.totalComponents > 0) {
                <span class="text-gray-400">📦 {{ n.metrics.totalComponents }} Renders</span>
              }
              <div [class]="getScoreClass(n.executionScore.status)" 
                   class="ml-auto px-1.5 py-0.5 rounded font-semibold text-2xs">
                {{ n.executionScore.score }}/100
              </div>
            }
          </div>
        </div>
      }
      
      <!-- ═══ VIEW TOGGLE ═══ -->
      <div class="px-2 py-1 bg-gray-800 border-b border-gray-700 flex gap-2">
        <button (click)="viewMode.set('tree')" 
                [class.text-blue-400]="viewMode() === 'tree'"
                class="text-[9px] uppercase font-bold hover:text-white transition-colors">Standard Tree</button>
        <span class="text-gray-600">|</span>
        <button (click)="viewMode.set('bloom')" 
                [class.text-blue-400]="viewMode() === 'bloom'"
                class="text-[9px] uppercase font-bold hover:text-white transition-colors">Reactive Bloom</button>
      </div>

      <!-- ═══ TREE (with inline inspector) ═══ -->
      <div class="flex-1 overflow-auto relative">
        @if (viewMode() === 'tree') {
          @if (root(); as root) {
            <div class="p-2">
              <app-execution-tree-node [node]="root" />
            </div>
          }
        } @else {
          <!-- ═══ REACTIVE BLOOM VIEW ═══ -->
          <div class="w-full h-full p-4 flex items-center justify-center bg-gray-950/20 overflow-auto">
            <div class="relative flex flex-col items-center gap-10">
              <!-- Central Trigger -->
              <div class="px-4 py-2 bg-blue-600 rounded-lg shadow-xl border border-blue-400 text-center animate-pulse">
                <div class="text-[8px] text-blue-100 font-bold uppercase tracking-widest">Trigger</div>
                <div class="text-xs font-black text-white">{{ root()?.label }}</div>
              </div>

              <!-- Impact Rings -->
              <div class="flex flex-wrap justify-center gap-8 max-w-2xl">
                @for (chapter of root()?.children; track chapter.id) {
                  <div class="flex flex-col items-center gap-4">
                    <!-- Direct Impacts (Level 1) -->
                    <div class="px-3 py-1.5 bg-gray-800 rounded border border-gray-600 shadow-lg text-center min-w-[100px]">
                       <div class="text-[7px] text-gray-500 font-bold uppercase">Impact Area</div>
                       <div class="text-[10px] text-gray-200 font-semibold">{{ chapter.label }}</div>
                    </div>

                    <!-- Cascades (Bloom Ring) -->
                    <div class="flex gap-2">
                      @for (step of chapter.children; track step.id) {
                        <div class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] transition-all hover:scale-125 cursor-help border shadow-lg"
                             [title]="step.label + ' (' + step.duration + 'ms)'"
                             [class.bg-red-500]="step.severity === 'high'"
                             [class.border-red-400]="step.severity === 'high'"
                             [class.bg-amber-500]="step.severity === 'medium'"
                             [class.border-amber-400]="step.severity === 'medium'"
                             [class.bg-gray-700]="step.severity === 'low' || !step.severity"
                             [class.border-gray-500]="step.severity === 'low' || !step.severity">
                          {{ step.icon }}
                          <!-- Visual Indicator for Depth -->
                          @if (step.renderDepth && step.renderDepth > 1) {
                            <div class="absolute -bottom-1 -right-1 w-3 h-3 bg-indigo-600 rounded-full border border-white text-[6px] flex items-center justify-center font-bold">
                              {{ step.renderDepth }}
                            </div>
                          }
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionTreeComponent {
  private treeBuilder = inject(TreeNodeBuilderService);

  @Input() set narrative(value: ExecutionNarrative) {
    this.narrativeData.set(value);
    this.root.set(this.treeBuilder.buildTree(value));
  }

  readonly narrativeData = signal<ExecutionNarrative | null>(null);
  readonly root = signal<TreeNode | null>(null);
  readonly viewMode = signal<'tree' | 'bloom'>('tree');

  getScoreClass(status: string): string {
    switch (status) {
      case 'good': return 'bg-green-600/30 text-green-300';
      case 'warning': return 'bg-yellow-600/30 text-yellow-300';
      case 'critical': return 'bg-red-600/30 text-red-300';
      default: return 'bg-gray-600/30 text-gray-300';
    }
  }
}
