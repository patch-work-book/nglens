import { Injectable, signal, computed } from '@angular/core';
import type { RecommendationAction } from '../utils/recommendation-actions';

/**
 * RecommendationEngineService - Phase 2.5 Feature (Stub)
 * 
 * This is a stub implementation for v2.0 that provides the interface
 * components expect while deferring the actual recommendation engine
 * to v2.5. 
 * 
 * Methods return empty recommendations in v2.0 but allow components
 * to compile and function without errors.
 */

@Injectable({ providedIn: 'root' })
export class RecommendationEngineService {
  private readonly inputSignal = signal<Record<string, any> | null>(null);
  private readonly recommendationsSignal = signal<RecommendationAction[]>([]);

  readonly recommendations = computed(() => this.recommendationsSignal());
  readonly highConfidenceCount = computed(() =>
    this.recommendationsSignal().filter(r => r.confidence === 'High').length
  );
  readonly quickWinCount = computed(() => this.recommendationsSignal().length);

  constructor() {
    // Empty constructor for DI
  }

  setInput(input: Record<string, any>): void {
    this.inputSignal.set(input);
    // v2.0: Return empty recommendations (stub)
    // v2.5: Will implement actual recommendation engine
    this.recommendationsSignal.set([]);
  }

  topQuickWins(limit: number): RecommendationAction[] {
    return this.recommendationsSignal().slice(0, limit);
  }

  clear(): void {
    this.inputSignal.set(null);
    this.recommendationsSignal.set([]);
  }
}
