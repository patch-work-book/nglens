/**
 * Execution Story Service
 *
 * Converts ActionReplay into a visual execution narrative.
 * - Detects causality chains
 * - Verifies timestamp ordering
 * - Identifies parallel vs sequential execution
 * - Builds component tree
 * - Generates minimal, accurate narrative
 *
 * Every step is traceable to source events.
 */

import { Injectable } from '@angular/core';

/**
 * ExecutionStory - Visual narrative of what happened
 */
export interface ExecutionStory {
  id: string;
  actionId: string;
  trigger: StoryStep;
  steps: StoryStep[];
  phases: Phase[];
  causality: CausalityMap;
  tree: ComponentTree;
  statistics: {
    totalTime: number;
    totalSteps: number;
    parallelPhases: number;
    cascadeDepth: number;
  };
  validations: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    confidence: number; // 0-100%
  };
}

export interface StoryStep {
  id: string;
  type: 'trigger' | 'api' | 'store' | 'signal' | 'component' | 'complete';
  icon: string;
  label: string;
  duration?: number; // ms
  timestamp: number; // ms since start
  detail?: string;
  severity: 'ok' | 'warn' | 'error';
  causedBy?: string; // step id
  causes: string[]; // step ids
  eventIds: string[]; // source event references
}

export interface Phase {
  id: string;
  title: string;
  steps: StoryStep[];
  isParallel: boolean;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface CausalityMap {
  edges: CausalityEdge[];
}

export interface CausalityEdge {
  from: string;
  to: string;
  reason: string;
}

export interface ComponentTree {
  root: ComponentNode[];
  depth: number;
  totalCount: number;
}

export interface ComponentNode {
  name: string;
  displayName: string;
  renderCount: number;
  totalDuration: number;
  depth: number;
  parent?: string;
  children: ComponentNode[];
}

interface ActionReplay {
  id: string;
  trigger: string;
  triggerIcon: string;
  timestamp: number;
  totalRenders: number;
  uniqueComponents: number;
  duration: number;
  frameBudgetExceeded: boolean;
  tree: CascadeNode[];
  flowEntries: FlowEntry[];
}

interface CascadeNode {
  componentName: string;
  count: number;
  totalDuration: number;
  cause: any;
  depth: number;
  children: CascadeNode[];
}

interface FlowEntry {
  id: string;
  icon: string;
  type: string;
  label: string;
  detail: string;
  timestamp: number;
  methodName?: string;
  sourceComponent?: string;
  subscribers?: string[];
}

@Injectable({ providedIn: 'root' })
export class ExecutionStoryService {
  /**
   * Build execution story from ActionReplay
   */
  buildStory(action: ActionReplay | null): ExecutionStory | null {
    if (!action) return null;

    const errors: string[] = [];
    const warnings: string[] = [];

    // Phase 1: Identify trigger
    const trigger = this.identifyTrigger(action);
    if (!trigger) {
      errors.push('Could not identify trigger');
      return this.createErrorStory(action, errors, warnings);
    }

    // Phase 2: Extract and normalize events
    const events = this.extractEvents(action);
    if (events.length === 0) {
      errors.push('No events found');
      return this.createErrorStory(action, errors, warnings);
    }

    // Phase 3: Build causality map
    const { edges, causality } = this.buildCausalityMap(action, trigger, errors, warnings);

    // Phase 4: Group into phases
    const phases = this.groupIntoPhases(action, trigger, events, causality, warnings);

    // Phase 5: Build story steps
    const steps = this.buildStorySteps(trigger, events, causality, action);

    // Phase 6: Build component tree
    const tree = this.buildComponentTree(action);

    // Phase 7: Validate
    const validations = this.validate(trigger, steps, causality, action, errors, warnings);

    const story: ExecutionStory = {
      id: `story-${action.id}`,
      actionId: action.id,
      trigger,
      steps,
      phases,
      causality: { edges },
      tree,
      statistics: {
        totalTime: action.duration,
        totalSteps: steps.length,
        parallelPhases: phases.filter(p => p.isParallel).length,
        cascadeDepth: tree.depth,
      },
      validations,
    };

    return story;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 1: Identify Trigger
  // ────────────────────────────────────────────────────────────────────────────

  private identifyTrigger(action: ActionReplay): StoryStep | null {
    const triggerType = this.determineTriggerType(action);

    return {
      id: 'step-trigger',
      type: 'trigger',
      icon: action.triggerIcon || '🎯',
      label: action.trigger,
      timestamp: 0, // Trigger is at time 0
      severity: 'ok',
      causes: [],
      eventIds: [],
    };
  }

  private determineTriggerType(action: ActionReplay): string {
    if (action.trigger.includes('Route')) return 'route';
    if (action.trigger.includes('Click')) return 'click';
    if (action.trigger.includes('Timer')) return 'timer';
    return 'unknown';
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 2: Extract Events
  // ────────────────────────────────────────────────────────────────────────────

  private extractEvents(action: ActionReplay): FlowEntry[] {
    return action.flowEntries.sort((a, b) => a.timestamp - b.timestamp);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 3: Build Causality Map
  // ────────────────────────────────────────────────────────────────────────────

  private buildCausalityMap(
    action: ActionReplay,
    trigger: StoryStep,
    errors: string[],
    warnings: string[]
  ): { edges: CausalityEdge[]; causality: Map<string, string> } {
    const edges: CausalityEdge[] = [];
    const causality = new Map<string, string>();

    // Trigger causes first events
    const apiEvents = action.flowEntries.filter(e => e.type === 'http-response');
    const storeEvents = action.flowEntries.filter(
      e => e.type === 'store-dispatch' || e.type === 'store-select'
    );
    const signalEvents = action.flowEntries.filter(e => e.type === 'signal-write');

    // API → Store (if store updates after API)
    for (const api of apiEvents) {
      for (const store of storeEvents) {
        if (store.timestamp > api.timestamp && store.timestamp < api.timestamp + 100) {
          const fromId = `step-api-${api.id}`;
          const toId = `step-store-${store.id}`;
          edges.push({ from: fromId, to: toId, reason: 'API response triggered store update' });
          causality.set(toId, fromId);
          break;
        }
      }
    }

    // Store → Signal (if signal writes after store)
    for (const store of storeEvents) {
      for (const signal of signalEvents) {
        if (signal.timestamp > store.timestamp && signal.timestamp < store.timestamp + 50) {
          const fromId = `step-store-${store.id}`;
          const toId = `step-signal-${signal.id}`;
          edges.push({ from: fromId, to: toId, reason: 'Store notified signal' });
          causality.set(toId, fromId);
          break;
        }
      }
    }

    // Detect cycles
    for (const [toId, fromId] of causality) {
      if (causality.get(fromId) === toId) {
        warnings.push('Potential circular causality detected');
      }
    }

    return { edges, causality };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 4: Group Into Phases
  // ────────────────────────────────────────────────────────────────────────────

  private groupIntoPhases(
    action: ActionReplay,
    trigger: StoryStep,
    events: FlowEntry[],
    causality: Map<string, string>,
    warnings: string[]
  ): Phase[] {
    const phases: Phase[] = [];

    // Phase 1: Trigger
    phases.push({
      id: 'phase-trigger',
      title: 'Trigger',
      steps: [trigger],
      isParallel: false,
      startTime: 0,
      endTime: 0,
      duration: 0,
    });

    // Phase 2: APIs (parallel if overlapping)
    const apiEvents = events.filter(e => e.type === 'http-response');
    if (apiEvents.length > 0) {
      const isParallel = this.detectParallel(apiEvents);
      const minTime = Math.min(...apiEvents.map(e => e.timestamp));
      const maxTime = Math.max(...apiEvents.map(e => e.timestamp));
      phases.push({
        id: 'phase-apis',
        title: 'API Calls',
        steps: [],
        isParallel,
        startTime: minTime,
        endTime: maxTime,
        duration: maxTime - minTime,
      });
    }

    // Phase 3: State Updates
    const stateEvents = events.filter(
      e => e.type === 'store-dispatch' || e.type === 'store-select' || e.type === 'signal-write'
    );
    if (stateEvents.length > 0) {
      const minTime = Math.min(...stateEvents.map(e => e.timestamp));
      const maxTime = Math.max(...stateEvents.map(e => e.timestamp));
      phases.push({
        id: 'phase-state',
        title: 'State Updates',
        steps: [],
        isParallel: false,
        startTime: minTime,
        endTime: maxTime,
        duration: maxTime - minTime,
      });
    }

    // Phase 4: Renders (detected via cascade tree)
    if (action.tree.length > 0) {
      phases.push({
        id: 'phase-renders',
        title: 'Component Renders',
        steps: [],
        isParallel: true, // Renders can happen in parallel
        startTime: events.length > 0 ? Math.max(...events.map(e => e.timestamp)) : 0,
        endTime: action.duration,
        duration: 0,
      });
    }

    // Phase 5: Complete
    phases.push({
      id: 'phase-complete',
      title: 'Complete',
      steps: [],
      isParallel: false,
      startTime: action.duration,
      endTime: action.duration,
      duration: 0,
    });

    return phases;
  }

  private detectParallel(events: FlowEntry[]): boolean {
    if (events.length < 2) return false;

    // Check if events overlap in time
    // For HTTP responses, we'd need start/end times
    // For now, use heuristic: if timestamps are close, assume parallel
    const sorted = events.sort((a, b) => a.timestamp - b.timestamp);
    const timeGap = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;

    // If all events within 50ms window, likely parallel
    return timeGap < 50;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 5: Build Story Steps
  // ────────────────────────────────────────────────────────────────────────────

  private buildStorySteps(
    trigger: StoryStep,
    events: FlowEntry[],
    causality: Map<string, string>,
    action: ActionReplay
  ): StoryStep[] {
    const steps: StoryStep[] = [trigger];

    // Add event steps
    for (const event of events) {
      const stepId = `step-${event.type}-${event.id}`;
      const causedBy = causality.get(stepId);

      const step: StoryStep = {
        id: stepId,
        type: this.mapEventTypeToStepType(event.type),
        icon: event.icon,
        label: event.label,
        detail: event.detail,
        timestamp: event.timestamp,
        severity: this.determineSeverity(event),
        causedBy,
        causes: [],
        eventIds: [event.id],
      };

      steps.push(step);
    }

    // Add render steps (if any)
    if (action.tree.length > 0) {
      const nodes = this.flattenTree(action.tree);
      for (const node of nodes.slice(0, 10)) {
        // Limit to top 10 renders for readability
        const stepId = `step-render-${node.componentName}`;
        steps.push({
          id: stepId,
          type: 'component',
          icon: '📦',
          label: `${this.formatComponentName(node.componentName)}`,
          detail: `${node.count}× renders · ${node.totalDuration.toFixed(1)}ms`,
          timestamp: action.duration, // Approximate
          severity: node.count > 5 ? 'warn' : 'ok',
          causedBy: undefined,
          causes: [],
          eventIds: [],
        });
      }
    }

    // Add complete step
    steps.push({
      id: 'step-complete',
      type: 'complete',
      icon: '✅',
      label: 'Complete',
      detail: `${action.duration.toFixed(1)}ms total`,
      timestamp: action.duration,
      severity: action.frameBudgetExceeded ? 'warn' : 'ok',
      causes: [],
      eventIds: [],
    });

    // Update causes references
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      for (let j = i + 1; j < steps.length; j++) {
        if (steps[j].causedBy === step.id) {
          step.causes.push(steps[j].id);
        }
      }
    }

    return steps;
  }

  private mapEventTypeToStepType(
    eventType: string
  ): 'api' | 'store' | 'signal' | 'component' {
    switch (eventType) {
      case 'http-response':
        return 'api';
      case 'store-dispatch':
      case 'store-select':
        return 'store';
      case 'signal-write':
        return 'signal';
      default:
        return 'component';
    }
  }

  private determineSeverity(event: FlowEntry): 'ok' | 'warn' | 'error' {
    if (event.detail.includes('error') || event.detail.includes('Error')) return 'error';
    if (event.detail.includes('warn') || event.detail.includes('Warn')) return 'warn';
    return 'ok';
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 6: Build Component Tree
  // ────────────────────────────────────────────────────────────────────────────

  private buildComponentTree(action: ActionReplay): ComponentTree {
    const nodes = this.flattenTree(action.tree);
    const root: ComponentNode[] = [];
    const maxDepth = Math.max(...nodes.map(n => n.depth), 0);

    for (const cascadeNode of nodes) {
      const node: ComponentNode = {
        name: cascadeNode.componentName,
        displayName: this.formatComponentName(cascadeNode.componentName),
        renderCount: cascadeNode.count,
        totalDuration: cascadeNode.totalDuration,
        depth: cascadeNode.depth,
        children: cascadeNode.children.map(c => ({
          name: c.componentName,
          displayName: this.formatComponentName(c.componentName),
          renderCount: c.count,
          totalDuration: c.totalDuration,
          depth: c.depth,
          parent: cascadeNode.componentName,
          children: [],
        })),
      };

      if (cascadeNode.depth === 0) {
        root.push(node);
      }
    }

    return {
      root,
      depth: maxDepth,
      totalCount: nodes.length,
    };
  }

  private flattenTree(tree: CascadeNode[]): CascadeNode[] {
    const result: CascadeNode[] = [];
    const seen = new Set<string>();

    const walk = (nodes: CascadeNode[]): void => {
      for (const node of nodes) {
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
    // ng-app-component → App Component
    return name
      .replace(/^ng-/, '')
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 7: Validate
  // ────────────────────────────────────────────────────────────────────────────

  private validate(
    trigger: StoryStep,
    steps: StoryStep[],
    causality: Map<string, string>,
    action: ActionReplay,
    errors: string[],
    warnings: string[]
  ): { valid: boolean; errors: string[]; warnings: string[]; confidence: number } {
    let confidence = 100;

    // Check 1: Timestamp ordering
    for (let i = 0; i < steps.length - 1; i++) {
      if (steps[i].timestamp > steps[i + 1].timestamp) {
        errors.push(
          `Timestamp violation: ${steps[i].label} (${steps[i].timestamp}) after ${steps[i + 1].label} (${steps[i + 1].timestamp})`
        );
        confidence -= 20;
      }
    }

    // Check 2: Causality consistency
    for (const [toId, fromId] of causality) {
      const toStep = steps.find(s => s.id === toId);
      const fromStep = steps.find(s => s.id === fromId);
      if (toStep && fromStep && toStep.timestamp < fromStep.timestamp) {
        warnings.push('Causality violation detected');
        confidence -= 10;
      }
    }

    // Check 3: No missing events
    if (action.totalRenders === 0 && steps.filter(s => s.type === 'component').length === 0) {
      warnings.push('No component renders found (expected if only APIs)');
    }

    // Check 4: Confidence based on data quality
    const dataQuality = steps.filter(s => s.eventIds.length > 0).length / steps.length;
    confidence *= dataQuality;

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      confidence: Math.max(0, Math.min(100, confidence)),
    };
  }

  private createErrorStory(
    action: ActionReplay,
    errors: string[],
    warnings: string[]
  ): ExecutionStory {
    return {
      id: `story-error-${action.id}`,
      actionId: action.id,
      trigger: {
        id: 'step-trigger-error',
        type: 'trigger',
        icon: '⚠️',
        label: 'Error Processing Story',
        timestamp: 0,
        severity: 'error',
        causes: [],
        eventIds: [],
      },
      steps: [],
      phases: [],
      causality: { edges: [] },
      tree: { root: [], depth: 0, totalCount: 0 },
      statistics: {
        totalTime: action.duration,
        totalSteps: 0,
        parallelPhases: 0,
        cascadeDepth: 0,
      },
      validations: {
        valid: false,
        errors,
        warnings,
        confidence: 0,
      },
    };
  }
}
