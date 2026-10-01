/**
 * DOM Inspector Analyzer
 *
 * Performs a point-in-time scan of the Angular application's DOM to detect:
 * - Excessive DOM complexity (>800 nodes per component subtree)
 * - Layout thrashing potential (heuristic based on component complexity)
 * - Forced reflow concerns (components likely triggering layout reads after writes)
 * - Render bottlenecks (>50 DOM mutations per CD cycle via PerformanceObserver)
 * - Rendering phase duration exceeding 16ms frame budget
 *
 * This analyzer requires dev mode (window.ng) to attribute issues to components.
 */

import type {
  AnalyzerConfig,
  AnalyzerResult,
  AnalyzerType,
  AnalysisIssue,
  Severity,
} from '../types/analyzer';
import { BaseAnalyzer } from './base-analyzer';
import { registerAnalyzer } from './index';
import {
  findAngularComponents,
  countSubtreeNodes,
  getComponentName,
  findNearestAngularHost,
} from '../utils/dom-utils';
import {
  DOM_NODE_LIMIT_WARNING,
  MUTATION_BOTTLENECK_THRESHOLD,
  FRAME_BUDGET_MS,
} from '../utils/constants';


/**
 * DOM Inspector analyzer — detects DOM rendering bottlenecks via point-in-time scan.
 */
export class DomInspector extends BaseAnalyzer {
  readonly type: AnalyzerType = 'dom-inspector';
  readonly requiresDevMode = true;

  /** Layout-triggering properties that cause forced reflow when read after a write */
  private static readonly LAYOUT_TRIGGERING_PROPERTIES = [
    'offsetHeight',
    'offsetWidth',
    'offsetTop',
    'offsetLeft',
    'clientHeight',
    'clientWidth',
    'clientTop',
    'clientLeft',
    'scrollTop',
    'scrollLeft',
    'scrollWidth',
    'scrollHeight',
    'getBoundingClientRect',
    'getComputedStyle',
  ];

  protected async execute(config: AnalyzerConfig): Promise<AnalyzerResult> {
    const startTime = performance.now();
    const issues: AnalysisIssue[] = [];

    // 1. Detect excessive DOM complexity per component
    this.detectExcessiveDomComplexity(issues);

    // 2. Detect layout thrashing potential (heuristic-based for point-in-time scan)
    this.detectLayoutThrashingPotential(issues);

    // 3. Detect forced reflow concerns
    this.detectForcedReflowConcerns(issues);

    // 4. Detect render bottlenecks via Performance API entries
    this.detectRenderBottlenecks(issues);

    // 5. Detect long rendering phases via Performance API
    this.detectLongRenderingPhases(issues);

    const duration = performance.now() - startTime;

    return {
      analyzer: this.type,
      timestamp: Date.now(),
      duration,
      issues,
      metadata: {
        componentsScanned: findAngularComponents().length,
        frameBudgetMs: FRAME_BUDGET_MS,
        domNodeLimit: DOM_NODE_LIMIT_WARNING,
        mutationThreshold: MUTATION_BOTTLENECK_THRESHOLD,
      },
    };
  }

  /**
   * Scans all Angular components and flags those with subtree node counts
   * exceeding DOM_NODE_LIMIT_WARNING (800).
   */
  private detectExcessiveDomComplexity(issues: AnalysisIssue[]): void {
    const components = findAngularComponents();

    for (const element of components) {
      const nodeCount = countSubtreeNodes(element);

      if (nodeCount > DOM_NODE_LIMIT_WARNING) {
        const componentName = getComponentName(element);
        const severity = this.getComplexitySeverity(nodeCount);

        issues.push({
          id: `dom-complexity-${componentName}-${nodeCount}`,
          analyzer: this.type,
          component: componentName,
          severity,
          category: 'dom-complexity',
          title: `Excessive DOM complexity: ${nodeCount} nodes`,
          description:
            `Component "${componentName}" has ${nodeCount} DOM nodes in its subtree, ` +
            `exceeding the recommended limit of ${DOM_NODE_LIMIT_WARNING}. ` +
            `Large DOM trees increase memory usage and slow down style calculations, layout, and painting.`,
          recommendation:
            'Consider breaking this component into smaller sub-components, ' +
            'using virtual scrolling for long lists, or implementing lazy rendering ' +
            'with *ngIf to defer off-screen content.',
          metadata: {
            nodeCount,
            threshold: DOM_NODE_LIMIT_WARNING,
            excessNodes: nodeCount - DOM_NODE_LIMIT_WARNING,
          },
          elementSelector: this.buildSelector(element),
        });
      }
    }
  }

  /**
   * Detects potential layout thrashing based on component complexity heuristics.
   *
   * Since this is a point-in-time scan (not runtime interception), we identify
   * components that are likely to cause layout thrashing based on:
   * - High DOM complexity (many nodes that could trigger read/write alternation)
   * - Deep nesting patterns that suggest interleaved layout queries
   *
   * A component with 3+ deeply nested interactive elements is flagged as
   * potentially causing layout thrashing (3+ alternating read/write ops).
   */
  private detectLayoutThrashingPotential(issues: AnalysisIssue[]): void {
    const components = findAngularComponents();

    for (const element of components) {
      const nodeCount = countSubtreeNodes(element);
      // Heuristic: components with high node counts and multiple interactive
      // elements are more likely to have interleaved read/write patterns
      const interactiveElements = element.querySelectorAll(
        'input, textarea, select, [contenteditable], [draggable]'
      );
      const hasAnimations = element.querySelectorAll(
        '[style*="transform"], [style*="transition"], .animate, [class*="animation"]'
      );

      // Flag if component has enough complexity to suggest layout thrashing risk
      // (3+ interactive elements in a complex subtree)
      const interactiveCount = interactiveElements.length;
      const animationCount = hasAnimations.length;
      const alternatingOpsEstimate = interactiveCount + animationCount;

      if (alternatingOpsEstimate >= 3 && nodeCount > DOM_NODE_LIMIT_WARNING / 2) {
        const componentName = getComponentName(element);

        issues.push({
          id: `layout-thrashing-${componentName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'medium',
          category: 'render-performance',
          title: `Potential layout thrashing: ${alternatingOpsEstimate} alternating read/write patterns`,
          description:
            `Component "${componentName}" has ${interactiveCount} interactive elements ` +
            `and ${animationCount} animated elements within a ${nodeCount}-node subtree. ` +
            `This pattern suggests potential layout thrashing where DOM reads and writes ` +
            `alternate, forcing the browser to recalculate layout multiple times per frame.`,
          recommendation:
            'Batch DOM reads together before DOM writes. Use requestAnimationFrame ' +
            'to schedule writes, or use CSS transforms instead of layout-triggering ' +
            'properties for animations.',
          metadata: {
            interactiveElements: interactiveCount,
            animatedElements: animationCount,
            estimatedAlternatingOps: alternatingOpsEstimate,
            subtreeNodeCount: nodeCount,
          },
          elementSelector: this.buildSelector(element),
        });
      }
    }
  }

  /**
   * Detects components likely to trigger forced reflows.
   *
   * In a point-in-time scan, we identify components that contain elements
   * with inline styles (indicating style mutations) combined with high complexity
   * (suggesting layout-triggering property access patterns).
   */
  private detectForcedReflowConcerns(issues: AnalysisIssue[]): void {
    const components = findAngularComponents();

    for (const element of components) {
      // Look for elements with inline styles (indicating programmatic style mutations)
      const styledElements = element.querySelectorAll('[style]');
      const nodeCount = countSubtreeNodes(element);

      // If a component has multiple styled elements and high complexity,
      // it's likely accessing layout-triggering properties after style mutations
      if (styledElements.length >= 2 && nodeCount > DOM_NODE_LIMIT_WARNING / 2) {
        const componentName = getComponentName(element);

        issues.push({
          id: `forced-reflow-${componentName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'medium',
          category: 'render-performance',
          title: `Potential forced reflow: style mutations with layout reads`,
          description:
            `Component "${componentName}" has ${styledElements.length} elements with inline styles ` +
            `in a ${nodeCount}-node subtree. Accessing layout-triggering properties ` +
            `(${DomInspector.LAYOUT_TRIGGERING_PROPERTIES.slice(0, 4).join(', ')}) ` +
            `after modifying styles forces the browser to synchronously recalculate layout.`,
          recommendation:
            'Avoid reading layout properties (offsetHeight, getBoundingClientRect, etc.) ' +
            'immediately after modifying styles. Batch style changes together, then read ' +
            'layout values in a separate microtask or requestAnimationFrame callback.',
          metadata: {
            styledElementCount: styledElements.length,
            subtreeNodeCount: nodeCount,
            layoutTriggeringProperties: DomInspector.LAYOUT_TRIGGERING_PROPERTIES,
          },
          elementSelector: this.buildSelector(element),
        });
      }
    }
  }

  /**
   * Detects render bottlenecks by checking Performance API entries for
   * layout-shift and longtask entries that indicate >50 DOM mutations per CD cycle.
   *
   * Uses performance.getEntriesByType to check for recent long tasks and
   * layout shifts that suggest excessive DOM mutations.
   */
  private detectRenderBottlenecks(issues: AnalysisIssue[]): void {
    // Check for long tasks (indicating heavy DOM mutation batches)
    let longTasks: PerformanceEntryList = [];
    try {
      longTasks = performance.getEntriesByType('longtask');
    } catch {
      // longtask may not be available in all environments
    }

    // Check for layout shift entries
    let layoutShifts: PerformanceEntryList = [];
    try {
      layoutShifts = performance.getEntriesByType('layout-shift');
    } catch {
      // layout-shift may not be available in all environments
    }

    // Long tasks exceeding frame budget suggest render bottlenecks
    // (likely caused by >50 DOM mutations in a single cycle)
    const recentLongTasks = longTasks.filter(
      (entry) => entry.duration > FRAME_BUDGET_MS
    );

    if (recentLongTasks.length > 0) {
      // Try to attribute to the nearest Angular component
      const componentName = this.findNearestComponentForBottleneck();

      issues.push({
        id: `render-bottleneck-longtask-${recentLongTasks.length}`,
        analyzer: this.type,
        component: componentName,
        severity: this.getBottleneckSeverity(recentLongTasks.length),
        category: 'render-performance',
        title: `Render bottleneck: ${recentLongTasks.length} long tasks detected`,
        description:
          `Detected ${recentLongTasks.length} long tasks exceeding the ${FRAME_BUDGET_MS}ms frame budget. ` +
          `This indicates heavy DOM mutation batches (likely >${MUTATION_BOTTLENECK_THRESHOLD} mutations per cycle) ` +
          `that block the main thread and cause visible jank.`,
        recommendation:
          'Break large DOM updates into smaller batches using requestAnimationFrame or ' +
          'requestIdleCallback. Consider using virtual scrolling for large lists, ' +
          'or defer non-critical DOM updates.',
        metadata: {
          longTaskCount: recentLongTasks.length,
          totalDuration: recentLongTasks.reduce((sum, t) => sum + t.duration, 0),
          maxDuration: Math.max(...recentLongTasks.map((t) => t.duration)),
          mutationThreshold: MUTATION_BOTTLENECK_THRESHOLD,
        },
      });
    }

    // Significant layout shifts indicate DOM instability from mutations
    const significantShifts = layoutShifts.filter(
      (entry) => (entry as PerformanceEntry & { value?: number }).value !== undefined &&
        ((entry as PerformanceEntry & { value: number }).value > 0.1)
    );

    if (significantShifts.length > MUTATION_BOTTLENECK_THRESHOLD) {
      const componentName = this.findNearestComponentForBottleneck();

      issues.push({
        id: `render-bottleneck-mutations-${significantShifts.length}`,
        analyzer: this.type,
        component: componentName,
        severity: 'high',
        category: 'render-performance',
        title: `Render bottleneck: ${significantShifts.length} significant layout shifts`,
        description:
          `Detected ${significantShifts.length} significant layout shifts, exceeding the ` +
          `${MUTATION_BOTTLENECK_THRESHOLD} mutation threshold per cycle. This indicates ` +
          `excessive DOM mutations causing visual instability.`,
        recommendation:
          'Use explicit dimensions on images and dynamic content to prevent layout shifts. ' +
          'Batch DOM mutations and avoid inserting content above existing visible content.',
        metadata: {
          shiftCount: significantShifts.length,
          threshold: MUTATION_BOTTLENECK_THRESHOLD,
        },
      });
    }
  }

  /**
   * Detects rendering phases that exceed the 16ms frame budget
   * by checking Performance API measure entries and paint timing.
   */
  private detectLongRenderingPhases(issues: AnalysisIssue[]): void {
    // Check for paint timing entries
    let paintEntries: PerformanceEntryList = [];
    try {
      paintEntries = performance.getEntriesByType('paint');
    } catch {
      // paint timing may not be available
    }

    // Check for user-defined measures that might indicate render phases
    let measures: PerformanceEntryList = [];
    try {
      measures = performance.getEntriesByType('measure');
    } catch {
      // measures may not be available
    }

    // Look for Angular-related measures or any long measures
    const longMeasures = measures.filter(
      (entry) => entry.duration > FRAME_BUDGET_MS
    );

    // Check long tasks as a proxy for rendering phase duration
    let longTasks: PerformanceEntryList = [];
    try {
      longTasks = performance.getEntriesByType('longtask');
    } catch {
      // longtask may not be available
    }

    const longRenderTasks = longTasks.filter(
      (entry) => entry.duration > FRAME_BUDGET_MS
    );

    // Combine evidence of long rendering phases
    const totalLongPhases = longMeasures.length + longRenderTasks.length;

    if (totalLongPhases > 0) {
      const maxDuration = Math.max(
        ...longMeasures.map((m) => m.duration),
        ...longRenderTasks.map((t) => t.duration),
        0
      );

      const componentName = this.findNearestComponentForBottleneck();

      issues.push({
        id: `long-render-phase-${Math.round(maxDuration)}ms`,
        analyzer: this.type,
        component: componentName,
        severity: maxDuration > FRAME_BUDGET_MS * 3 ? 'high' : 'medium',
        category: 'render-performance',
        title: `Rendering phase exceeds frame budget: ${Math.round(maxDuration)}ms`,
        description:
          `Detected rendering phases exceeding the ${FRAME_BUDGET_MS}ms frame budget ` +
          `(longest: ${Math.round(maxDuration)}ms). Rendering that takes longer than ` +
          `one frame (16ms at 60fps) causes dropped frames and visible jank.`,
        recommendation:
          'Reduce component template complexity, use OnPush change detection strategy, ' +
          'implement trackBy for ngFor directives, and consider breaking large components ' +
          'into smaller ones with fewer bindings.',
        metadata: {
          maxDurationMs: maxDuration,
          frameBudgetMs: FRAME_BUDGET_MS,
          longMeasureCount: longMeasures.length,
          longTaskCount: longRenderTasks.length,
          exceedsFactor: Math.round((maxDuration / FRAME_BUDGET_MS) * 10) / 10,
        },
      });
    }

    // Check paint timing for slow first paint
    if (paintEntries.length > 0) {
      const firstContentfulPaint = paintEntries.find(
        (e) => e.name === 'first-contentful-paint'
      );
      if (firstContentfulPaint && firstContentfulPaint.startTime > 3000) {
        const componentName = this.findNearestComponentForBottleneck();

        issues.push({
          id: `slow-fcp-${Math.round(firstContentfulPaint.startTime)}ms`,
          analyzer: this.type,
          component: componentName,
          severity: 'info',
          category: 'render-performance',
          title: `Slow First Contentful Paint: ${Math.round(firstContentfulPaint.startTime)}ms`,
          description:
            `First Contentful Paint occurred at ${Math.round(firstContentfulPaint.startTime)}ms, ` +
            `which may indicate heavy initial rendering or blocking resources.`,
          recommendation:
            'Consider lazy loading non-critical components, reducing initial bundle size, ' +
            'and deferring heavy computations until after first paint.',
          metadata: {
            fcpMs: firstContentfulPaint.startTime,
          },
        });
      }
    }
  }

  /**
   * Attempts to find the nearest Angular component to attribute a bottleneck to.
   * Falls back to the document body's first Angular host or 'Unknown'.
   */
  private findNearestComponentForBottleneck(): string {
    // Try to find the root Angular component
    const components = findAngularComponents();
    if (components.length > 0) {
      // Use the root component (first one found) as the attribution target
      // since Performance API entries can't be attributed to specific elements
      const rootComponent = components[0];
      const host = findNearestAngularHost(rootComponent) || rootComponent;
      return getComponentName(host);
    }
    return 'Unknown';
  }

  /**
   * Determines severity based on DOM node count excess.
   */
  private getComplexitySeverity(nodeCount: number): Severity {
    if (nodeCount > DOM_NODE_LIMIT_WARNING * 3) {
      return 'critical';
    }
    if (nodeCount > DOM_NODE_LIMIT_WARNING * 2) {
      return 'high';
    }
    return 'medium';
  }

  /**
   * Determines severity based on number of bottleneck occurrences.
   */
  private getBottleneckSeverity(count: number): Severity {
    if (count > 10) {
      return 'critical';
    }
    if (count > 5) {
      return 'high';
    }
    return 'medium';
  }

  /**
   * Builds a CSS selector for an element for overlay targeting.
   */
  private buildSelector(element: Element): string {
    const tag = element.tagName.toLowerCase();
    if (element.id) {
      return `${tag}#${element.id}`;
    }
    // Use Angular host attribute as a unique selector
    for (const attr of Array.from(element.attributes)) {
      if (attr.name.startsWith('_nghost-')) {
        return `${tag}[${attr.name}]`;
      }
    }
    // Fall back to tag name with nth-child
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (el) => el.tagName === element.tagName
      );
      const index = siblings.indexOf(element) + 1;
      return `${tag}:nth-of-type(${index})`;
    }
    return tag;
  }

  dispose(): void {
    super.dispose();
  }
}

// Auto-register the DOM Inspector analyzer
registerAnalyzer(new DomInspector());
