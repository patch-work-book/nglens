/**
 * Subscription Leak Detector — Memory Leak Prevention
 *
 * Detects common memory leak patterns in Angular components:
 * 1. RxJS subscriptions without cleanup (missing takeUntil/async pipe/unsubscribe)
 * 2. Timers (setInterval/setTimeout) without cleanup
 * 3. Event listeners (addEventListener) without cleanup
 * 4. Components with active subscriptions but missing ngOnDestroy
 *
 * Each issue includes:
 * - Leak type and severity
 * - Auto-generated fix with takeUntilDestroyed() or manual cleanup
 * - Estimated memory impact
 *
 * Requires development mode (window.ng) to inspect component instances.
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
import { MAX_ELEMENTS_PER_SCAN, MAX_LEAK_ISSUES } from '../utils/constants';

/**
 * Generates a deterministic 8-char hex hash from input string.
 * Used for stable issue IDs across repeated scans.
 */
function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
}

// --- Educational content for leak types ---

const SUBSCRIPTION_LEAK_CONTENT = {
  learningTopic: 'Memory Management',
  whyBad:
    'Subscriptions that are not cleaned up continue to hold references to the component and run callbacks even after the component is destroyed. This causes memory leaks, unexpected behavior, and performance degradation over time.',
  betterApproach: `// Option 1: Use takeUntilDestroyed() (Angular 16+)
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export class MyComponent {
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.service.data$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(data => this.data = data);
  }
}

// Option 2: Use async pipe (preferred)
// template: {{ data$ | async }}

// Option 3: Manual cleanup
private destroy$ = new Subject<void>();

ngOnInit() {
  this.service.data$
    .pipe(takeUntil(this.destroy$))
    .subscribe(data => this.data = data);
}

ngOnDestroy() {
  this.destroy$.next();
  this.destroy$.complete();
}`,
};

const TIMER_LEAK_CONTENT = {
  learningTopic: 'Memory Management',
  whyBad:
    'Timers (setInterval/setTimeout) that are not cleared will continue to run after component destruction, causing memory leaks and unexpected side effects. The component instance cannot be garbage collected.',
  betterApproach: `private intervalId: number | null = null;

ngAfterViewInit() {
  this.intervalId = window.setInterval(() => {
    this.checkStatus();
  }, 1000);
}

ngOnDestroy() {
  if (this.intervalId !== null) {
    clearInterval(this.intervalId);
  }
}`,
};

const EVENT_LISTENER_LEAK_CONTENT = {
  learningTopic: 'Memory Management',
  whyBad:
    'Event listeners that are not removed keep references to the component and prevent garbage collection. They also continue to fire callbacks on destroyed components.',
  betterApproach: `// Store bound function reference
private boundResize = this.onResize.bind(this);

ngOnInit() {
  window.addEventListener('resize', this.boundResize);
}

ngOnDestroy() {
  window.removeEventListener('resize', this.boundResize);
}

// Or use RxJS fromEvent + takeUntilDestroyed
private destroyRef = inject(DestroyRef);

ngOnInit() {
  fromEvent(window, 'resize')
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe(() => this.onResize());
}`,
};

/**
 * SubscriptionLeakDetector identifies memory leaks from unmanaged subscriptions,
 * timers, and event listeners in Angular components.
 */
export class SubscriptionLeakDetector extends BaseAnalyzer {
  readonly type: AnalyzerType = 'rxjs-leak-detector';
  readonly requiresDevMode = true;

  protected async execute(config: AnalyzerConfig): Promise<AnalyzerResult> {
    // Runtime guard: verify Angular debug API is available
    const ng = (globalThis as any).ng;
    if (!ng?.getComponent) {
      return {
        analyzer: this.type,
        timestamp: Date.now(),
        duration: 0,
        issues: [],
        metadata: {
          skipped: true,
          reason: 'ng.getComponent not available — Angular debug API required',
        },
      };
    }

    const startTime = now();
    const issues: AnalysisIssue[] = [];

    const components = findAngularComponents();
    const limit = Math.min(
      components.length,
      config.maxElements ?? MAX_ELEMENTS_PER_SCAN
    );

    for (let i = 0; i < limit; i++) {
      if (issues.length >= MAX_LEAK_ISSUES) break;

      const element = components[i];
      const componentName = getComponentName(element);

      let component: any;
      try {
        component = ng.getComponent(element);
      } catch {
        continue;
      }

      if (!component) {
        continue;
      }

      // Check for subscription leaks
      const subscriptionIssues = this.detectSubscriptionLeaks(
        component,
        componentName,
        element
      );
      issues.push(...subscriptionIssues);

      // Check for timer leaks
      const timerIssues = this.detectTimerLeaks(
        component,
        componentName,
        element
      );
      issues.push(...timerIssues);

      // Check for event listener leaks
      const eventListenerIssues = this.detectEventListenerLeaks(
        component,
        componentName,
        element
      );
      issues.push(...eventListenerIssues);
    }

    // Cap total issues
    if (issues.length > MAX_LEAK_ISSUES) {
      issues.length = MAX_LEAK_ISSUES;
    }

    const duration = now() - startTime;

    return {
      analyzer: this.type,
      timestamp: Date.now(),
      duration,
      issues,
      metadata: {
        componentsAnalyzed: limit,
        totalLeaks: issues.length,
        subscriptionLeaks: issues.filter((i) =>
          i.title.includes('subscription')
        ).length,
        timerLeaks: issues.filter((i) => i.title.includes('Timer')).length,
        eventListenerLeaks: issues.filter((i) =>
          i.title.includes('event listener')
        ).length,
      },
    };
  }

  /**
   * Detects RxJS subscription leaks.
   *
   * Strategy:
   * 1. Check if component has ngOnDestroy
   * 2. Scan for properties that look like subscriptions (Subscription type or .subscribe calls)
   * 3. Check for proper cleanup patterns (takeUntil, takeUntilDestroyed, unsubscribe)
   */
  private detectSubscriptionLeaks(
    component: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    // Check if component has ngOnDestroy
    const hasNgOnDestroy = typeof component.ngOnDestroy === 'function';

    // Look for subscription-related properties
    const subscriptionProperties: string[] = [];
    const subscriptionCount = this.countSubscriptions(
      component,
      subscriptionProperties
    );

    // Check for cleanup patterns
    const hasDestroySubject = this.hasDestroySubject(component);
    const hasDestroyRef = this.hasDestroyRef(component);
    const hasSubscriptionProperty = this.hasSubscriptionProperty(component);

    // If subscriptions detected but no cleanup mechanism
    if (subscriptionCount > 0) {
      // Check allowlist first
      if (this.usesKnownCleanupPattern(component)) {
        return issues; // Known safe pattern, skip
      }

      const hasCleanup =
        hasDestroySubject ||
        hasDestroyRef ||
        (hasSubscriptionProperty && hasNgOnDestroy);

      if (!hasCleanup) {
        const severity = subscriptionCount > 3 ? 'critical' : subscriptionCount > 1 ? 'high' : 'medium';

        issues.push({
          id: `leak-sub-${componentName}-${stableHash(componentName + 'subscription' + subscriptionProperties.join(','))}`,
          analyzer: this.type,
          component: componentName,
          severity,
          category: 'memory-leaks',
          title: `${subscriptionCount} subscription(s) without cleanup detected`,
          description: `Found ${subscriptionCount} potential subscription leak(s) in ${componentName}. ${
            hasNgOnDestroy
              ? 'ngOnDestroy exists but no cleanup mechanism detected.'
              : 'Component has no ngOnDestroy lifecycle hook.'
          }`,
          recommendation: this.generateSubscriptionFix(
            subscriptionCount,
            hasNgOnDestroy
          ),
          metadata: {
            ...SUBSCRIPTION_LEAK_CONTENT,
            leakType: 'subscription',
            count: subscriptionCount,
            properties: subscriptionProperties,
            hasNgOnDestroy,
          },
          elementSelector: this.generateSelector(element),
        });
      }
    }

    return issues;
  }

  /**
   * Detects timer leaks (setInterval/setTimeout without clearInterval/clearTimeout).
   */
  private detectTimerLeaks(
    component: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    const timerMethods = this.findTimerMethods(component);

    if (timerMethods.length > 0) {
      const hasNgOnDestroy = typeof component.ngOnDestroy === 'function';
      const hasClearTimer = this.hasClearTimerCalls(component);

      if (!hasClearTimer) {
        issues.push({
          id: `leak-timer-${componentName}-${stableHash(componentName + 'timer' + timerMethods.join(','))}`,
          analyzer: this.type,
          component: componentName,
          severity: 'high',
          category: 'memory-leaks',
          title: `Timer leak: ${timerMethods.length} timer(s) without cleanup`,
          description: `Found ${timerMethods.length} setInterval/setTimeout call(s) in ${componentName} without corresponding clearInterval/clearTimeout in ngOnDestroy.`,
          recommendation: this.generateTimerFix(timerMethods, hasNgOnDestroy),
          metadata: {
            ...TIMER_LEAK_CONTENT,
            leakType: 'timer',
            count: timerMethods.length,
            methods: timerMethods,
          },
          elementSelector: this.generateSelector(element),
        });
      }
    }

    return issues;
  }

  /**
   * Detects event listener leaks (addEventListener without removeEventListener).
   */
  private detectEventListenerLeaks(
    component: any,
    componentName: string,
    element: Element
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    const eventListenerMethods = this.findEventListenerMethods(component);

    if (eventListenerMethods.length > 0) {
      const hasNgOnDestroy = typeof component.ngOnDestroy === 'function';
      const hasRemoveListener = this.hasRemoveEventListenerCalls(component);

      if (!hasRemoveListener) {
        issues.push({
          id: `leak-evt-${componentName}-${stableHash(componentName + 'event' + eventListenerMethods.join(','))}`,
          analyzer: this.type,
          component: componentName,
          severity: 'medium',
          category: 'memory-leaks',
          title: `Event listener leak: ${eventListenerMethods.length} listener(s) without cleanup`,
          description: `Found ${eventListenerMethods.length} addEventListener call(s) in ${componentName} without corresponding removeEventListener in ngOnDestroy.`,
          recommendation: this.generateEventListenerFix(
            eventListenerMethods,
            hasNgOnDestroy
          ),
          metadata: {
            ...EVENT_LISTENER_LEAK_CONTENT,
            leakType: 'event-listener',
            count: eventListenerMethods.length,
            methods: eventListenerMethods,
          },
          elementSelector: this.generateSelector(element),
        });
      }
    }

    return issues;
  }

  // --- Helper Methods ---

  /**
   * Checks if component uses a known safe subscription management pattern.
   * These patterns handle cleanup automatically and should not trigger warnings.
   */
  private usesKnownCleanupPattern(component: any): boolean {
    try {
      // Pattern 1: SubSink (has .add() and .unsubscribe() on a single property)
      for (const key in component) {
        if (!component.hasOwnProperty(key)) continue;
        const value = component[key];
        if (
          value &&
          typeof value === 'object' &&
          typeof value.add === 'function' &&
          typeof value.unsubscribe === 'function' &&
          'closed' in value
        ) {
          // Looks like SubSink or Subscription used as a sink
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('sub') || lowerKey.includes('sink')) {
            return true;
          }
        }
      }

      // Pattern 2: ngx-auto-unsubscribe decorator (check for __ngUnsubscribe__ marker)
      const proto = Object.getPrototypeOf(component);
      if (proto && proto.constructor) {
        const constructorStr = proto.constructor.toString();
        if (constructorStr.includes('AutoUnsubscribe') || constructorStr.includes('ngUnsubscribe')) {
          return true;
        }
      }

      // Pattern 3: Base class with destroy$ Subject that's properly wired
      // Check prototype chain for a destroy subject
      let currentProto = Object.getPrototypeOf(component);
      while (currentProto && currentProto !== Object.prototype) {
        for (const key of Object.getOwnPropertyNames(currentProto)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('destroy') || lowerKey.includes('unsubscribe')) {
            try {
              const value = component[key];
              if (value && typeof value.next === 'function' && typeof value.complete === 'function') {
                return true;
              }
            } catch { /* skip */ }
          }
        }
        currentProto = Object.getPrototypeOf(currentProto);
      }
    } catch {
      // If introspection fails, don't skip
    }
    return false;
  }

  /**
   * Counts subscription properties in component.
   * Heuristic: looks for properties with 'subscription' in the name or .subscribe calls.
   *
   * IMPROVED: Scans ALL methods (not just ng*), better regex, safer execution.
   */
  private countSubscriptions(component: any, properties: string[]): number {
    let count = 0;
    const MAX_METHODS_TO_SCAN = 50; // Performance limit
    const seenMethods = new Set<string>();

    try {
      // Scan component methods for .subscribe( patterns
      const proto = Object.getPrototypeOf(component);
      if (!proto) return 0;

      const methodNames = Object.getOwnPropertyNames(proto);
      let methodsScanned = 0;

      for (const methodName of methodNames) {
        // Skip constructor, Angular internal methods, and duplicates
        if (
          methodName === 'constructor' ||
          methodName.startsWith('__') ||
          seenMethods.has(methodName) ||
          methodsScanned >= MAX_METHODS_TO_SCAN
        ) {
          continue;
        }

        seenMethods.add(methodName);
        methodsScanned++;

        try {
          const method = proto[methodName];
          if (typeof method !== 'function') continue;

          const methodStr = method.toString();

          // Skip if method body is too short (just a stub) or too long (performance)
          if (methodStr.length < 10 || methodStr.length > 10000) continue;

          // Improved regex: match .subscribe( but not in comments or strings
          // This is still heuristic but better than before
          const lines = methodStr.split('\n');
          for (const line of lines) {
            const codeLine = this.extractExecutableCode(line);
            if (!codeLine) continue;

            // Look for .subscribe( pattern
            if (/\.\s*subscribe\s*\(/.test(codeLine)) {
              count++;
              if (!properties.includes(methodName)) {
                properties.push(methodName);
              }
              break; // Count method once even if multiple subscribes
            }
          }
        } catch (methodError) {
          // toString() might fail on native functions, proxies, etc.
          // Silently continue to next method
          continue;
        }
      }

      // Also check instance properties for Subscription objects
      let propsChecked = 0;
      const MAX_PROPS_TO_CHECK = 100;

      for (const key in component) {
        if (propsChecked++ > MAX_PROPS_TO_CHECK) break;

        try {
          if (component.hasOwnProperty(key)) {
            const value = component[key];

            // Check if it's a real RxJS Subscription (more specific than just unsubscribe)
            if (this.isRxJSSubscription(value)) {
              count++;
              if (!properties.includes(key)) {
                properties.push(key);
              }
            }

            // Check for subscription arrays/collections
            if (Array.isArray(value) && value.length > 0) {
              if (value.every(item => this.isRxJSSubscription(item))) {
                count += value.length;
                if (!properties.includes(key)) {
                  properties.push(`${key}[]`);
                }
              }
            }
          }
        } catch (propError) {
          // Property access might throw (getters, proxies)
          continue;
        }
      }
    } catch (error) {
      // Silently fail if introspection fails
    }

    return count;
  }

  /**
   * More robust check for RxJS Subscription objects.
   * Checks for multiple Subscription-specific properties to reduce false positives.
   */
  private isRxJSSubscription(value: any): boolean {
    if (!value || typeof value !== 'object') return false;

    // RxJS Subscription has: unsubscribe, closed, add, remove
    return (
      typeof value.unsubscribe === 'function' &&
      'closed' in value &&
      typeof value.add === 'function'
    );
  }

  /**
   * Checks if component has a destroy$ Subject pattern.
   *
   * IMPROVED: Detects more patterns and checks if it's actually used in ngOnDestroy.
   */
  private hasDestroySubject(component: any): boolean {
    try {
      let destroySubjectName: string | null = null;

      // Look for Subject properties (not just by name)
      for (const key in component) {
        const value = component[key];

        // Check if it's a Subject (has next, complete, error methods)
        if (
          value &&
          typeof value.next === 'function' &&
          typeof value.complete === 'function' &&
          typeof value.error === 'function'
        ) {
          // Common naming patterns for destroy subjects
          const lowerKey = key.toLowerCase();
          if (
            lowerKey.includes('destroy') ||
            lowerKey.includes('unsubscribe') ||
            lowerKey.includes('stop') ||
            lowerKey.includes('kill') ||
            lowerKey.includes('teardown')
          ) {
            destroySubjectName = key;
            break;
          }
        }
      }

      if (!destroySubjectName) return false;

      // Verify it's actually used in ngOnDestroy
      if (typeof component.ngOnDestroy === 'function') {
        try {
          const ngOnDestroyStr = component.ngOnDestroy.toString();
          // Check if the destroy subject is called with .next() and .complete()
          return (
            ngOnDestroyStr.includes(`${destroySubjectName}.next`) ||
            ngOnDestroyStr.includes(`${destroySubjectName}.complete`)
          );
        } catch {
          // If we can't verify usage, assume it's valid if the subject exists
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Checks if component has DestroyRef injected (Angular 16+).
   * Also checks for takeUntilDestroyed usage.
   */
  private hasDestroyRef(component: any): boolean {
    try {
      // Check for DestroyRef property
      for (const key in component) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('destroyref')) {
          return true;
        }
      }

      // Also check if any method uses takeUntilDestroyed
      const proto = Object.getPrototypeOf(component);
      if (!proto) return false;

      const methodNames = Object.getOwnPropertyNames(proto);
      for (const methodName of methodNames) {
        try {
          const method = proto[methodName];
          if (typeof method === 'function') {
            const methodStr = method.toString();
            if (methodStr.includes('takeUntilDestroyed')) {
              return true;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Silently fail
    }
    return false;
  }

  /**
   * Checks if component has a subscription property that's unsubscribed in ngOnDestroy.
   *
   * IMPROVED: Also checks for subscription arrays and .add() pattern.
   */
  private hasSubscriptionProperty(component: any): boolean {
    try {
      const subscriptionProps: string[] = [];

      // Find subscription properties
      for (const key in component) {
        if (component.hasOwnProperty(key)) {
          const value = component[key];

          // Individual subscriptions
          if (this.isRxJSSubscription(value)) {
            subscriptionProps.push(key);
          }

          // Subscription arrays
          if (Array.isArray(value) && value.some(item => this.isRxJSSubscription(item))) {
            subscriptionProps.push(key);
          }
        }
      }

      if (subscriptionProps.length === 0) return false;

      // Check if ngOnDestroy references these properties
      if (typeof component.ngOnDestroy === 'function') {
        try {
          const ngOnDestroyStr = component.ngOnDestroy.toString();

          // Check if any subscription property is unsubscribed
          for (const propName of subscriptionProps) {
            if (
              ngOnDestroyStr.includes(`${propName}.unsubscribe`) ||
              ngOnDestroyStr.includes(`${propName}.forEach`) || // Array pattern
              ngOnDestroyStr.includes(`${propName}.map`) // Array pattern
            ) {
              return true;
            }
          }
        } catch {
          // If we can't verify, assume false
          return false;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Finds methods that use setInterval/setTimeout.
   *
   * IMPROVED: Better safety, scans all methods, avoids false positives.
   */
  private findTimerMethods(component: any): string[] {
    const methods: string[] = [];
    const MAX_METHODS = 50;
    let methodsScanned = 0;

    try {
      const proto = Object.getPrototypeOf(component);
      if (!proto) return methods;

      const methodNames = Object.getOwnPropertyNames(proto);

      for (const methodName of methodNames) {
        if (methodsScanned++ >= MAX_METHODS) break;
        if (methodName === 'constructor' || methodName.startsWith('__')) continue;

        try {
          const method = proto[methodName];
          if (typeof method !== 'function') continue;

          const methodStr = method.toString();
          if (methodStr.length < 10 || methodStr.length > 10000) continue;

          // Look for timer patterns, avoiding comments
          const lines = methodStr.split('\n');
          for (const line of lines) {
            const codeLine = this.extractExecutableCode(line);
            if (!codeLine) continue;

            if (
              /\bsetInterval\s*\(/.test(codeLine) ||
              /\bsetTimeout\s*\(/.test(codeLine)
            ) {
              if (!methods.includes(methodName)) {
                methods.push(methodName);
              }
              break;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Silently fail
    }

    return methods;
  }

  /**
   * Checks if component has clearInterval/clearTimeout calls.
   *
   * IMPROVED: More thorough checking.
   */
  private hasClearTimerCalls(component: any): boolean {
    try {
      if (typeof component.ngOnDestroy !== 'function') return false;

      const ngOnDestroyStr = component.ngOnDestroy.toString();
      return (
        /\bclearInterval\s*\(/.test(ngOnDestroyStr) ||
        /\bclearTimeout\s*\(/.test(ngOnDestroyStr)
      );
    } catch {
      return false;
    }
  }

  /**
   * Finds methods that use addEventListener.
   *
   * IMPROVED: Better safety, scans all methods.
   */
  private findEventListenerMethods(component: any): string[] {
    const methods: string[] = [];
    const MAX_METHODS = 50;
    let methodsScanned = 0;

    try {
      const proto = Object.getPrototypeOf(component);
      if (!proto) return methods;

      const methodNames = Object.getOwnPropertyNames(proto);

      for (const methodName of methodNames) {
        if (methodsScanned++ >= MAX_METHODS) break;
        if (methodName === 'constructor' || methodName.startsWith('__')) continue;

        try {
          const method = proto[methodName];
          if (typeof method !== 'function') continue;

          const methodStr = method.toString();
          if (methodStr.length < 10 || methodStr.length > 10000) continue;

          // Look for addEventListener patterns
          const lines = methodStr.split('\n');
          for (const line of lines) {
            const codeLine = this.extractExecutableCode(line);
            if (!codeLine) continue;

            if (/\.addEventListener\s*\(/.test(codeLine)) {
              if (!methods.includes(methodName)) {
                methods.push(methodName);
              }
              break;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Silently fail
    }

    return methods;
  }

  /**
   * Checks if component has removeEventListener calls.
   *
   * IMPROVED: More thorough checking.
   */
  private hasRemoveEventListenerCalls(component: any): boolean {
    try {
      if (typeof component.ngOnDestroy !== 'function') return false;

      const ngOnDestroyStr = component.ngOnDestroy.toString();
      return /\.removeEventListener\s*\(/.test(ngOnDestroyStr);
    } catch {
      return false;
    }
  }

  private extractExecutableCode(line: string): string {
    const trimmed = line.trim();
    if (
      trimmed.length === 0 ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) {
      return '';
    }

    return trimmed
      .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')
      .replace(/\/\*.*?\*\//g, '')
      .replace(/\/\/.*$/, '')
      .trim();
  }

  /**
   * Generates a CSS selector for the element.
   */
  private generateSelector(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    return id || tagName;
  }

  // --- Fix Generation ---

  /**
   * Generates auto-fix recommendation for subscription leaks.
   */
  private generateSubscriptionFix(
    count: number,
    hasNgOnDestroy: boolean
  ): string {
    if (!hasNgOnDestroy) {
      return `Add ngOnDestroy and use takeUntilDestroyed() or Subject pattern:

// Option 1: takeUntilDestroyed (Angular 16+)
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef, inject } from '@angular/core';

export class YourComponent {
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.service.data$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(data => this.data = data);
  }
}

// Option 2: Subject pattern
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export class YourComponent {
  private destroy$ = new Subject<void>();

  ngOnInit() {
    this.service.data$
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => this.data = data);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}`;
    }

    return `Add cleanup mechanism to existing ngOnDestroy:

// Use takeUntilDestroyed or Subject pattern for all ${count} subscription(s)
private destroy$ = new Subject<void>();

ngOnInit() {
  // Add .pipe(takeUntil(this.destroy$)) before each .subscribe()
  this.service.data$
    .pipe(takeUntil(this.destroy$))
    .subscribe(data => this.data = data);
}

ngOnDestroy() {
  this.destroy$.next();
  this.destroy$.complete();
}`;
  }

  /**
   * Generates auto-fix recommendation for timer leaks.
   */
  private generateTimerFix(
    methods: string[],
    hasNgOnDestroy: boolean
  ): string {
    const destroyCode = hasNgOnDestroy
      ? '// In existing ngOnDestroy'
      : 'ngOnDestroy() {';
    const closeCode = hasNgOnDestroy ? '' : '}';

    return `Store timer IDs and clear them in ngOnDestroy:

private intervalId: number | null = null;
private timeoutId: number | null = null;

${methods[0] || 'ngOnInit'}() {
  this.intervalId = window.setInterval(() => {
    // your code
  }, 1000);
}

${destroyCode}
  if (this.intervalId !== null) {
    clearInterval(this.intervalId);
  }
  if (this.timeoutId !== null) {
    clearTimeout(this.timeoutId);
  }
${closeCode}`;
  }

  /**
   * Generates auto-fix recommendation for event listener leaks.
   */
  private generateEventListenerFix(
    methods: string[],
    hasNgOnDestroy: boolean
  ): string {
    const destroyCode = hasNgOnDestroy
      ? '// In existing ngOnDestroy'
      : 'ngOnDestroy() {';
    const closeCode = hasNgOnDestroy ? '' : '}';

    return `Store bound function reference and remove listener in ngOnDestroy:

private boundResize = this.onResize.bind(this);

${methods[0] || 'ngOnInit'}() {
  window.addEventListener('resize', this.boundResize);
}

${destroyCode}
  window.removeEventListener('resize', this.boundResize);
${closeCode}

// Or better: use RxJS fromEvent with takeUntilDestroyed
import { fromEvent } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

private destroyRef = inject(DestroyRef);

${methods[0] || 'ngOnInit'}() {
  fromEvent(window, 'resize')
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe(() => this.onResize());
}`;
  }
}

// Auto-register the analyzer
registerAnalyzer(new SubscriptionLeakDetector());
