/**
 * Tree Node Structure for Execution Explorer
 * 
 * Represents the 4-level hierarchy:
 * Level 1: Session (root, always expanded)
 * Level 2: Chapter (collapsible)
 * Level 3: Subsection/Step (expandable, nested under chapter)
 * Level 4: Inspector (modal on click of a step)
 */

import { Signal, WritableSignal } from '@angular/core';
import type { Chapter, Subsection, ExecutionNarrative } from './execution-narrative';

export type TreeNodeType = 'session' | 'chapter' | 'step';

export interface TreeNode {
  // Identity
  id: string;
  type: TreeNodeType;
  
  // Display
  label: string;                    // "Dashboard Bootstrap", "Load Revenue", "GET /revenue"
  icon: string;                     // "🎯", "📋", "🌐"
  
  // Timing
  duration: number;                 // milliseconds
  startTime: number;
  endTime: number;
  
  // Hierarchy
  parent: TreeNode | null;
  children: TreeNode[];
  depth: number;                    // 0 = session, 1 = chapter, 2 = step
  
  // UI State (signals for reactivity)
  isExpanded: WritableSignal<boolean>;
  isSelected: WritableSignal<boolean>;
  
  // Metadata for different node types
  // For chapters: the Chapter object
  chapterData?: Chapter;
  
  // For steps/subsections: the Subsection object
  subsectionData?: Subsection;
  
  // For session: the ExecutionNarrative
  narrativeData?: ExecutionNarrative;
  
  // Performance hint (for visual indicators)
  isBottleneck?: boolean;
  severity?: 'high' | 'medium' | 'low';
}

/**
 * Flattened tree view for rendering in list/cascade format
 */
export interface FlattenedTreeNode extends TreeNode {
  indentLevel: number;             // For visual indentation
  isLeaf: boolean;                 // Whether node has children
  visualPosition: number;          // Position in flattened list
}
