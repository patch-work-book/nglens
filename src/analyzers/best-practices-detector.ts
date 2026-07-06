/**
 * Best Practices Detector — V1 Scope
 *
 * Detects common Angular anti-patterns and provides educational guidance:
 * 1. Functions called directly in templates (causes re-execution on every CD cycle)
 * 2. Missing trackBy in *ngFor (causes full DOM re-render on list changes)
 *
 * Each issue includes:
 * - learningTopic: categorization for educational grouping
 * - whyBad: concise explanation of the performance impact
 * - betterApproach: code example showing the correct pattern
 *
 * Requires development mode (window.ng) to inspect component templates.
 */

import type {
  AnalyzerConfig,
  AnalyzerResult,
  AnalyzerType,
  AnalysisIssue,
} from '../types/analyzer';
import { BaseAnalyzer } from './base-analyzer';
import { registerAnalyzer } from './index';
import { findAngularComponents, getComponentName } from '../utils/dom-utils';
import { now } from '../utils/timing';
import { MAX_ELEMENTS_PER_SCAN } from '../utils/constants';

// --- Angular lifecycle hooks to exclude from template-bound method detection ---
const LIFECYCLE_HOOKS = new Set([
  'ngOnInit',
  'ngOnDestroy',
  'ngOnChanges',
  'ngDoCheck',
  'ngAfterContentInit',
  'ngAfterContentChecked',
  'ngAfterViewInit',
  'ngAfterViewChecked',
]);

const TEMPLATE_COMPUTATION_PREFIXES = [
  'get',
  'compute',
  'calculate',
  'format',
  'is',
  'has',
  'should',
  'can',
];

// --- Educational content for detected issues ---

const FUNCTION_IN_TEMPLATE_CONTENT = {
  learningTopic: 'Change Detection',
  whyBad:
    'Functions called in templates are re-executed on every change detection cycle, even when their inputs have not changed. This can cause significant performance degradation in frequently-checked components.',
  betterApproach: `// Instead of calling a method in the template:
// <div>{{ getFullName() }}</div>

// Use a getter with OnPush, or better, a pipe:
@Pipe({ name: 'fullName', pure: true })
export class FullNamePipe implements PipeTransform {
  transform(user: User): string {
    return \`\${user.firstName} \${user.lastName}\`;
  }
}
// <div>{{ user | fullName }}</div>`,
};

const MISSING_TRACKBY_CONTENT = {
  learningTopic: 'Template Best Practices',
  whyBad:
    'Without trackBy, Angular destroys and recreates all DOM elements in the list whenever the array reference changes. This causes unnecessary DOM manipulation and can degrade performance with large lists.',
  betterApproach: `// Instead of:
// <div *ngFor="let item of items">{{ item.name }}</div>

// Add a trackBy function:
// <div *ngFor="let item of items; trackBy: trackById">{{ item.name }}</div>

trackById(index: number, item: Item): number {
  return item.id;
}`,
};

/**
 * BestPracticesDetector analyzes Angular components for common anti-patterns
 * and provides educational explanations with fix examples.
 */
export class BestPracticesDetector extends BaseAnalyzer {
  readonly type: AnalyzerType = 'best-practices-detector';
  readonly requiresDevMode = true;

  protected async execute(config: AnalyzerConfig): Promise<AnalyzerResult> {
    const startTime = now();
    const issues: AnalysisIssue[] = [];

    const components = findAngularComponents();
    const limit = Math.min(components.length, config.maxElements ?? MAX_ELEMENTS_PER_SCAN);
    const ng = (globalThis as any).ng;

    for (let i = 0; i < limit; i++) {
      const element = components[i];
      const componentName = getComponentName(element);

      // Get the Angular component instance via globalThis.ng
      if (!ng?.getComponent) {
        break;
      }

      let component: any;
      try {
        component = ng.getComponent(element);
      } catch {
        continue;
      }

      if (!component) {
        continue;
      }

      // Detect functions likely called in templates
      const templateFunctionIssues = this.detectTemplateFunctions(
        component,
        componentName,
        element
      );
      issues.push(...templateFunctionIssues);

      // Detect missing trackBy in *ngFor
      const trackByIssues = this.detectMissingTrackBy(
        component,
        componentName,
        element
      );
      issues.push(...trackByIssues);

      // Detect template metrics issues (Binding Density and High-Frequency Listeners)
      const templateMetricsIssues = this.detectTemplateMetrics(
        element,
        component,
        componentName
      );
      issues.push(...templateMetricsIssues);
    }

    const duration = now() - startTime;

    return {
      analyzer: this.type,
      timestamp: Date.now(),
      duration,
      issues,
      metadata: {
        componentsAnalyzed: limit,
        totalIssues: issues.length,
      },
    };
  }

  /**
   * Detects public methods on a component that are likely called in templates.
   *
   * Heuristic: identifies public methods (not lifecycle hooks, not starting with 'ng',
   * not prefixed with underscore) that exist on the component prototype. These are
   * likely template-bound and will re-execute on every change detection cycle.
   *
   * For a more accurate check, we inspect the component's ɵcmp template metadata
   * when available.
   */
  private detectTemplateFunctions(
    component: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    try {
      const proto = Object.getPrototypeOf(component);
      if (!proto) return issues;

      const templateString = this.getCompiledTemplateString(component);
      const publicMethods = this.collectPublicMethods(proto);

      if (templateString) {
        // Accurate path: check compiled template function for method references
        for (const methodName of publicMethods) {
          if (templateString.includes(methodName)) {
            issues.push(this.createTemplateFunctionIssue(componentName, methodName, element));
          }
        }
      } else {
        // Fallback heuristic: flag methods that look like computed values
        for (const methodName of publicMethods) {
          if (this.looksLikeTemplateComputation(methodName)) {
            issues.push(this.createTemplateFunctionIssue(componentName, methodName, element));
          }
        }
      }
    } catch {
      // Silently skip components that can't be inspected
    }

    return issues;
  }

  /**
   * Collects public methods from a component prototype, excluding lifecycle hooks
   * and private/internal methods.
   */
  private collectPublicMethods(proto: any): string[] {
    return Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .filter((name) => !name.startsWith('_'))
      .filter((name) => !LIFECYCLE_HOOKS.has(name))
      .filter((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        return Boolean(descriptor && typeof descriptor.value === 'function');
      });
  }

  /**
   * Determines if a method name looks like a template-bound computation
   * (as opposed to an event handler or utility method).
   */
  private looksLikeTemplateComputation(methodName: string): boolean {
    // Skip likely event handlers (onClick, onSubmit, etc.)
    if (methodName.startsWith('on') && methodName.length > 2) return false;
    // Skip common non-template methods
    if (methodName === 'toString' || methodName === 'valueOf') return false;

    // Flag methods that look like they compute/return values
    return TEMPLATE_COMPUTATION_PREFIXES.some((prefix) => methodName.startsWith(prefix));
  }

  private getCompiledTemplateString(component: any): string | null {
    const template = component.constructor?.ɵcmp?.template;
    return typeof template === 'function' ? template.toString() : null;
  }

  /**
   * Detects *ngFor directives without trackBy functions.
   *
   * Inspects the component's template metadata (ɵcmp) for ngFor usage
   * without a corresponding trackBy binding.
   */
  private detectMissingTrackBy(
    component: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    try {
      const templateString = this.getCompiledTemplateString(component);

      if (templateString) {

        const hasNgFor =
          templateString.includes('ngForOf') || templateString.includes('NgForOf');
        const hasTrackBy =
          templateString.includes('ngForTrackBy') || templateString.includes('trackBy');

        if (hasNgFor && !hasTrackBy) {
          issues.push(this.createMissingTrackByIssue(componentName, element));
        }
      } else if (this.hasNgForWithoutTrackBy(component, element)) {
        // Fallback: check DOM comment nodes for *ngFor indicators
        issues.push(this.createMissingTrackByIssue(componentName, element));
      }
    } catch {
      // Silently skip components that can't be inspected
    }

    return issues;
  }

  /**
   * Fallback detection: checks DOM comment nodes for ngFor usage and
   * verifies the component lacks a trackBy method.
   */
  private hasNgForWithoutTrackBy(component: any, element: Element): boolean {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_COMMENT, null);

    let hasNgForComment = false;
    let commentCount = 0;
    const maxComments = 100;

    while (walker.nextNode() && commentCount < maxComments) {
      commentCount++;
      const comment = walker.currentNode as Comment;
      if (comment.textContent?.includes('ngFor')) {
        hasNgForComment = true;
        break;
      }
    }

    if (!hasNgForComment) return false;

    // Check if the component has any trackBy-like method
    const proto = Object.getPrototypeOf(component);
    if (!proto) return true;

    const hasTrackByMethod = Object.getOwnPropertyNames(proto).some(
      (name) => name.toLowerCase().includes('trackby') || name.toLowerCase().includes('track')
    );

    return !hasTrackByMethod;
  }

  /**
   * Creates an AnalysisIssue for a function called in a template.
   */
  private createTemplateFunctionIssue(
    componentName: string,
    methodName: string,
    element: Element
  ): AnalysisIssue {
    return {
      id: `best-practices-template-fn-${componentName}-${methodName}`,
      analyzer: this.type,
      component: componentName,
      severity: 'medium',
      category: 'best-practices',
      title: `Function "${methodName}()" called in template`,
      description: `The method "${methodName}()" in ${componentName} is likely called directly in the template. ${FUNCTION_IN_TEMPLATE_CONTENT.whyBad}`,
      recommendation:
        'Replace the template function call with a pure pipe or a computed property. ' +
        'For simple transformations, use Angular\'s built-in pipes. For complex logic, create a custom pure pipe.',
      metadata: {
        learningTopic: FUNCTION_IN_TEMPLATE_CONTENT.learningTopic,
        whyBad: FUNCTION_IN_TEMPLATE_CONTENT.whyBad,
        betterApproach: FUNCTION_IN_TEMPLATE_CONTENT.betterApproach,
        methodName,
      },
      elementSelector: this.buildSelector(element),
    };
  }

  /**
   * Creates an AnalysisIssue for missing trackBy in *ngFor.
   */
  private createMissingTrackByIssue(
    componentName: string,
    element: Element
  ): AnalysisIssue {
    return {
      id: `best-practices-missing-trackby-${componentName}`,
      analyzer: this.type,
      component: componentName,
      severity: 'medium',
      category: 'best-practices',
      title: 'Missing trackBy in *ngFor',
      description: `${componentName} uses *ngFor without a trackBy function. ${MISSING_TRACKBY_CONTENT.whyBad}`,
      recommendation:
        'Add a trackBy function that returns a unique identifier for each item. ' +
        'This allows Angular to track which items changed and only update those DOM elements.',
      metadata: {
        learningTopic: MISSING_TRACKBY_CONTENT.learningTopic,
        whyBad: MISSING_TRACKBY_CONTENT.whyBad,
        betterApproach: MISSING_TRACKBY_CONTENT.betterApproach,
      },
      elementSelector: this.buildSelector(element),
    };
  }

  /**
   * Adopts custom template metrics scanning from Ivy LView/TView context.
   */
  private detectTemplateMetrics(
    element: Element,
    component: any,
    componentName: string
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const ng = (globalThis as any).ng;

    try {
      if (!ng) return issues;
      
      const cmpDef = component.constructor?.ɵcmp;
      const lViews = ng.getInternalComponents?.(element) || [];
      const lView = lViews[0] || (element as any).__ngContext__;
      const tView = lView ? lView[1] : null;

      if (!tView) return issues;

      // 1. Calculate binding density properties
      const totalBindingsCount = tView.bindingStartIndex ? (lView.length - tView.bindingStartIndex) : 0;
      
      // 2. Inspect Event Listeners tied to this template's DOM footprint
      const nativeListeners = ng.getListeners?.(element) || [];
      const highFrequencyTriggers = nativeListeners.filter((l: any) => 
        ['mousemove', 'scroll', 'pointermove', 'wheel'].includes(l.name)
      );

      // Flag 1: High frequency zone pollution listeners
      if (highFrequencyTriggers.length > 0) {
        issues.push({
          id: `best-practices-high-freq-listeners-${componentName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'high',
          category: 'best-practices',
          title: 'High-frequency listeners tied to DOM footprint',
          description: `Component ${componentName} has active event listeners for high-frequency triggers: [${highFrequencyTriggers.map((t: any) => t.name).join(', ')}]. These run inside Angular's Zone, forcing a complete change detection sweep for every single mouse move/scroll tick.`,
          recommendation: `Move high-frequency event handlers (e.g. scroll, mousemove) outside the Angular zone using NgZone.runOutsideAngular() or use RxJS throttleTime/debounceTime with passive listeners.`,
          metadata: {
            highFrequencyEvents: highFrequencyTriggers.map((t: any) => t.name),
            totalListeners: nativeListeners.length
          },
          elementSelector: this.buildSelector(element)
        });
      }

      // Flag 2: Extreme template binding density (e.g., > 50)
      if (totalBindingsCount > 50) {
        issues.push({
          id: `best-practices-extreme-bindings-${componentName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'medium',
          category: 'best-practices',
          title: `Bloated Template Binding Density (${totalBindingsCount} bindings)`,
          description: `Component ${componentName} has ${totalBindingsCount} active template expressions/bindings. On every change detection pass, Angular must evaluate and diff all ${totalBindingsCount} reference values, which degrades rendering performance.`,
          recommendation: `Refactor this template by breaking it into smaller nested child components, using ChangeDetectionStrategy.OnPush, or leveraging pure pipes to memoize heavy sub-calculations.`,
          metadata: {
            totalTemplateBindings: totalBindingsCount
          },
          elementSelector: this.buildSelector(element)
        });
      }

      // Flag 3: High bindings count + Default Change Detection Strategy
      const isDefaultCD = !cmpDef || cmpDef.changeDetection === 0;
      if (isDefaultCD && totalBindingsCount > 25) {
        issues.push({
          id: `best-practices-default-cd-heavy-${componentName}`,
          analyzer: this.type,
          component: componentName,
          severity: 'medium',
          category: 'best-practices',
          title: `Default Change Detection in heavy component (${totalBindingsCount} bindings)`,
          description: `Component ${componentName} uses the Default change detection strategy despite containing a substantial volume of template bindings (${totalBindingsCount}). This forces Angular to evaluate all bindings on every single change detection cycle regardless of input change.`,
          recommendation: `Adopt ChangeDetectionStrategy.OnPush for ${componentName} to skip parsing these ${totalBindingsCount} template bindings during unrelated parent rendering cascades.`,
          metadata: {
            totalTemplateBindings: totalBindingsCount,
            currentStrategy: 'Default',
            recommendedStrategy: 'OnPush'
          },
          elementSelector: this.buildSelector(element)
        });
      }
    } catch {
      // Silently catch exceptions to prevent breaking the orchestrator
    }

    return issues;
  }

  /**
   * Builds a CSS selector for an element for overlay targeting.
   */
  private buildSelector(element: Element): string {
    const tag = element.tagName.toLowerCase();

    if (element.id) {
      return `#${element.id}`;
    }

    for (const attr of Array.from(element.attributes)) {
      if (attr.name.startsWith('_nghost-')) {
        return `${tag}[${attr.name}]`;
      }
    }

    return tag;
  }
}

// Auto-register the analyzer
registerAnalyzer(new BestPracticesDetector());
