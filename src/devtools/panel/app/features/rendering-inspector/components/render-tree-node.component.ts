import { Component, input, output, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { TreeNodeData, CascadeNodeData } from './render-tree-view.component';

@Component({
  selector: 'app-render-tree-node',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tree-node"
         [style.padding-left.px]="depth() * 16 + 8"
         [ngClass]="'severity-' + severity()"
         [class.has-children]="node().children && node().children.length > 0"
         (mouseenter)="emitSelect()"
         (mouseleave)="emitClear()">
      
      <!-- Expand Toggle -->
      @if (node().children && node().children.length > 0) {
        <button class="expand-btn" 
                (click)="toggleExpand()"
                [class.expanded]="isExpanded()">
          {{ isExpanded() ? '▼' : '▶' }}
        </button>
      } @else {
        <span class="expand-placeholder"></span>
      }

      <!-- Node Content -->
      <div class="node-content">
        <span class="icon">
          @switch (severity()) {
            @case ('high') { 🔥 }
            @case ('medium') { ⚠️ }
            @default { 🔄 }
          }
        </span>
        
        <span class="component-name">{{ formatName() }}</span>
        
        <span class="render-count" [title]="'Rendered ' + node().count + ' times'">
          {{ node().count }}×
        </span>
        
        <span class="duration">{{ node().totalDuration | number:'1.0-0' }}ms</span>
      </div>

      <!-- Impact Bar (miniature) -->
      <div class="impact-bar-mini">
        <div class="impact-fill" [style.width.%]="impactPct()"></div>
      </div>
    </div>

    <!-- Children (visible only if expanded) -->
    @if (isExpanded() && node().children && node().children.length > 0) {
      @for (child of node().children; track child.componentName) {
        <app-render-tree-node 
          [node]="child"
          [depth]="depth() + 1"
          [maxImpactPct]="maxImpactPct()"
          (selectNode)="selectNode.emit($event)"
          (clearSelection)="clearSelection.emit()" />
      }
    }
  `,
  styles: [`
    .tree-node {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      border-left: 3px solid transparent;
      background: rgba(255, 255, 255, 0.02);
    }

    .tree-node:hover {
      background: rgba(100, 181, 246, 0.08);
      border-left-color: #42a5f5;
    }

    .tree-node.severity-high {
      border-left-color: #ff6b6b;
    }

    .tree-node.severity-high:hover {
      background: rgba(255, 107, 107, 0.08);
    }

    .tree-node.severity-medium {
      border-left-color: #ffa94d;
    }

    .tree-node.severity-medium:hover {
      background: rgba(255, 169, 77, 0.08);
    }

    .expand-btn {
      background: none;
      border: none;
      color: #90caf9;
      cursor: pointer;
      font-size: 12px;
      width: 16px;
      height: 16px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease;
    }

    .expand-btn.expanded {
      transform: rotate(0deg);
    }

    .expand-placeholder {
      width: 16px;
      height: 16px;
    }

    .node-content {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      min-width: 0;
      font-size: 11px;
    }

    .icon {
      font-size: 14px;
      flex-shrink: 0;
    }

    .component-name {
      color: #cbd5e0;
      font-weight: 500;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }

    .render-count {
      color: #90caf9;
      font-weight: 600;
      flex-shrink: 0;
      padding: 2px 4px;
      background: rgba(100, 181, 246, 0.1);
      border-radius: 2px;
    }

    .duration {
      color: #80deea;
      font-size: 10px;
      flex-shrink: 0;
    }

    .impact-bar-mini {
      width: 40px;
      height: 2px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 1px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .impact-fill {
      height: 100%;
      background: linear-gradient(90deg, #42a5f5, #64b5f6);
      transition: width 0.3s ease;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenderTreeNodeComponent {
  node = input<CascadeNodeData>(null!);
  depth = input<number>(0);
  maxImpactPct = input<number>(100);

  selectNode = output<TreeNodeData>();
  clearSelection = output<void>();

  isExpanded = signal(true); // Default expanded

  severity = computed(() => {
    const n = this.node();
    if (!n) return 'none';
    const impact = n.count * n.totalDuration;
    if (impact >= 500 || n.count >= 6) return 'high';
    if (impact >= 100 || n.count >= 3) return 'medium';
    if (n.count > 1) return 'low';
    return 'none';
  });

  impactPct = computed(() => {
    const n = this.node();
    if (!n) return 0;
    const maxDuration = this.findMaxDuration(n);
    return Math.min(100, (n.totalDuration / (maxDuration || 1)) * 100);
  });

  formatName(): string {
    const name = this.node()?.componentName || '';
    return name.replace(/([a-z])([A-Z])/g, '$1 $2').split('.').pop() || name;
  }

  toggleExpand(): void {
    this.isExpanded.set(!this.isExpanded());
  }

  emitSelect(): void {
    const n = this.node();
    if (!n) return;
    this.selectNode.emit({
      ...n,
      displayName: this.formatName(),
      severity: this.severity() as any,
      impactPct: this.impactPct(),
    });
  }

  emitClear(): void {
    this.clearSelection.emit();
  }

  private findMaxDuration(node: CascadeNodeData): number {
    let max = node.totalDuration;
    const walk = (n: CascadeNodeData) => {
      for (const child of n.children || []) {
        max = Math.max(max, child.totalDuration);
        walk(child);
      }
    };
    walk(node);
    return max;
  }
}
