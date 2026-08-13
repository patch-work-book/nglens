import { Injectable } from '@angular/core';

export interface CodeRefactor {
  type: 'subscription' | 'timer' | 'event-listener';
  title: string;
  originalSnippet: string;
  refactoredSnippet: string;
  explanation: string;
}

@Injectable({
  providedIn: 'root'
})
export class CodeModService {
  /**
   * Generates a modern Angular refactor using DestroyRef and takeUntilDestroyed.
   */
  generateSubscriptionFix(componentName: string, subProperties: string[]): CodeRefactor {
    const properties = subProperties.join(', ');
    
    return {
      type: 'subscription',
      title: 'Modernize Subscription Cleanup',
      originalSnippet: `// Standard subscription\nthis.data$.subscribe(...);`,
      refactoredSnippet: `// Modern safe subscription (Angular 16+)\nimport { takeUntilDestroyed } from '@angular/core/rxjs-interop';\n\nconstructor() {\n  this.data$.pipe(\n    takeUntilDestroyed()\n  ).subscribe(...);\n}`,
      explanation: `Replaces manual subscription management with the modern takeUntilDestroyed() operator. This automatically unsubscribes when the component is destroyed using the current injection context.`
    };
  }

  /**
   * Generates a fix for unmanaged timers.
   */
  generateTimerFix(methodName: string): CodeRefactor {
    return {
      type: 'timer',
      title: 'Auto-managed Timer',
      originalSnippet: `this.${methodName}() {\n  setInterval(() => { ... }, 1000);\n}`,
      refactoredSnippet: `private destroyRef = inject(DestroyRef);\n\nthis.${methodName}() {\n  const interval = setInterval(() => { ... }, 1000);\n  this.destroyRef.onDestroy(() => clearInterval(interval));\n}`,
      explanation: `Registers a cleanup hook using DestroyRef.onDestroy to ensure the interval is cleared even if the component doesn't implement OnDestroy.`
    };
  }
}
