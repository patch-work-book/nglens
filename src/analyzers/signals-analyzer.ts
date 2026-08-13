/**
 * ngLens - Angular Performance Analyzer
 * Copyright (c) 2026 ngLens Contributors
 * Licensed under MIT
 *
 * https://github.com/gowtham-labs/nglens
 *
 * Signals Performance Analyzer
 *
 * Detects Angular 16+ Signals performance issues:
 * - Expensive computed signals causing over-computation
 * - Unnecessary effects triggering too frequently
 * - Signal/RxJS mixing anti-patterns
 * - Over-granular signal splitting
 * - Missing memoization opportunities
 * - Signal mutations in templates
 *
 * Works in both dev and production mode.
 */

import type {
  Analyzer,
  AnalyzerConfig,
  AnalyzerResult,
  AnalysisIssue,
} from '../types/analyzer';
import type { SignalGraph } from '../types/signal-graph';
import { findAngularComponents } from '../utils/dom-utils';
import { registerAnalyzer } from './index';

class SignalsAnalyzer implements Analyzer {
  readonly type = 'signals-analyzer' as const;
  readonly requiresDevMode = false;
  private transientGraph: SignalGraph | null = null;

  async analyze(config: AnalyzerConfig): Promise<AnalyzerResult> {
    this.transientGraph = { nodes: new Map(), edges: [], glitches: [] };
    const issues: AnalysisIssue[] = [];
    const components = findAngularComponents(document);

    for (const element of components) {
      const componentName = this.getComponentName(element);

      // Skip if we can't analyze this component
      if (!this.canAnalyzeComponent(element)) {
        continue;
      }

      // Get component instance (if available in dev mode)
      const instance = this.getComponentInstance(element);

      if (instance) {
        // Dev mode: Full analysis with access to component code
        issues.push(...this.analyzeComponentInstance(instance, componentName, element));
      } else {
        // Production mode: Heuristic analysis
        issues.push(...this.analyzeComponentHeuristics(element, componentName));
      }
    }

    // Convert Map to Object for serialization
    const graphData = this.transientGraph ? {
      nodes: Object.fromEntries(this.transientGraph.nodes),
      glitches: this.transientGraph.glitches
    } : null;

    return {
      analyzer: this.type,
      issues,
      timestamp: Date.now(),
      duration: 0,
      metadata: {
        componentsScanned: components.length,
        angularVersion: this.detectAngularVersion(),
        supportsSignals: this.checkSignalsSupport(),
        signalGraph: graphData,
      },
    };
  }

  // --- Dev Mode Analysis (with component instance access) ---

  private analyzeComponentInstance(
    instance: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    try {
      // Get all properties from the component
      const properties = this.getComponentProperties(instance);

      for (const [propName, value] of properties) {
        // Check if it's a signal
        if (this.isSignal(value)) {
          issues.push(...this.analyzeSignal(propName, value, componentName, element));
        }
        // Check if it's a computed signal
        else if (this.isComputed(value)) {
          issues.push(...this.analyzeComputed(propName, value, componentName, element));
        }
        // Check if it's an effect
        else if (this.isEffect(value)) {
          issues.push(...this.analyzeEffect(propName, value, componentName, element));
        }
        // Check for signal/RxJS mixing
        else if (this.isObservable(value)) {
          issues.push(...this.checkSignalRxJSMixing(propName, value, instance, componentName, element));
        }
      }

      // Check template for signal usage patterns
      issues.push(...this.analyzeTemplateSignalUsage(element, componentName));

    } catch (error) {
      // Silently skip components that throw errors during analysis
      console.debug(`[SignalsAnalyzer] Error analyzing ${componentName}:`, error);
    }

    return issues;
  }

  private analyzeSignal(
    propName: string,
    signal: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const nodeId = `${componentName}.${propName}`;

    try {
      // Extract graph metadata
      const deps = this.extractSignalDependencies(signal, nodeId);
      
      // Store in transient metadata for the analyzer result
      if (!this.transientGraph) this.transientGraph = { nodes: new Map(), edges: [], glitches: [] };
      this.transientGraph.nodes.set(nodeId, {
        id: nodeId,
        label: propName,
        type: 'signal',
        value: this.summarizeValue(signal()),
        ownerComponent: componentName,
        producers: deps.producers,
        consumers: deps.consumers,
        isDirty: false,
        recalculationCount: 0
      });

      // Get current value
      const value = signal();

      // Check for over-granular signals (too many small signals)
      if (this.isOverGranular(propName, value)) {
        issues.push({
          id: `signal-granular-${componentName}-${propName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'low',
          category: 'best-practices',
          title: `Over-granular signal: ${propName}`,
          description: `Signal '${propName}' stores a primitive value that could be grouped with related signals. This increases memory overhead and can cause unnecessary reactivity.`,
          recommendation: `Consider grouping related signals into a single object signal. Instead of multiple primitive signals, use: ${propName}State = signal({ ${propName}: value, ...otherRelated })`,
          elementSelector: this.buildSelector(element),
          metadata: { signalName: propName, valueType: typeof value },
        });
      }

      // Check if signal holds large arrays/objects without proper equality
      if (this.isLargeCollection(value)) {
        issues.push({
          id: `signal-large-${componentName}-${propName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'medium',
          category: 'render-performance',
          title: `Large collection in signal: ${propName}`,
          description: `Signal '${propName}' contains a large array/object (${this.getCollectionSize(value)} items). Updates trigger full re-renders even if only one item changed.`,
          recommendation: `Use signal.update() with proper equality checking, or consider using a Map/Set for large collections. For read-only data, use computed() with memoization.`,
          elementSelector: this.buildSelector(element),
          metadata: { signalName: propName, collectionSize: this.getCollectionSize(value) },
        });
      }

    } catch (error) {
      // Skip signals that throw on read
    }

    return issues;
  }

  private analyzeComputed(
    propName: string,
    computed: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const nodeId = `${componentName}.${propName}`;

    try {
      // Extract graph metadata
      const deps = this.extractSignalDependencies(computed, nodeId);
      
      if (this.transientGraph) {
        this.transientGraph.nodes.set(nodeId, {
          id: nodeId,
          label: propName,
          type: 'computed',
          value: '(computed)',
          ownerComponent: componentName,
          producers: deps.producers,
          consumers: deps.consumers,
          isDirty: false,
          recalculationCount: 0
        });
      }

      // Try to analyze the computation function
      const computationStr = computed.toString();

      // Check for expensive operations in computed
      if (this.hasExpensiveOperation(computationStr)) {
        issues.push({
          id: `computed-expensive-${componentName}-${propName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'high',
          category: 'render-performance',
          title: `Expensive computed signal: ${propName}`,
          description: `Computed signal '${propName}' contains expensive operations (map, filter, reduce, sort) that run on every dependency change. This can cause performance issues.`,
          recommendation: `Move expensive computations outside the computed signal, or add additional memoization. Consider using a regular signal with manual updates for complex transformations.`,
          elementSelector: this.buildSelector(element),
          metadata: { computedName: propName, operations: this.detectOperations(computationStr) },
        });
      }

      // Check for nested array operations (map inside map)
      if (this.hasNestedArrayOps(computationStr)) {
        issues.push({
          id: `computed-nested-${componentName}-${propName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'critical',
          category: 'render-performance',
          title: `Nested array operations in computed: ${propName}`,
          description: `Computed signal '${propName}' has nested array operations (map/filter/reduce inside another). This creates O(n²) or worse complexity.`,
          recommendation: `Flatten the operations or split into multiple computed signals with proper memoization. Use intermediate signals for each transformation step.`,
          elementSelector: this.buildSelector(element),
          metadata: { computedName: propName },
        });
      }

    } catch (error) {
      // Skip computed signals that can't be analyzed
    }

    return issues;
  }

  private analyzeEffect(
    propName: string,
    effect: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    // Effects are harder to analyze statically, so we flag common anti-patterns
    issues.push({
      id: `effect-review-${componentName}-${propName}`,
      analyzer: this.type,
      component: componentName,
      severity: 'info',
      category: 'best-practices',
      title: `Review effect usage: ${propName}`,
      description: `Component uses effect(). Ensure it's necessary - effects should only be used for side effects like logging, analytics, or DOM manipulation. For derived state, use computed() instead.`,
      recommendation: `Review if this effect can be replaced with computed() or moved to a service. Effects are a last resort for synchronizing with external systems.`,
      elementSelector: this.buildSelector(element),
      metadata: { effectName: propName },
    });

    return issues;
  }

  private checkSignalRxJSMixing(
    propName: string,
    observable: any,
    instance: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    // Check if component has both signals and observables (mixing pattern)
    const hasSignals = this.componentHasSignals(instance);
    const hasObservables = true; // We know it has at least one observable

    if (hasSignals && hasObservables) {
      // Check if there's toSignal() or toObservable() usage
      const hasInterop = this.hasSignalRxJSInterop(instance);

      if (!hasInterop) {
        issues.push({
          id: `signal-rxjs-mix-${componentName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'medium',
          category: 'best-practices',
          title: `Mixing Signals and RxJS without interop`,
          description: `Component uses both Signals and RxJS Observables but doesn't use toSignal() or toObservable() for interoperability. This can lead to unnecessary complexity.`,
          recommendation: `Use toSignal() to convert observables to signals, or toObservable() to convert signals to observables. This provides better reactivity and consistency.`,
          elementSelector: this.buildSelector(element),
          metadata: { hasSignals, hasObservables, hasInterop },
        });
      }
    }

    return issues;
  }

  private analyzeTemplateSignalUsage(element: Element, componentName: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    // Get template (innerHTML) - limited in production
    const template = element.innerHTML;

    // Check for signal calls with arguments (mutation attempt)
    const signalMutationPattern = /(\w+)\s*\(\s*[^)]+\s*\)/g;
    if (signalMutationPattern.test(template)) {
      issues.push({
        id: `signal-mutation-${componentName}`,
        analyzer: this.type,
        component: componentName,
        severity: 'medium',
        category: 'best-practices',
        title: `Possible signal mutation in template`,
        description: `Template contains signal calls with arguments, which might be mutation attempts. Signals should be updated with .set() or .update(), not called with arguments.`,
        recommendation: `If you're trying to update a signal, move the logic to a method that calls signal.set() or signal.update(). Don't mutate signals directly in templates.`,
        elementSelector: this.buildSelector(element),
      });
    }

    return issues;
  }

  // --- Production Mode Heuristics ---

  private analyzeComponentHeuristics(element: Element, componentName: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    // In production, we can only do limited analysis
    // Check Angular version from ng-version attribute
    const version = this.detectAngularVersion();

    if (version && this.versionSupportsSignals(version)) {
      // Component is on Angular 16+ but we can't detect signals in production
      issues.push({
        id: `signals-prod-${componentName}`,
        analyzer: this.type,
        component: componentName,
        severity: 'info',
        category: 'best-practices',
        title: `Signal analysis limited in production`,
        description: `Component is running on Angular ${version} which supports Signals, but detailed signal analysis requires development mode.`,
        recommendation: `Run ngLens in development mode for full signal performance analysis. In production, we can only detect template-level patterns.`,
        elementSelector: this.buildSelector(element),
        metadata: { angularVersion: version },
      });
    }

    return issues;
  }

  // --- Helper Methods ---

  private getComponentName(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    // Convert app-user-list → UserList
    return tagName
      .replace(/^app-/, '')
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  private canAnalyzeComponent(element: Element): boolean {
    // Skip non-Angular elements
    return Array.from(element.attributes).some(attr =>
      attr.name.startsWith('_nghost-') || attr.name.startsWith('ng-')
    );
  }

  private getComponentInstance(element: Element): any {
    // Try to get component instance from Angular debug API
    const ng = (globalThis as any).ng;
    if (!ng) return null;

    try {
      const debugElement = ng.getComponent ? ng.getComponent(element) : null;
      return debugElement;
    } catch {
      return null;
    }
  }

  private getComponentProperties(instance: any): Map<string, any> {
    const props = new Map();

    try {
      for (const key in instance) {
        if (instance.hasOwnProperty(key) && !key.startsWith('_')) {
          props.set(key, instance[key]);
        }
      }
    } catch {
      // Skip if property access fails
    }

    return props;
  }

  /**
   * Extracts the dependency graph for a signal/computed node.
   * Traverses Angular's internal reactive graph via the brand symbol.
   */
  private extractSignalDependencies(signal: any, nodeId: string): { producers: string[], consumers: string[] } {
    const producers: string[] = [];
    const consumers: string[] = [];

    try {
      // Find the internal brand symbol (varies slightly by Angular version, usually contains 'SIGNAL')
      const syms = Object.getOwnPropertySymbols(signal);
      const brandSym = syms.find(s => s.description?.includes('SIGNAL') || String(s).includes('SIGNAL'));
      
      if (!brandSym) return { producers, consumers };
      
      const node = signal[brandSym];
      if (!node) return { producers, consumers };

      // Producers: What this node depends on (upstream)
      // Supports both 'producerNode' (standard) and 'producers' (older/alternative internal names)
      const rawProducers = node.producerNode || node.producers || node.producer;
      if (rawProducers) {
        const producerNodes = Array.isArray(rawProducers) ? rawProducers : [rawProducers];
        producerNodes.forEach((p: any) => {
          // Extract ID or property name if ID is missing
          const pId = p.id || p.debugName || p.name;
          if (pId) producers.push(pId);
        });
      }

      // Consumers: What depends on this node (downstream)
      const rawConsumers = node.liveConsumerNode || node.consumers;
      if (rawConsumers) {
        const consumerNodes = Array.isArray(rawConsumers) ? rawConsumers : [rawConsumers];
        consumerNodes.forEach((c: any) => {
          // If consumer is another signal/computed, it will have an ID or debugName
          const cId = c.id || c.debugName || c.name;
          if (cId) {
            consumers.push(cId);
          } else if (c.lView || c.template) {
            consumers.push('Template');
          } else if (c.fn) {
            consumers.push('Effect');
          }
        });
      }
    } catch (e) {
      console.debug('[SignalsAnalyzer] Failed to extract dependencies:', e);
    }

    return { producers, consumers };
  }

  private isSignal(value: any): boolean {
    // Check if value is a Signal (has Symbol.toStringTag === 'Signal')
    return value && typeof value === 'function' && value[Symbol.toStringTag] === 'Signal';
  }

  private isComputed(value: any): boolean {
    // Computed signals also have Symbol.toStringTag but with 'Computed'
    return value && typeof value === 'function' &&
           (value[Symbol.toStringTag] === 'Computed' || value.constructor?.name === 'ComputedImpl');
  }

  private isEffect(value: any): boolean {
    // Effects are functions with specific internal properties
    return value && typeof value === 'function' && value.constructor?.name?.includes('Effect');
  }

  private isObservable(value: any): boolean {
    // Check if it's an RxJS Observable
    return value && typeof value.subscribe === 'function';
  }

  private isOverGranular(propName: string, value: any): boolean {
    // Primitive values that are likely part of a group
    return (
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') &&
      (propName.endsWith('Id') || propName.endsWith('Name') || propName.endsWith('Flag'))
    );
  }

  private isLargeCollection(value: any): boolean {
    if (Array.isArray(value)) {
      return value.length > 100;
    }
    if (value && typeof value === 'object') {
      return Object.keys(value).length > 50;
    }
    return false;
  }

  private getCollectionSize(value: any): number {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return 0;
  }

  private hasExpensiveOperation(code: string): boolean {
    const expensiveOps = ['.map(', '.filter(', '.reduce(', '.sort(', '.find('];
    return expensiveOps.some(op => code.includes(op));
  }

  private hasNestedArrayOps(code: string): boolean {
    // Simple regex to detect nested .map, .filter, etc.
    const nestedPattern = /\.(map|filter|reduce)\([^)]*\.(map|filter|reduce)\(/;
    return nestedPattern.test(code);
  }

  private detectOperations(code: string): string[] {
    const ops: string[] = [];
    if (code.includes('.map(')) ops.push('map');
    if (code.includes('.filter(')) ops.push('filter');
    if (code.includes('.reduce(')) ops.push('reduce');
    if (code.includes('.sort(')) ops.push('sort');
    return ops;
  }

  private componentHasSignals(instance: any): boolean {
    try {
      for (const key in instance) {
        if (this.isSignal(instance[key]) || this.isComputed(instance[key])) {
          return true;
        }
      }
    } catch {
      // Skip if enumeration fails
    }
    return false;
  }

  private hasSignalRxJSInterop(instance: any): boolean {
    const code = instance.constructor.toString();
    return code.includes('toSignal') || code.includes('toObservable');
  }

  private detectAngularVersion(): string | null {
    const versionEl = document.querySelector('[ng-version]');
    return versionEl?.getAttribute('ng-version') || null;
  }

  private checkSignalsSupport(): boolean {
    const version = this.detectAngularVersion();
    return version ? this.versionSupportsSignals(version) : false;
  }

  private versionSupportsSignals(version: string): boolean {
    const major = parseInt(version.split('.')[0]);
    return major >= 16; // Signals introduced in Angular 16
  }

  private buildSelector(element: Element): string {
    // Build CSS selector
    const tagName = element.tagName.toLowerCase();
    const ngHost = Array.from(element.attributes).find(attr => attr.name.startsWith('_nghost-'));

    if (ngHost) {
      return `${tagName}[${ngHost.name}]`;
    }

    return tagName;
  }

  dispose(): void {
    /* no-op */
  }
}

// Auto-register the analyzer
registerAnalyzer(new SignalsAnalyzer());
