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
      
      <!-- ═══ TREE (with inline inspector) ═══ -->
      <div class="flex-1 overflow-auto">
        @if (root(); as root) {
          <div class="p-2">
            <app-execution-tree-node [node]="root" />
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

  getScoreClass(status: string): string {
    switch (status) {
      case 'good': return 'bg-green-600/30 text-green-300';
      case 'warning': return 'bg-yellow-600/30 text-yellow-300';
      case 'critical': return 'bg-red-600/30 text-red-300';
      default: return 'bg-gray-600/30 text-gray-300';
    }
  }
}
