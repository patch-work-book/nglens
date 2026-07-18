/**
 * ngLens - Angular Performance Analyzer
 * Copyright (c) 2026 ngLens Contributors
 * Licensed under MIT
 *
 * https://github.com/gowtham-labs/nglens
 *
 * Template Expression Tracker
 *
 * Tracks expensive template expressions:
 * - Method calls in templates
 * - Property getters in templates
 * - Pipe executions
 * - Expensive computations
 *
 * Works by instrumenting component instances with proxy getters.
 */

import type { TemplateExpressionEvent } from '../types/render-events';

interface TrackedExpression {
  componentName: string;
  expressionType: 'method' | 'getter' | 'pipe';
  name: string;
  callCount: number;
  totalTime: number;
  avgTime: number;
  lastCallTime: number;
  slowestCall: number;
  targets: string[];
}

type InstrumentedFunction = ((this: any, ...args: any[]) => any) & {
  __ngLensInstrumented?: boolean;
};

export class TemplateExpressionTracker {
  private expressions = new Map<string, TrackedExpression>();
  private enabled = true;
  private threshold = 1; // Report expressions called >1 time per render
  private timeThreshold = 0.5; // Report if >0.5ms

  constructor(private orchestrator: any) {
    this.setupGlobalInterception();
  }

  /**
   * Instrument a component instance to track template expressions
   */
  instrumentComponent(component: any, componentName: string): void {
    if (!this.enabled || !component) return;

    try {
      // Create a proxy to intercept property access and method calls
      const originalProps = Object.getOwnPropertyNames(component);

      for (const propName of originalProps) {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(component, propName);
          const value = component[propName];

          // Track method calls (but NOT signals — signals are functions with .set/.update)
          if (typeof value === 'function' && !propName.startsWith('_')) {
            // Skip Angular signals — they are callable functions with .set/.update/.asReadonly
            if (typeof value.set === 'function' ||
                typeof value.update === 'function' ||
                typeof value.asReadonly === 'function') {
              continue;
            }
            this.instrumentMethod(component, componentName, propName);
          }
          // Track getters
          else if (descriptor?.get) {
            this.instrumentGetter(component, componentName, propName, descriptor);
          }
        } catch {
          // Skip properties that throw on access
        }
      }

      // Also check prototype chain for methods
      const proto = Object.getPrototypeOf(component);
      if (proto && proto !== Object.prototype) {
        const protoProps = Object.getOwnPropertyNames(proto);
        for (const propName of protoProps) {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(proto, propName);
            if (descriptor?.value && typeof descriptor.value === 'function' && !propName.startsWith('_')) {
              this.instrumentMethod(component, componentName, propName, true);
            }
          } catch {
            // Skip
          }
        }
      }
    } catch (error) {
      console.debug(`[TemplateExpressionTracker] Error instrumenting ${componentName}:`, error);
    }
  }

  /**
   * Instrument a method to track calls from templates
   */
  private instrumentMethod(
    component: any,
    componentName: string,
    methodName: string,
    isProto = false
  ): void {
    try {
      const original = isProto
        ? Object.getPrototypeOf(component)[methodName]
        : component[methodName];

      if (!original || original.__ngLensInstrumented) return;

      // Skip Angular signals - they are functions with .set/.update/.asReadonly
      // Wrapping them breaks signal reactivity (e.g., this.open.set is not a function)
      if (typeof original === 'function' && (
        typeof original.set === 'function' ||
        typeof original.update === 'function' ||
        typeof original.asReadonly === 'function'
      )) {
        return;
      }

      // Skip Angular lifecycle hooks and internal methods
      if (methodName === 'constructor' ||
          methodName.startsWith('ng') ||
          methodName.startsWith('ɵ')) {
        return;
      }

      const tracker = this;
      const trackedKey = `${componentName}#${methodName}`;

      const instrumented: InstrumentedFunction = function (this: any, ...args: any[]) {
        const start = performance.now();
        try {
          const result = original.apply(this, args);
          const duration = performance.now() - start;

          tracker.recordExpression(componentName, methodName, 'method', duration);

          // Dispatch event if expensive
          if (duration > tracker.timeThreshold) {
            tracker.dispatchEvent(componentName, methodName, 'method', duration, args);
          }

          return result;
        } catch (error) {
          tracker.recordExpression(componentName, methodName, 'method', 0);
          throw error;
        }
      };

      instrumented.__ngLensInstrumented = true;

      if (isProto) {
        Object.getPrototypeOf(component)[methodName] = instrumented;
      } else {
        component[methodName] = instrumented;
      }
    } catch (error) {
      console.debug(`[TemplateExpressionTracker] Error instrumenting method ${methodName}:`, error);
    }
  }

  /**
   * Instrument a property getter to track access from templates
   */
  private instrumentGetter(
    component: any,
    componentName: string,
    propName: string,
    descriptor: PropertyDescriptor
  ): void {
    try {
      const original = descriptor.get as InstrumentedFunction | undefined;
      if (!original || original.__ngLensInstrumented) return;

      const tracker = this;

      const instrumented: InstrumentedFunction = function (this: any) {
        const start = performance.now();
        try {
          const result = original.call(this);
          const duration = performance.now() - start;

          tracker.recordExpression(componentName, propName, 'getter', duration);

          if (duration > tracker.timeThreshold) {
            tracker.dispatchEvent(componentName, propName, 'getter', duration, []);
          }

          return result;
        } catch (error) {
          tracker.recordExpression(componentName, propName, 'getter', 0);
          throw error;
        }
      };

      instrumented.__ngLensInstrumented = true;

      Object.defineProperty(component, propName, {
        ...descriptor,
        get: instrumented,
      });
    } catch (error) {
      console.debug(
        `[TemplateExpressionTracker] Error instrumenting getter ${propName}:`,
        error
      );
    }
  }

  /**
   * Record expression execution
   */
  private recordExpression(
    componentName: string,
    name: string,
    type: 'method' | 'getter' | 'pipe',
    duration: number
  ): void {
    const key = `${componentName}#${name}`;
    const existing = this.expressions.get(key);

    if (existing) {
      existing.callCount++;
      existing.totalTime += duration;
      existing.avgTime = existing.totalTime / existing.callCount;
      existing.lastCallTime = Date.now();
      if (duration > existing.slowestCall) {
        existing.slowestCall = duration;
      }
    } else {
      this.expressions.set(key, {
        componentName,
        expressionType: type,
        name,
        callCount: 1,
        totalTime: duration,
        avgTime: duration,
        lastCallTime: Date.now(),
        slowestCall: duration,
        targets: [],
      });
    }
  }

  /**
   * Dispatch event for expensive expression
   */
  private dispatchEvent(
    componentName: string,
    name: string,
    type: string,
    duration: number,
    args: any[]
  ): void {
    const event = new CustomEvent('ngLens:templateExpression', {
      detail: {
        componentName,
        expressionName: name,
        expressionType: type,
        duration,
        timestamp: Date.now(),
        severity: this.calculateSeverity(duration),
        args: this.serializeArgs(args),
      } as TemplateExpressionEvent,
    });

    window.dispatchEvent(event);
  }

  /**
   * Calculate severity based on execution time
   */
  private calculateSeverity(duration: number): 'low' | 'medium' | 'high' | 'critical' {
    if (duration > 10) return 'critical';
    if (duration > 5) return 'high';
    if (duration > 2) return 'medium';
    return 'low';
  }

  /**
   * Safely serialize arguments for reporting
   */
  private serializeArgs(args: any[]): string[] {
    return args
      .slice(0, 3) // Only first 3 args
      .map(arg => {
        try {
          if (arg === null) return 'null';
          if (arg === undefined) return 'undefined';
          const type = typeof arg;
          if (type === 'object') return `${arg.constructor?.name || 'Object'}`;
          return `${type}(${String(arg).substring(0, 20)})`;
        } catch {
          return 'unknown';
        }
      });
  }

  /**
   * Get tracked expressions for a component
   */
  getComponentExpressions(componentName: string): TrackedExpression[] {
    return Array.from(this.expressions.values()).filter(
      expr => expr.componentName === componentName
    );
  }

  /**
   * Get expensive expressions (for recommendations)
   */
  getExpensiveExpressions(limit = 10): TrackedExpression[] {
    return Array.from(this.expressions.values())
      .filter(expr => expr.callCount > this.threshold || expr.avgTime > this.timeThreshold)
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, limit);
  }

  /**
   * Global interception for built-in functions (setTimeout, etc.)
   */
  private setupGlobalInterception(): void {
    // Track setTimeout/setInterval if called from templates (rare but possible)
    const originalSetTimeout = globalThis.setTimeout;
    const tracker = this;

    globalThis.setTimeout = function (this: typeof globalThis, callback: any, delay?: number, ...args: any[]) {
      if (tracker.enabled && (delay ?? 0) > 0) {
        // Note: Tracking global timeouts would be noisy; only log if in template context
      }
      return originalSetTimeout.call(this, callback, delay, ...args);
    } as typeof setTimeout;
  }

  /**
   * Get aggregated statistics
   */
  getStatistics(): {
    totalExpressions: number;
    mostExpensive: TrackedExpression | null;
    averageCallCount: number;
    averageTime: number;
  } {
    const exprs = Array.from(this.expressions.values());
    const totalTime = exprs.reduce((sum, e) => sum + e.totalTime, 0);
    const totalCalls = exprs.reduce((sum, e) => sum + e.callCount, 0);

    return {
      totalExpressions: exprs.length,
      mostExpensive: exprs.length > 0 ? exprs.sort((a, b) => b.avgTime - a.avgTime)[0] : null,
      averageCallCount: totalCalls > 0 ? totalCalls / exprs.length : 0,
      averageTime: exprs.length > 0 ? totalTime / exprs.length : 0,
    };
  }

  /**
   * Clear tracked data
   */
  clear(): void {
    this.expressions.clear();
  }

  /**
   * Enable/disable tracking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Set reporting threshold
   */
  setThresholds(callCountThreshold: number, timeThreshold: number): void {
    this.threshold = callCountThreshold;
    this.timeThreshold = timeThreshold;
  }
}
