/**
 * Causality Chain Detector Service
 * 
 * THE CORE IP OF ngLens
 * 
 * Detects meaningful causality chains from execution steps.
 * 
 * Algorithm:
 * 1. Start with data-fetch step (API call)
 * 2. Follow impact chain: data-fetch → state-update → computation → ui-update
 * 3. Group steps that form complete causal flow into one chapter
 * 4. End when no more downstream impact or timing gap detected
 * 
 * Example:
 * Input:  [GET /revenue, updateRevenue, revenueSignal, RevenueChart, OrdersAPI, ...]
 * Output: [
 *   Chain 1: [GET /revenue → updateRevenue → revenueSignal → RevenueChart] (340ms)
 *   Chain 2: [OrdersAPI → updateOrders → OrdersTable] (420ms)
 *   ...
 * ]
 * 
 * This transforms low-level events into business operations.
 */

import { Injectable } from '@angular/core';
import type { ExecutionStep, ExecutionStory } from '../../../../types/execution-intelligence';

/**
 * One complete causality chain (represents one business operation).
 */
export interface CausalityChain {
  id: string;
  stepIds: string[];
  steps?: ExecutionStep[];
  
  // Timeline
  startTime: number;
  endTime: number;
  duration: number;
  
  // Structure
  trigger: ExecutionStep;        // data-fetch that started this chain
  stateUpdates: ExecutionStep[]; // state-update steps
  computations: ExecutionStep[]; // computation/signal steps
  renders: ExecutionStep[];      // ui-update steps
  
  // Quality metrics
  completeness: number;          // 0-1: how "complete" is this chain (has API? Store? Signal? Renders?)
  confidence: number;            // 0-1: how confident are we this is a real business operation
  
  // Metadata
  isSynchronous: boolean;        // All steps happened within 50ms
  isParallel: boolean;           // Some steps overlap in time
}

@Injectable({
  providedIn: 'root',
})
export class CausalityChainDetectorService {
  /**
   * Detect all causality chains in an execution story.
   */
  detectChains(story: ExecutionStory): CausalityChain[] {
    if (story.steps.length === 0) return [];

    const chains: CausalityChain[] = [];
    const processedStepIds = new Set<string>();

    // Start with data-fetch steps (triggers)
    const triggers = story.steps.filter(s => s.type === 'data-fetch');

    triggers.forEach((trigger, idx) => {
      if (processedStepIds.has(trigger.id)) return; // Already part of another chain

      // Build chain from this trigger
      const chain = this.buildChainFromTrigger(trigger, story.steps, processedStepIds);

      if (chain) {
        chain.id = `chain-${idx}`;
        chains.push(chain);

        // Mark all steps in chain as processed
        chain.stepIds.forEach(id => processedStepIds.add(id));
      }
    });

    // Handle any remaining steps that aren't data-fetches
    // (e.g., user interactions, state updates without API triggers)
    story.steps.forEach(step => {
      if (!processedStepIds.has(step.id) && step.type !== 'data-fetch') {
        const orphanChain = this.buildOrphanChain(step, story.steps, processedStepIds);
        if (orphanChain) {
          orphanChain.id = `chain-orphan-${chains.length}`;
          chains.push(orphanChain);
          orphanChain.stepIds.forEach(id => processedStepIds.add(id));
        }
      }
    });

    // Sort by start time
    chains.sort((a, b) => a.startTime - b.startTime);

    return chains;
  }

  /**
   * Build a complete causality chain starting from a trigger (data-fetch).
   * 
   * Chain pattern: data-fetch → state-update → computation → ui-update
   */
  private buildChainFromTrigger(
    trigger: ExecutionStep,
    allSteps: ExecutionStep[],
    processedIds: Set<string>
  ): CausalityChain | null {
    const chainSteps: ExecutionStep[] = [trigger];
    const stateUpdates: ExecutionStep[] = [];
    const computations: ExecutionStep[] = [];
    const renders: ExecutionStep[] = [];

    let currentTime = trigger.endTime;
    const timeWindow = 100; // ms - steps within this window are considered part of same chain

    // Phase 1: Find state-update steps (typically follow data-fetch)
    const stateUpdateCandidates = allSteps.filter(
      s =>
        !processedIds.has(s.id) &&
        s.type === 'state-update' &&
        s.id !== trigger.id &&
        this.isDownstreamOfChain(s, chainSteps, timeWindow)
    );

    stateUpdateCandidates.forEach(step => {
      // Check if this step is directly impacted by the trigger
      if (this.isDirectlyImpactedBy(step, trigger)) {
        stateUpdates.push(step);
        chainSteps.push(step);
        currentTime = Math.max(currentTime, step.endTime);
      }
    });

    // Phase 2: Find computation steps (signals, derived state)
    const computationCandidates = allSteps.filter(
      s =>
        !processedIds.has(s.id) &&
        (s.type === 'computation' || s.type === 'background-task') &&
        s.id !== trigger.id &&
        this.isDownstreamOfChain(s, chainSteps, timeWindow)
    );

    computationCandidates.forEach(step => {
      // Check if impacted by state updates or trigger
      if (
        this.isDirectlyImpactedBy(step, trigger) ||
        stateUpdates.some(su => this.isDirectlyImpactedBy(step, su))
      ) {
        computations.push(step);
        chainSteps.push(step);
        currentTime = Math.max(currentTime, step.endTime);
      }
    });

    // Phase 3: Find render steps (UI updates as a result of everything above)
    const renderCandidates = allSteps.filter(
      s =>
        !processedIds.has(s.id) &&
        s.type === 'ui-update' &&
        s.id !== trigger.id &&
        this.isDownstreamOfChain(s, chainSteps, timeWindow)
    );

    renderCandidates.forEach(step => {
      // Renders are typically impacted by signals or state updates
      if (
        computations.some(c => this.isDirectlyImpactedBy(step, c)) ||
        stateUpdates.some(su => this.isDirectlyImpactedBy(step, su))
      ) {
        renders.push(step);
        chainSteps.push(step);
        currentTime = Math.max(currentTime, step.endTime);
      }
    });

    // Only create chain if it has meaningful structure
    if (chainSteps.length < 2) return null;

    const chain: CausalityChain = {
      id: '',
      stepIds: chainSteps.map(s => s.id),
      steps: chainSteps,
      startTime: trigger.startTime,
      endTime: currentTime,
      duration: currentTime - trigger.startTime,
      trigger,
      stateUpdates,
      computations,
      renders,
      completeness: this.calculateCompleteness(trigger, stateUpdates, computations, renders),
      confidence: this.calculateConfidence(trigger, chainSteps),
      isSynchronous: currentTime - trigger.startTime < 50,
      isParallel: this.hasParallelExecution(chainSteps),
    };

    return chain;
  }

  /**
   * Build a chain from orphan steps (not triggered by data-fetch).
   * Example: User interaction → state update → render
   */
  private buildOrphanChain(
    orphan: ExecutionStep,
    allSteps: ExecutionStep[],
    processedIds: Set<string>
  ): CausalityChain | null {
    const chainSteps: ExecutionStep[] = [orphan];
    let currentTime = orphan.endTime;
    const timeWindow = 100;

    // Find downstream steps
    allSteps.forEach(step => {
      if (
        !processedIds.has(step.id) &&
        step.id !== orphan.id &&
        this.isDownstreamOfChain(step, chainSteps, timeWindow) &&
        this.isDirectlyImpactedBy(step, orphan)
      ) {
        chainSteps.push(step);
        currentTime = Math.max(currentTime, step.endTime);
      }
    });

    if (chainSteps.length < 2) return null;

    const chain: CausalityChain = {
      id: '',
      stepIds: chainSteps.map(s => s.id),
      steps: chainSteps,
      startTime: orphan.startTime,
      endTime: currentTime,
      duration: currentTime - orphan.startTime,
      trigger: orphan,
      stateUpdates: chainSteps.filter(s => s.type === 'state-update'),
      computations: chainSteps.filter(s => s.type === 'computation'),
      renders: chainSteps.filter(s => s.type === 'ui-update'),
      completeness: this.calculateCompleteness(orphan, [], [], []),
      confidence: 0.7, // Lower confidence for orphans
      isSynchronous: currentTime - orphan.startTime < 50,
      isParallel: this.hasParallelExecution(chainSteps),
    };

    return chain;
  }

  /**
   * Check if step is directly impacted by parent.
   * Uses impact metrics and timing to determine causality.
   */
  private isDirectlyImpactedBy(step: ExecutionStep, parent: ExecutionStep): boolean {
    // Time check: step should start shortly after parent ends
    const timeDelta = step.startTime - parent.endTime;
    if (timeDelta < -10 || timeDelta > 200) return false; // Too far apart

    // Impact check: parent should have this step in downstream consumers
    if (parent.impact.directConsumers.length > 0) {
      // Check if step's component is in parent's direct consumers
      if (step.type === 'ui-update') {
        // For renders, check component names
        return parent.impact.components.names.some(comp =>
          step.title.toLowerCase().includes(comp.toLowerCase())
        );
      }

      // For state/computation, check service/store names
      return parent.impact.directConsumers.some(consumer =>
        step.title.toLowerCase().includes(consumer.toLowerCase())
      );
    }

    // Default: if timing is close, assume causality
    return timeDelta >= -10 && timeDelta <= 50;
  }

  /**
   * Check if step is downstream (time-wise) and still within chain window.
   */
  private isDownstreamOfChain(
    step: ExecutionStep,
    chain: ExecutionStep[],
    timeWindow: number
  ): boolean {
    const lastChainEnd = Math.max(...chain.map(s => s.endTime));
    const timeSinceLastStep = step.startTime - lastChainEnd;

    // Step should start within time window after last chain step
    return timeSinceLastStep >= -10 && timeSinceLastStep <= timeWindow;
  }

  /**
   * Calculate completeness score (0-1).
   * More complete chains have: API + Store + Signals + Renders
   */
  private calculateCompleteness(
    trigger: ExecutionStep,
    stateUpdates: ExecutionStep[],
    computations: ExecutionStep[],
    renders: ExecutionStep[]
  ): number {
    let score = 0;

    // Trigger (data-fetch): 0.25 points
    if (trigger.type === 'data-fetch') score += 0.25;

    // State updates: 0.25 points
    if (stateUpdates.length > 0) score += 0.25;

    // Computations: 0.25 points
    if (computations.length > 0) score += 0.25;

    // Renders: 0.25 points
    if (renders.length > 0) score += 0.25;

    return Math.min(score, 1);
  }

  /**
   * Calculate confidence score (0-1).
   * More confidence if chain is "clean" and follows expected patterns.
   */
  private calculateConfidence(trigger: ExecutionStep, chain: ExecutionStep[]): number {
    let score = 0.5; // Base confidence

    // Perfect timing (no gaps): +0.2
    let hasTimingGaps = false;
    for (let i = 0; i < chain.length - 1; i++) {
      const gap = chain[i + 1].startTime - chain[i].endTime;
      if (gap > 50) {
        hasTimingGaps = true;
        break;
      }
    }
    if (!hasTimingGaps) score += 0.2;

    // All steps successful: +0.15
    const allSuccessful = chain.every(s => s.performanceMetrics?.renderCost === undefined);
    if (allSuccessful) score += 0.15;

    // Chain length: longer chains more likely to be intentional
    if (chain.length >= 4) score += 0.15;

    return Math.min(score, 1);
  }

  /**
   * Check if chain has parallel execution (steps overlap in time).
   */
  private hasParallelExecution(chain: ExecutionStep[]): boolean {
    for (let i = 0; i < chain.length - 1; i++) {
      for (let j = i + 1; j < chain.length; j++) {
        // Check if steps overlap
        if (chain[i].endTime > chain[j].startTime && chain[i].startTime < chain[j].startTime) {
          return true;
        }
      }
    }
    return false;
  }
}
