/**
 * Execution Tree Node Component (Recursive)
 * 
 * Renders a single node in the execution tree.
 * Recursively renders children based on expansion state.
 * 
 * All 4 levels:
 * - Session: always expanded
 * - Chapter: collapsible, shows duration and domain icon
 * - Step: clickable to expand inline details (type-appropriate)
 * - Inspector (inline): shows RELEVANT info based on step type
 *     - Render: cause + duration (if slow)
 *     - API: status + duration + what changed + consumers
 *     - Store: what changed + consumers
 *     - Signal: value + consumers
 */

import { Component, Input, Output, EventEmitter, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { TreeNode } from '@nglens/types/execution-tree';

@Component({
  selector: 'app-execution-tree-node',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tree-node">
      <!-- Node header row -->
      <div class="node-header" 
           [style.paddingLeft.px]="node.depth * 20"
           [class.is-session]="node.type === 'session'"
           [class.is-chapter]="node.type === 'chapter'"
           [class.is-step]="node.type === 'step'"
           [class.is-bottleneck]="node.isBottleneck"
           [class.is-expanded]="node.isExpanded()"
           (click)="onNodeClick()">
        
        <!-- Expand/collapse toggle -->
        @if (node.children.length > 0 || node.type === 'step') {
          <button class="toggle-btn" (click)="$event.stopPropagation(); onToggle()">
            {{ node.isExpanded() ? '▼' : '▶' }}
          </button>
        } @else {
          <span class="toggle-spacer"></span>
        }
        
        <!-- Icon + Label -->
        <span class="node-icon">{{ node.icon }}</span>
        <span class="node-label" [class.is-bottleneck]="node.isBottleneck">{{ node.label }}</span>
        
        <!-- Duration (only if > 0) -->
        @if (node.duration > 0) {
          <span class="dur" [class.slow]="node.duration > 250">
            {{ formatDuration(node.duration) }}
          </span>
        }
        
        <!-- Severity -->
        @if (node.severity === 'high') {
          <span class="sev">🔥</span>
        } @else if (node.severity === 'medium') {
          <span class="sev">⚠️</span>
        }
      </div>
      
      <!-- Children (recursive) -->
      @if (node.isExpanded() && node.children.length > 0) {
        <div class="children">
          @for (child of node.children; track child.id) {
            <app-execution-tree-node [node]="child" (stepSelected)="stepSelected.emit($event)" />
          }
        </div>
      }
      
      <!-- INLINE STEP DETAILS (Level 4) — type-appropriate -->
      @if (node.type === 'step' && node.isExpanded() && node.subsectionData) {
        <div class="step-details" [style.marginLeft.px]="(node.depth + 1) * 20">
          
          @switch (node.subsectionData.type) {
            <!-- ═══ API STEP ═══ -->
            @case ('api') {
              <div class="detail-row">
                <span class="detail-label">Request</span>
                <code class="detail-code">{{ node.subsectionData.implementation }}</code>
              </div>
              @if (node.duration && node.duration > 0) {
                <div class="detail-row">
                  <span class="detail-label">Duration</span>
                  <span class="detail-val" [class.slow]="node.duration > 250">{{ node.duration }}ms</span>
                </div>
              }
              @if (node.subsectionData.changes && node.subsectionData.changes.length > 0) {
                <div class="detail-section">
                  <span class="detail-heading">Changed</span>
                  @for (change of node.subsectionData.changes; track change.field) {
                    <div class="diff-row">
                      <span class="diff-key">{{ change.entityType }}.{{ change.field }}</span>
                      <span class="diff-val">{{ change.before }} → {{ change.after }}</span>
                    </div>
                  }
                </div>
              }
              @if (node.subsectionData.consumers && node.subsectionData.consumers.length > 0) {
                <div class="detail-section">
                  <span class="detail-heading">Triggered</span>
                  <div class="chips">
                    @for (c of node.subsectionData.consumers; track c) {
                      <span class="chip">{{ c }}</span>
                    }
                  </div>
                </div>
              }
            }
            
            <!-- ═══ STORE STEP ═══ -->
            @case ('store') {
              <div class="detail-row">
                <span class="detail-label">Action</span>
                <code class="detail-code">{{ node.subsectionData.implementation }}</code>
              </div>
              @if (node.subsectionData.changes && node.subsectionData.changes.length > 0) {
                <div class="detail-section">
                  <span class="detail-heading">Changed</span>
                  @for (change of node.subsectionData.changes; track change.field) {
                    <div class="diff-row">
                      <span class="diff-key">{{ change.entityType }}.{{ change.field }}</span>
                      <span class="diff-val">{{ change.before }} → {{ change.after }}</span>
                    </div>
                  }
                </div>
              }
              @if (node.subsectionData.consumers && node.subsectionData.consumers.length > 0) {
                <div class="detail-section">
                  <span class="detail-heading">Subscribers</span>
                  <div class="chips">
                    @for (c of node.subsectionData.consumers; track c) {
                      <span class="chip">{{ c }}</span>
                    }
                  </div>
                </div>
              }
            }
            
            <!-- ═══ SIGNAL STEP ═══ -->
            @case ('signal') {
              <div class="detail-row">
                <span class="detail-label">Signal</span>
                <code class="detail-code">{{ node.subsectionData.implementation }}</code>
              </div>
              @if (node.subsectionData.changes && node.subsectionData.changes.length > 0) {
                @for (change of node.subsectionData.changes; track change.field) {
                  <div class="detail-row">
                    <span class="detail-label">Value</span>
                    <span class="diff-val">{{ change.before }} → {{ change.after }}</span>
                  </div>
                }
              }
              @if (node.subsectionData.consumers && node.subsectionData.consumers.length > 0) {
                <div class="detail-section">
                  <span class="detail-heading">Consumers</span>
                  <div class="chips">
                    @for (c of node.subsectionData.consumers; track c) {
                      <span class="chip">{{ c }}</span>
                    }
                  </div>
                </div>
              }
            }
            
            <!-- ═══ RENDER/COMPONENT STEP ═══ -->
            @case ('render') {
              @if (node.subsectionData.causedBy) {
                <div class="detail-row">
                  <span class="detail-label">Cause</span>
                  <span class="detail-val">{{ node.subsectionData.causedBy }}</span>
                </div>
              }
              @if (node.duration && node.duration > 16) {
                <div class="detail-row">
                  <span class="detail-label">Duration</span>
                  <span class="detail-val slow">{{ node.duration }}ms (over 16ms budget)</span>
                </div>
              }
              @if (node.subsectionData.observations && node.subsectionData.observations.length > 0) {
                @for (obs of node.subsectionData.observations; track obs) {
                  <div class="obs-row">⚠️ {{ obs }}</div>
                }
              }
            }
            @case ('component') {
              @if (node.subsectionData.causedBy) {
                <div class="detail-row">
                  <span class="detail-label">Cause</span>
                  <span class="detail-val">{{ node.subsectionData.causedBy }}</span>
                </div>
              }
              @if (node.duration && node.duration > 16) {
                <div class="detail-row">
                  <span class="detail-label">Duration</span>
                  <span class="detail-val slow">{{ node.duration }}ms (over 16ms budget)</span>
                </div>
              }
            }
            
            <!-- ═══ COMPUTED STEP ═══ -->
            @case ('computed') {
              <div class="detail-row">
                <span class="detail-label">Computed</span>
                <code class="detail-code">{{ node.subsectionData.implementation }}</code>
              </div>
              @if (node.subsectionData.consumers && node.subsectionData.consumers.length > 0) {
                <div class="detail-section">
                  <span class="detail-heading">Consumers</span>
                  <div class="chips">
                    @for (c of node.subsectionData.consumers; track c) {
                      <span class="chip">{{ c }}</span>
                    }
                  </div>
                </div>
              }
            }
            
            <!-- ═══ DEFAULT (fallback) ═══ -->
            @default {
              @if (node.subsectionData.summary) {
                <div class="detail-row">
                  <span class="detail-val">{{ node.subsectionData.summary }}</span>
                </div>
              }
              @if (node.duration && node.duration > 0) {
                <div class="detail-row">
                  <span class="detail-label">Duration</span>
                  <span class="detail-val">{{ node.duration }}ms</span>
                </div>
              }
            }
          }
          
        </div>
      }
    </div>
  `,
  styles: [`
    .tree-node { user-select: none; }

    .node-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 4px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      &:hover { background: rgba(255, 255, 255, 0.04); }
      &.is-expanded.is-step { background: rgba(99, 102, 241, 0.08); }
      &.is-session { font-weight: 600; color: rgb(229, 231, 235); }
      &.is-chapter { font-weight: 500; color: rgb(209, 213, 219); }
      &.is-step { color: rgb(156, 163, 175); font-size: 11px; }
      &.is-bottleneck .node-label { color: rgb(239, 68, 68); font-weight: 600; }
    }

    .toggle-btn {
      width: 16px; height: 16px; padding: 0; border: none; background: none;
      cursor: pointer; color: rgb(107, 114, 128); font-size: 9px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      &:hover { color: rgb(156, 163, 175); }
    }
    .toggle-spacer { width: 16px; flex-shrink: 0; }
    .node-icon { font-size: 13px; flex-shrink: 0; }
    .node-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .dur {
      padding: 1px 5px; border-radius: 3px; font-size: 10px; flex-shrink: 0;
      font-family: 'Monaco', 'Menlo', monospace;
      background: rgba(107, 114, 128, 0.15); color: rgb(156, 163, 175);
      &.slow { background: rgba(239, 68, 68, 0.15); color: rgb(254, 202, 202); }
    }
    .sev { font-size: 11px; flex-shrink: 0; }

    .children { border-left: 1px solid rgba(107, 114, 128, 0.15); margin-left: 8px; }

    /* ═══ INLINE STEP DETAILS ═══ */
    .step-details {
      margin: 2px 0 6px 8px;
      padding: 6px 10px;
      border-left: 2px solid rgba(99, 102, 241, 0.3);
      background: rgba(30, 41, 59, 0.4);
      border-radius: 0 4px 4px 0;
      font-size: 10px;
    }

    .detail-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 3px 0;
    }

    .detail-label {
      color: rgb(107, 114, 128);
      font-weight: 500;
      min-width: 56px;
      flex-shrink: 0;
    }

    .detail-val {
      color: rgb(209, 213, 219);
      &.slow { color: rgb(254, 202, 202); font-weight: 500; }
    }

    .detail-code {
      color: rgb(165, 243, 252);
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 10px;
      word-break: break-all;
    }

    .detail-section {
      margin-top: 6px;
      padding-top: 4px;
      border-top: 1px solid rgba(55, 65, 81, 0.4);
    }

    .detail-heading {
      display: block;
      color: rgb(107, 114, 128);
      font-weight: 500;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .diff-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
    }
    .diff-key { color: rgb(165, 243, 252); }
    .diff-val { color: rgb(134, 239, 172); font-family: 'Monaco', 'Menlo', monospace; font-size: 9px; }

    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip {
      padding: 1px 6px; border-radius: 3px; font-size: 9px;
      background: rgba(99, 102, 241, 0.12); color: rgb(165, 180, 252);
      border: 1px solid rgba(99, 102, 241, 0.2);
    }

    .obs-row {
      padding: 3px 0; color: rgb(253, 224, 71); font-size: 10px;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionTreeNodeComponent {
  @Input() node!: TreeNode;
  @Output() stepSelected = new EventEmitter<TreeNode>();

  onNodeClick(): void {
    this.node.isExpanded.update((v: boolean) => !v);
  }

  onToggle(): void {
    this.node.isExpanded.update((v: boolean) => !v);
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
}
