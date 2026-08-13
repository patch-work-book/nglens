/**
 * TreeNodeBuilder Service
 * 
 * Transforms ExecutionNarrative into TreeNode hierarchy
 * Used by ExecutionExplorerComponent to build the 4-level tree
 * 
 * Architecture:
 * ExecutionNarrative (data) → TreeNode (visual structure)
 */

import { Injectable } from '@angular/core';
import { signal } from '@angular/core';
import type { ExecutionNarrative, Chapter, Subsection } from '@nglens/types/execution-narrative';
import type { TreeNode } from '@nglens/types/execution-tree';

@Injectable({ providedIn: 'root' })
export class TreeNodeBuilderService {
  /**
   * Builds the root tree node (session level) from a narrative
   * 
   * Structure:
   * Level 1: Session (root) → always expanded
   *   Level 2: Chapters → collapsed by default
   *     Level 3: Subsections/Steps → collapsed by default
   */
  buildTree(narrative: ExecutionNarrative): TreeNode {
    // Create root session node
    const root: TreeNode = {
      id: `tree-${narrative.id}`,
      type: 'session',
      label: narrative.title,
      icon: '🎯',
      duration: narrative.duration,
      startTime: narrative.startTime,
      endTime: narrative.endTime,
      parent: null,
      children: [],
      depth: 0,
      isExpanded: signal(true),              // Sessions always expanded
      isSelected: signal(false),
      narrativeData: narrative,
      isBottleneck: false,
      severity: 'low',
    };

    // Build chapter nodes (level 2)
    root.children = narrative.chapters.map((chapter: Chapter, idx: number) => {
      const chapterNode = this.buildChapterNode(chapter, root, idx + 1);
      return chapterNode;
    });

    return root;
  }

  private buildChapterNode(chapter: Chapter, parent: TreeNode, sequenceNumber: number): TreeNode {
    const node: TreeNode = {
      id: `tree-${chapter.id}`,
      type: 'chapter',
      label: `${sequenceNumber}. ${chapter.domain.name}`,  // "1. Revenue", "2. Orders"
      icon: chapter.domain.icon,                           // "💰", "📦"
      duration: chapter.duration,
      startTime: chapter.startTime,
      endTime: chapter.endTime,
      parent,
      children: [],
      depth: 1,
      isExpanded: signal(false),              // Chapters collapsed by default
      isSelected: signal(false),
      chapterData: chapter,
      isBottleneck: this.isBottleneck(chapter),
      severity: this.calculateSeverity(chapter),
    };

    // Build subsection/step nodes (level 3)
    node.children = chapter.subsections.map((subsection: Subsection) => {
      const stepNode = this.buildStepNode(subsection, node);
      return stepNode;
    });

    return node;
  }

  private buildStepNode(subsection: Subsection, parent: TreeNode): TreeNode {
    const node: TreeNode = {
      id: `tree-${subsection.id}`,
      type: 'step',
      label: subsection.label,                 // "GET /revenue", "updateRevenue", "RevenueChart"
      icon: subsection.icon,                   // "🌐", "💾", "⚡", "🎨"
      duration: subsection.duration || 0,
      startTime: parent.startTime,             // Inherit from parent
      endTime: parent.endTime,
      parent,
      children: [],                            // Steps are leaf nodes
      depth: 2,
      isExpanded: signal(false),               // Steps are leaf nodes (no expand)
      isSelected: signal(false),
      subsectionData: subsection,
      isBottleneck: (subsection as any).isSlowOperation || false,
      severity: (subsection as any).isSlowOperation ? 'high' : 'low',

      // Graph Connectivity for 'Bloom Tree' UX
      isDirectImpact: (subsection as any).impact?.parasiticRenderRatio ? (subsection as any).impact.parasiticRenderRatio < 50 : true,
      renderDepth: (subsection as any).impact?.maxCascadingDepth || 0,
      cascadeSourceId: (subsection as any).rootCauseChain?.rootCause?.eventId,
    };

    return node;
  }

  /**
   * Determines if a chapter is the bottleneck
   * Bottleneck = contains the slowest operation or takes the longest
   */
  private isBottleneck(chapter: Chapter): boolean {
    // A chapter is a bottleneck if:
    // 1. Contains slow API calls (> 300ms)
    // 2. Contains multiple slow operations
    // 3. Is significantly slower than sibling chapters
    
    if (chapter.metrics.apiCalls.totalDuration > 300) {
      return true;
    }
    
    if (chapter.metrics.componentRenders.slowRenders > 2) {
      return true;
    }
    
    if (chapter.metrics.apiCalls.failures > 0) {
      return true;
    }
    
    return false;
  }

  /**
   * Calculates visual severity for a chapter
   */
  private calculateSeverity(chapter: Chapter): 'high' | 'medium' | 'low' {
    // High: Contains critical issues
    if (chapter.metrics.apiCalls.failures > 0) {
      return 'high';
    }
    
    // High: Very slow (> 500ms)
    if (chapter.duration > 500) {
      return 'high';
    }
    
    // Medium: Moderately slow (> 250ms) or multiple slow renders
    if (chapter.duration > 250 || chapter.metrics.componentRenders.slowRenders > 1) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * Flattens tree into a list for rendering in cascade format
   */
  flattenTree(root: TreeNode): TreeNode[] {
    const result: TreeNode[] = [];
    this.flattenTreeRecursive(root, result);
    return result;
  }

  private flattenTreeRecursive(node: TreeNode, result: TreeNode[]): void {
    result.push(node);
    
    // Only add children if node is expanded
    if (node.isExpanded()) {
      for (const child of node.children) {
        this.flattenTreeRecursive(child, result);
      }
    }
  }

  /**
   * Toggles expansion state of a node
   */
  toggleNode(node: TreeNode): void {
    if (node.type === 'step') {
      // Steps are leaf nodes - clicking them should select them (trigger inspector)
      node.isSelected.set(true);
    } else {
      // Sessions and chapters toggle expansion
      node.isExpanded.update((v: boolean) => !v);
    }
  }

  /**
   * Selects a node and deselects siblings
   */
  selectNode(node: TreeNode, root: TreeNode): void {
    // Deselect all nodes in tree
    this.deselectAllRecursive(root);
    
    // Select the clicked node
    node.isSelected.set(true);
    
    // Expand all parents to show the selected node
    let parent = node.parent;
    while (parent) {
      parent.isExpanded.set(true);
      parent = parent.parent;
    }
  }

  private deselectAllRecursive(node: TreeNode): void {
    node.isSelected.set(false);
    for (const child of node.children) {
      this.deselectAllRecursive(child);
    }
  }

  /**
   * Finds a node by ID in the tree
   */
  findNodeById(root: TreeNode, id: string): TreeNode | null {
    if (root.id === id) {
      return root;
    }
    
    for (const child of root.children) {
      const found = this.findNodeById(child, id);
      if (found) {
        return found;
      }
    }
    
    return null;
  }

  /**
   * Gets the selected step node (for inspector modal)
   */
  getSelectedStep(root: TreeNode): TreeNode | null {
    return this.getSelectedStepRecursive(root);
  }

  private getSelectedStepRecursive(node: TreeNode): TreeNode | null {
    if (node.isSelected() && node.type === 'step') {
      return node;
    }
    
    for (const child of node.children) {
      const found = this.getSelectedStepRecursive(child);
      if (found) {
        return found;
      }
    }
    
    return null;
  }
}
