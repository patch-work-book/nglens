/**
 * Render Inspector Adapter Service
 *
 * Transforms ActionReplay (Render Inspector data) into Phase 1 & 2 component inputs.
 * Bridges between raw render events and the new UX components.
 *
 * Phase 1: Foundation (Sticky Summary, Headline, Hotspots)
 * Phase 2: Investigation (API Timeline, Component Cards, Focus Mode)
 */

import { Injectable } from '@angular/core';
import type { RenderCause } from '@nglens/types/render-events';

/** Phase 1: Sticky execution metrics (always visible) */
export interface StickyExecutionMetrics {
  totalRenders: number;
  totalDuration: number;
  uniqueComponents: number;
  frameBudgetExceeded: boolean;
  framesDropped: number;
  hotspot: { name: string; count: number; duration: number; pct: number } | null;
  performanceScore: number; // 0-100
}

/** Phase 1: Headline data (what happened in 1 sentence) */
export interface HeadlineData {
  icon: string;
  title: string;
  description: string;
  suggestion: string | null;
}

/** Phase 1: Hotspots list (top issues at a glance) */
export interface HotspotItem {
  id: string;
  icon: string;
  label: string;
  value: string;
  severity: 'high' | 'medium' | 'low' | 'none';
  badge?: string;
  tooltip?: string;
}

/** Phase 2: API execution phases */
export interface APIPhase {
  id: string;
  name: string;
  count: number;
  duration: number;
  color: string;
  requests: APIRequest[];
}

export interface APIRequest {
  id: string;
  method: string;
  url: string;
  status?: number;
  duration: number;
  timestamp: number;
  responseSize?: string;
}

/** Phase 2: Component performance metrics */
export interface ComponentMetrics {
  name: string;
  displayName: string;
  renderCount: number;
  totalDuration: number;
  averageDuration: number;
  renderReason: string;
  renderFix: string;
  performanceScore: number; // 0-100
  badge?: 'warning' | 'error' | 'optimizable';
  severity: 'high' | 'medium' | 'low' | 'none';
}

/** Phase 2: Focus mode data (deep drill on one component) */
export interface FocusData {
  componentName: string;
  displayName: string;
  totalRenders: number;
  totalDuration: number;
  averageDuration: number;
  renderReasons: { reason: string; count: number; icon: string }[];
  affectedComponents: string[];
  dependentSignals: string[];
  dependentAPIs: string[];
  executionPath: string;
  suggestions: string[];
}

interface ActionReplay {
  id: string;
  trigger: string;
  triggerIcon: string;
  targetSelector: string | null;
  triggerComponent: string | null;
  timestamp: number;
  totalRenders: number;
  uniqueComponents: number;
  duration: number;
  frameBudgetExceeded: boolean;
  framesDropped: number;
  timeline: any[];
  tree: CascadeNode[];
  flowEntries: FlowEntry[];
  _pageLoadSuggestion?: string | null;
}

interface CascadeNode {
  componentName: string;
  count: number;
  totalDuration: number;
  cause: RenderCause;
  depth: number;
  children: CascadeNode[];
  reasons?: any[];
}

interface FlowEntry {
  id: string;
  icon: string;
  type: string;
  label: string;
  detail: string;
  colorClass: string;
  timestamp: number;
  ownerClass?: string;
  sourceComponent?: string;
  subscribers?: string[];
  value?: string;
  responseBody?: string;
  connectionStatus?: 'connected' | 'disconnected' | 'connecting';
  methodName?: string;
  actionName?: string;
  selectorName?: string;
}

@Injectable({ providedIn: 'root' })
export class RenderInspectorAdapterService {
  /**
   * Phase 1: Convert ActionReplay → StickyExecutionMetrics
   * Shows the most critical KPIs at a glance
   */
  toStickyMetrics(action: ActionReplay | null): StickyExecutionMetrics {
    if (!action) {
      return {
        totalRenders: 0,
        totalDuration: 0,
        uniqueComponents: 0,
        frameBudgetExceeded: false,
        framesDropped: 0,
        hotspot: null,
        performanceScore: 100,
      };
    }

    const performanceScore = Math.max(0, Math.min(100, 100 - action.duration / 5));
    const hotspot = this.getHotspot(action);

    return {
      totalRenders: action.totalRenders,
      totalDuration: action.duration,
      uniqueComponents: action.uniqueComponents,
      frameBudgetExceeded: action.frameBudgetExceeded,
      framesDropped: action.framesDropped,
      hotspot,
      performanceScore,
    };
  }

  /**
   * Phase 1: Convert ActionReplay → HeadlineData
   * One-sentence summary of what happened
   */
  toHeadline(action: ActionReplay | null): HeadlineData {
    if (!action) {
      return {
        icon: '📊',
        title: 'No execution data',
        description: 'Start an interaction to see performance analysis.',
        suggestion: null,
      };
    }

    const { trigger, totalRenders, uniqueComponents, frameBudgetExceeded, _pageLoadSuggestion } =
      action;

    // Determine severity and message
    let icon = '✅';
    let description = '';

    if (frameBudgetExceeded) {
      icon = '⚠️';
      description = `${totalRenders} renders across ${uniqueComponents} components exceeded frame budget (${action.duration.toFixed(0)}ms)`;
    } else if (totalRenders > 10) {
      icon = '⚡';
      description = `${totalRenders} renders across ${uniqueComponents} components in ${action.duration.toFixed(0)}ms`;
    } else {
      description = `${totalRenders} renders across ${uniqueComponents} components in ${action.duration.toFixed(0)}ms`;
    }

    return {
      icon,
      title: `${trigger} triggered ${totalRenders} renders`,
      description,
      suggestion: _pageLoadSuggestion || null,
    };
  }

  /**
   * Phase 1: Convert ActionReplay → HotspotItems
   * Top 5-7 metrics that deserve attention
   */
  toHotspots(action: ActionReplay | null): HotspotItem[] {
    if (!action) return [];

    const hotspots: HotspotItem[] = [];
    const hotspot = this.getHotspot(action);

    // #1: Hottest component (if any re-rendered multiple times)
    if (hotspot && hotspot.count > 1) {
      hotspots.push({
        id: 'hotspot-component',
        icon: '🔥',
        label: hotspot.name,
        value: `${hotspot.count}× (${hotspot.duration}ms)`,
        severity: hotspot.count >= 6 ? 'high' : 'medium',
        badge: `${hotspot.pct}% of time`,
        tooltip: `This component consumed ${hotspot.pct}% of total render time`,
      });
    }

    // #2: Frame budget
    if (action.frameBudgetExceeded) {
      hotspots.push({
        id: 'hotspot-frame-budget',
        icon: '📹',
        label: 'Frame Budget Exceeded',
        value: `${action.duration.toFixed(0)}ms > 16.67ms`,
        severity: 'high',
        tooltip: `Dropped ${action.framesDropped} frames`,
      });
    }

    // #3: Unique components affected
    if (action.uniqueComponents > 10) {
      hotspots.push({
        id: 'hotspot-components',
        icon: '📦',
        label: `Components affected`,
        value: `${action.uniqueComponents} components`,
        severity: action.uniqueComponents > 15 ? 'high' : 'medium',
      });
    }

    // #4: API calls during action
    const apiCount = action.flowEntries.filter(f => f.type === 'http-response').length;
    if (apiCount > 0) {
      hotspots.push({
        id: 'hotspot-apis',
        icon: '🌐',
        label: 'API Calls',
        value: `${apiCount} requests`,
        severity: apiCount > 5 ? 'high' : 'medium',
      });
    }

    // #5: Signal writes
    const signalCount = action.flowEntries.filter(f => f.type === 'signal-write').length;
    if (signalCount > 0) {
      hotspots.push({
        id: 'hotspot-signals',
        icon: '⚡',
        label: 'Signal Writes',
        value: `${signalCount} updates`,
        severity: 'medium',
      });
    }

    // #6: Subject emissions
    const subjectCount = action.flowEntries.filter(f => f.type === 'subject-emit').length;
    if (subjectCount > 0) {
      hotspots.push({
        id: 'hotspot-subjects',
        icon: '📡',
        label: 'Subject Emissions',
        value: `${subjectCount} emissions`,
        severity: 'medium',
      });
    }

    return hotspots.slice(0, 7); // Show top 7 hotspots
  }

  /**
   * Phase 2: Convert ActionReplay → APIPhases
   * Organize APIs into execution phases
   */
  toAPITimeline(action: ActionReplay | null): APIPhase[] {
    if (!action) return [];

    const flows = action.flowEntries.filter(f => f.type === 'http-response');
    if (flows.length === 0) return [];

    // Group by time window (each phase = ~100ms)
    const phases = new Map<number, FlowEntry[]>();
    const phaseDuration = 100; // ms

    for (const flow of flows) {
      const phaseIndex = Math.floor(flow.timestamp / phaseDuration);
      if (!phases.has(phaseIndex)) {
        phases.set(phaseIndex, []);
      }
      phases.get(phaseIndex)!.push(flow);
    }

    // Convert to APIPhase[]
    const result: APIPhase[] = [];
    let phaseNum = 1;

    for (const [phaseIndex, flows] of Array.from(phases.entries()).sort((a, b) => a[0] - b[0])) {
      const requests: APIRequest[] = flows.map(f => ({
        id: f.id,
        method: f.methodName || 'GET',
        url: f.label,
        status: f.detail.includes('200') ? 200 : undefined,
        duration: 0,
        timestamp: f.timestamp,
        responseSize: f.responseBody ? `${f.responseBody.length} bytes` : undefined,
      }));

      result.push({
        id: `phase-${phaseNum}`,
        name: `Phase ${phaseNum}`,
        count: flows.length,
        duration: phaseDuration,
        color: this.getPhaseColor(phaseNum),
        requests,
      });

      phaseNum++;
    }

    return result;
  }

  /**
   * Phase 2: Convert CascadeNode → ComponentMetrics
   * Transform render tree into component performance cards
   */
  toComponentCard(node: CascadeNode | null): ComponentMetrics {
    if (!node) {
      return {
        name: 'unknown',
        displayName: 'Unknown',
        renderCount: 0,
        totalDuration: 0,
        averageDuration: 0,
        renderReason: 'No data',
        renderFix: '',
        performanceScore: 100,
        severity: 'none',
      };
    }

    const displayName = this.formatComponentName(node.componentName);
    const avgDuration = node.count > 0 ? node.totalDuration / node.count : 0;
    const performanceScore = Math.max(0, Math.min(100, 100 - avgDuration * 2));

    // Determine severity based on impact (count × duration)
    const impact = node.count * node.totalDuration;
    let severity: 'high' | 'medium' | 'low' | 'none' = 'none';
    let badge: 'warning' | 'error' | 'optimizable' | undefined;

    if (impact >= 500 || node.count >= 6) {
      severity = 'high';
      badge = 'error';
    } else if (impact >= 100 || node.count >= 3) {
      severity = 'medium';
      badge = 'warning';
    }

    return {
      name: node.componentName,
      displayName,
      renderCount: node.count,
      totalDuration: Math.round(node.totalDuration),
      averageDuration: Math.round(avgDuration),
      renderReason: this.getRenderReason(node.cause),
      renderFix: this.getRenderFix(node.cause, node.count),
      performanceScore,
      badge,
      severity,
    };
  }

  /**
   * Phase 2: Convert ActionReplay → FocusData
   * Deep drill into a specific component
   */
  toFocusData(action: ActionReplay | null, componentName: string): FocusData {
    if (!action) {
      return {
        componentName,
        displayName: this.formatComponentName(componentName),
        totalRenders: 0,
        totalDuration: 0,
        averageDuration: 0,
        renderReasons: [],
        affectedComponents: [],
        dependentSignals: [],
        dependentAPIs: [],
        executionPath: '',
        suggestions: [],
      };
    }

    // Find this component in the tree
    const node = this.findNodeInTree(action.tree, componentName);
    if (!node) {
      return {
        componentName,
        displayName: this.formatComponentName(componentName),
        totalRenders: 0,
        totalDuration: 0,
        averageDuration: 0,
        renderReasons: [],
        affectedComponents: [],
        dependentSignals: [],
        dependentAPIs: [],
        executionPath: '',
        suggestions: [],
      };
    }

    // Extract render reasons
    const renderReasons = this.extractRenderReasons(node);

    // Extract dependent signals & APIs from flowEntries
    const dependentSignals = action.flowEntries
      .filter(f => f.type === 'signal-write' && f.sourceComponent === componentName)
      .map(f => f.label);

    const dependentAPIs = action.flowEntries
      .filter(f => f.type === 'http-response' && f.sourceComponent === componentName)
      .map(f => f.label);

    // Get affected components (children that re-rendered because of this one)
    const affectedComponents = node.children.map(c => this.formatComponentName(c.componentName));

    const avgDuration = node.count > 0 ? node.totalDuration / node.count : 0;

    return {
      componentName,
      displayName: this.formatComponentName(componentName),
      totalRenders: node.count,
      totalDuration: Math.round(node.totalDuration),
      averageDuration: Math.round(avgDuration),
      renderReasons,
      affectedComponents,
      dependentSignals: [...new Set(dependentSignals)],
      dependentAPIs: [...new Set(dependentAPIs)],
      executionPath: this.buildExecutionPath(node),
      suggestions: this.generateSuggestions(node, action),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private getHotspot(action: ActionReplay): {
    name: string;
    count: number;
    duration: number;
    pct: number;
  } | null {
    const nodes = this.flattenTree(action.tree);
    if (nodes.length === 0) return null;

    let hottest: CascadeNode | null = null;
    let maxImpact = 0;

    for (const n of nodes) {
      const impact = n.count * n.totalDuration;
      if (impact > maxImpact && n.count > 1) {
        maxImpact = impact;
        hottest = n;
      }
    }

    if (!hottest || hottest.count <= 1) return null;

    const totalDur = action.duration || 1;
    return {
      name: this.formatComponentName(hottest.componentName),
      count: hottest.count,
      duration: Math.round(hottest.totalDuration),
      pct: Math.round((hottest.totalDuration / totalDur) * 100),
    };
  }

  private flattenTree(tree: CascadeNode[]): CascadeNode[] {
    const result: CascadeNode[] = [];
    const seen = new Set<string>();

    const walk = (nodes: CascadeNode[]): void => {
      const sorted = [...nodes].sort(
        (a, b) => b.count - a.count || b.totalDuration - a.totalDuration
      );
      for (const node of sorted) {
        if (seen.has(node.componentName)) continue;
        seen.add(node.componentName);
        result.push(node);
        walk(node.children);
      }
    };

    walk(tree);
    return result;
  }

  private formatComponentName(name: string): string {
    if (name.length <= 2) return name;
    // Convert ng-app-component → App Component
    return name
      .replace(/^ng-/, '')
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private getRenderReason(cause: RenderCause): string {
    const src = cause.source ?? cause.type;

    if (cause.type === 'signal') {
      if (src.includes('.')) return `Signal: ${src.split('.').pop()?.replace('()', '')}`;
      return 'Signal changed';
    }
    if (cause.type === 'input') return 'Input reference changed';
    if (cause.type === 'parent') return 'Parent re-rendered';
    if (cause.type === 'manual-cd') {
      if (src.includes('markForCheck')) return 'markForCheck() called';
      return 'Manual change detection';
    }
    if (src.includes('addEventListener:click')) return 'Click event';
    if (src.includes('addEventListener:input')) return 'Input event';
    if (src.includes('addEventListener:scroll')) return 'Scroll event';
    if (src.includes('setTimeout')) return 'Timer (setTimeout)';
    if (src.includes('fetch') || src.includes('XMLHttpRequest')) return 'API response';
    return 'Zone.js trigger';
  }

  private getRenderFix(cause: RenderCause, count: number): string {
    if (count <= 1) return '';

    if (cause.type === 'parent') {
      return 'Add OnPush + verify @Input() reference changes';
    }
    if (cause.type === 'signal') {
      return 'Use computed() to batch signal updates';
    }
    if (cause.type === 'input') {
      return 'Memoize parent values to prevent new references';
    }

    const src = cause.source ?? '';
    if (src.includes('setTimeout') || src.includes('setInterval')) {
      return 'Run timers outside Angular zone';
    }
    if (src.includes('scroll')) {
      return 'Add debounce or use Intersection Observer';
    }
    return 'Consider OnPush + fine-grained reactivity';
  }

  private findNodeInTree(tree: CascadeNode[], name: string): CascadeNode | null {
    for (const node of tree) {
      if (node.componentName === name) return node;
      const found = this.findNodeInTree(node.children, name);
      if (found) return found;
    }
    return null;
  }

  private extractRenderReasons(node: CascadeNode): {
    reason: string;
    count: number;
    icon: string;
  }[] {
    const reason = this.getRenderReason(node.cause);
    const icon = this.getReasonIcon(node.cause.type);

    return [
      {
        reason,
        count: node.count,
        icon,
      },
    ];
  }

  private getReasonIcon(type: RenderCause['type']): string {
    switch (type) {
      case 'signal':
        return '⚡';
      case 'input':
        return '📥';
      case 'parent':
        return '👨‍👧';
      case 'zone':
        return '⏱️';
      case 'manual-cd':
        return '🔧';
      default:
        return '❓';
    }
  }

  private buildExecutionPath(node: CascadeNode): string {
    // Simplified execution path (could be enhanced with full trace)
    return `${this.formatComponentName(node.componentName)} → ${node.cause.type} (${node.cause.source})`;
  }

  private generateSuggestions(node: CascadeNode, action: ActionReplay): string[] {
    const suggestions: string[] = [];

    if (node.count > 5) {
      suggestions.push('High render count: consider batching state updates');
    }

    if (node.totalDuration > action.duration * 0.5) {
      suggestions.push('This component is consuming >50% of execution time');
    }

    if (node.children.length > 10) {
      suggestions.push('Many child components affected: check parent change detection strategy');
    }

    const reason = this.getRenderReason(node.cause);
    if (reason.includes('Parent')) {
      suggestions.push('Use OnPush change detection to break the parent cascade');
    }

    return suggestions;
  }

  private getPhaseColor(phaseNum: number): string {
    const colors = [
      'bg-blue-900/40',
      'bg-cyan-900/40',
      'bg-purple-900/40',
      'bg-pink-900/40',
      'bg-green-900/40',
    ];
    return colors[phaseNum % colors.length];
  }
}
