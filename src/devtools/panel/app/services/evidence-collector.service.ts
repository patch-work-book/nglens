/**
 * EvidenceCollectorService
 *
 * Collects evidence items that explain why a component rendered and why we're
 * confident in that explanation. Evidence is the foundation of confidence scoring.
 */

import { Injectable } from '@angular/core';
import type {
  Evidence,
  EvidenceType,
  Confidence,
  ConfidenceConfig,
  EvidenceReport,
  EvidenceTimeline,
} from '../../../../types/evidence';
import type { RenderEvent, RenderCause } from '../../../../types/render-events';
import type { ExecutionStep } from '../../../../types/execution-intelligence';

@Injectable({ providedIn: 'root' })
export class EvidenceCollectorService {
  private readonly config: ConfidenceConfig;

  constructor() {
    // Use default config; could be injected for customization
    this.config = this.getDefaultConfig();
  }

  /**
   * Collect all evidence for a render event.
   */
  collectEvidenceForRender(
    render: RenderEvent,
    relatedEvents: ExecutionStep[],
    allRenders: RenderEvent[]
  ): EvidenceReport {
    const evidence: Evidence[] = [];
    let eventId = 0;

    // Evidence #1: Direct observation (always present)
    evidence.push({
      id: `evidence-${eventId++}`,
      type: 'direct-render-observation',
      description: `${render.componentName} was directly observed rendering at ${render.timestamp}ms`,
      strength: 'direct',
      source: 'RenderTracker',
      timestamp: render.timestamp,
      componentName: render.componentName,
      weight: 1.0,
    });

    // Evidence #2: Render causes
    for (const cause of render.causes || []) {
      evidence.push(this.createCauseEvidence(cause, render, eventId++));
    }

    // Evidence #3: Interaction timing
    if (render.interactionComponent && render.interactionTarget) {
      evidence.push({
        id: `evidence-${eventId++}`,
        type: 'user-interaction-trigger',
        description: `User interaction on ${render.interactionTarget} in ${render.interactionComponent}`,
        strength: 'strong',
        source: 'RenderTracker',
        timestamp: render.timestamp,
        componentName: render.componentName,
        weight: 0.9,
        metadata: { target: render.interactionTarget, component: render.interactionComponent },
      });
    }

    // Evidence #4: Parent relationship
    if (render.parentComponent) {
      evidence.push({
        id: `evidence-${eventId++}`,
        type: 'parent-render-causality',
        description: `Parent component ${render.parentComponent} rendered first, then this component`,
        strength: 'strong',
        source: 'RenderTracker',
        timestamp: render.timestamp,
        componentName: render.componentName,
        weight: 0.85,
        metadata: { parent: render.parentComponent },
      });
    }

    // Evidence #5: Related flow events (APIs, signals, etc.)
    const timingWindow = this.config.correlationWindow;
    for (const step of relatedEvents) {
      if (Math.abs(step.endTime - render.timestamp) <= timingWindow) {
        const flowEvidence = this.createFlowEventEvidence(step, render, eventId++);
        if (flowEvidence) {
          evidence.push(flowEvidence);
        }
      }
    }

    // Evidence #6: CD efficiency metrics
    if (render.cdCount !== undefined) {
      if (render.cdCount < 1.5) {
        evidence.push({
          id: `evidence-${eventId++}`,
          type: 'cd-mer-efficient',
          description: `CD efficiency is good (CD count: ${render.cdCount})`,
          strength: 'weak',
          source: 'RenderTracker',
          timestamp: render.timestamp,
          componentName: render.componentName,
          weight: 0.5,
          metadata: { cdCount: render.cdCount },
        });
      } else {
        evidence.push({
          id: `evidence-${eventId++}`,
          type: 'cd-mer-inefficient',
          description: `CD efficiency is poor (many CD cycles: ${render.cdCount})`,
          strength: 'weak',
          source: 'RenderTracker',
          timestamp: render.timestamp,
          componentName: render.componentName,
          weight: -0.3, // Reduces confidence
          metadata: { cdCount: render.cdCount },
        });
      }
    }

    // Evidence #7: Timing patterns
    const timingPattern = this.analyzeTimingPattern(render, allRenders);
    if (timingPattern) {
      evidence.push(timingPattern);
    }

    // Calculate confidence score from evidence
    const confidence = this.calculateConfidence(evidence);

    // Build timeline
    const timeline = this.buildEvidenceTimeline(render, evidence);

    return {
      componentName: render.componentName,
      renderTimestamp: render.timestamp,
      evidence,
      confidence,
      timeline,
    };
  }

  /**
   * Create evidence from a render cause.
   */
  private createCauseEvidence(
    cause: RenderCause,
    render: RenderEvent,
    id: number
  ): Evidence {
    const typeMap: Record<RenderCause['type'], EvidenceType> = {
      signal: 'signal-timing',
      input: 'input-timing',
      zone: 'zone-task-timing',
      parent: 'parent-render-causality',
      'manual-cd': 'zone-task-timing',
    };

    return {
      id: `evidence-${id}`,
      type: typeMap[cause.type],
      description: `${cause.type} cause detected${cause.source ? ': ' + cause.source : ''}`,
      strength: cause.type === 'signal' || cause.type === 'input' ? 'strong' : 'weak',
      source: 'RenderTracker',
      timestamp: render.timestamp,
      componentName: render.componentName,
      weight: this.config.evidenceWeights[typeMap[cause.type]],
      metadata: { cause: cause.type, source: cause.source },
    };
  }

  /**
   * Create evidence from a related execution step (API, signal, etc.).
   */
  private createFlowEventEvidence(
    step: ExecutionStep,
    render: RenderEvent,
    id: number
  ): Evidence | null {
    const timeDelta = render.timestamp - step.endTime;

    // Map step types to evidence types
    let evidenceType: EvidenceType = 'unknown-trigger';
    if (step.type === 'data-fetch') {
      evidenceType = 'api-response-timing';
    } else if (step.type === 'state-update') {
      evidenceType = 'store-dispatch-timing';
    } else if (step.type === 'computation') {
      evidenceType = 'computed-update-timing';
    }

    const strength = Math.abs(timeDelta) < 10 ? 'strong' : 'weak';

    return {
      id: `evidence-${id}`,
      type: evidenceType,
      description: `${step.type} occurred ${Math.abs(timeDelta).toFixed(1)}ms before render: ${step.title}`,
      strength,
      source: 'ExecutionIntelligence',
      timestamp: step.endTime,
      componentName: render.componentName,
      weight: this.config.evidenceWeights[evidenceType],
      metadata: { step: step.type, title: step.title, timeDelta },
    };
  }

  /**
   * Analyze timing patterns in the render sequence.
   */
  private analyzeTimingPattern(render: RenderEvent, allRenders: RenderEvent[]): Evidence | null {
    // Check for "no timing gaps" pattern (parent → child render with <10ms gap)
    const siblingRenders = allRenders.filter(
      r => r.timestamp > render.timestamp - 50 && r.timestamp < render.timestamp + 50
    );

    if (siblingRenders.length > 1) {
      const gaps = siblingRenders.map((r, i) => {
        if (i === 0) return 0;
        return r.timestamp - siblingRenders[i - 1].timestamp;
      });

      const maxGap = Math.max(...gaps.filter(g => g > 0));

      if (maxGap < 10) {
        return {
          id: `evidence-timing-${render.componentName}`,
          type: 'no-timing-gaps',
          description: `Renders are tightly coupled (max gap: ${maxGap.toFixed(1)}ms) suggesting intentional cascade`,
          strength: 'strong',
          source: 'EvidenceCollector',
          timestamp: render.timestamp,
          componentName: render.componentName,
          weight: 0.8,
          metadata: { maxGap, siblingCount: siblingRenders.length },
        };
      }
    }

    return null;
  }

  /**
   * Build evidence timeline for visualization.
   */
  private buildEvidenceTimeline(render: RenderEvent, evidence: Evidence[]): EvidenceTimeline[] {
    const timeline: EvidenceTimeline[] = [];

    // Sort evidence by timestamp
    const sortedEvidence = [...evidence].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    for (const item of sortedEvidence) {
      if (item.timestamp) {
        // Map evidence types to timeline types
        let eventType: 'trigger' | 'intermediate' | 'render' = 'intermediate';
        if (item.type.includes('user-interaction') || item.type.includes('user-click')) {
          eventType = 'trigger';
        } else if (item.type.includes('render')) {
          eventType = 'render';
        }

        timeline.push({
          timestamp: item.timestamp,
          event: item.description,
          type: eventType,
          componentName: item.componentName,
          detail: item.source_detail,
        });
      }
    }

    // Add render event itself
    timeline.push({
      timestamp: render.timestamp,
      event: `${render.componentName} rendered`,
      type: 'render',
      componentName: render.componentName,
      detail: `Duration: ${render.duration.toFixed(1)}ms`,
    });

    return timeline;
  }

  /**
   * Calculate confidence score from evidence array.
   */
  private calculateConfidence(evidence: Evidence[]): Confidence {
    if (evidence.length === 0) {
      return {
        score: 0,
        level: 'low',
        evidence: [],
        explanation: 'No evidence collected.',
      };
    }

    // Weight-average the evidence scores
    let totalWeight = 0;
    let weightedScore = 0;

    for (const item of evidence) {
      const strength = item.strength === 'direct' ? 1.0 : item.strength === 'strong' ? 0.8 : 0.4;
      const contribution = item.weight * strength;
      weightedScore += contribution;
      totalWeight += Math.abs(item.weight);
    }

    // Normalize to 0-100
    const rawScore = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;
    const score = Math.max(0, Math.min(100, rawScore));

    // Round to meaningful values: 50, 65, 75, 85, 95
    const roundedScore = Math.round(score / 5) * 5;

    // Determine confidence level
    const level =
      roundedScore >= this.config.highThreshold
        ? 'high'
        : roundedScore >= this.config.mediumThreshold
          ? 'medium'
          : 'low';

    // Generate explanation
    const explanation = this.generateConfidenceExplanation(level, evidence);

    // Identify caveats
    const caveats = this.identifyCaveats(evidence);

    return {
      score: roundedScore,
      level,
      evidence: evidence.slice(0, 5), // Top 5 evidence items
      explanation,
      caveats: caveats.length > 0 ? caveats : undefined,
    };
  }

  /**
   * Generate human-readable explanation of confidence score.
   */
  private generateConfidenceExplanation(level: 'high' | 'medium' | 'low', evidence: Evidence[]): string {
    const directCount = evidence.filter(e => e.strength === 'direct').length;
    const strongCount = evidence.filter(e => e.strength === 'strong').length;
    const weakCount = evidence.filter(e => e.strength === 'weak').length;

    if (level === 'high') {
      return `Multiple strong signals support this render cause. Direct observations (${directCount}), strong evidence (${strongCount}), and timing patterns confirm the causality.`;
    } else if (level === 'medium') {
      return `Some evidence supports this render cause, but not conclusively. ${strongCount} strong signals detected, but timing gaps or weak evidence reduce confidence.`;
    } else {
      return `Limited evidence for this render cause. Could not establish clear trigger. ${weakCount} weak signals detected, but no direct observation or strong timing correlation.`;
    }
  }

  /**
   * Identify caveats or limitations in confidence reasoning.
   */
  private identifyCaveats(evidence: Evidence[]): string[] {
    const caveats: string[] = [];

    // Caveat: If there are many weak evidence items
    const weakCount = evidence.filter(e => e.strength === 'weak').length;
    if (weakCount >= 3) {
      caveats.push('Multiple weak signals make causality unclear. Consider alternative causes.');
    }

    // Caveat: If confidence is based on timing alone (no direct observation)
    const hasDirectObservation = evidence.some(e => e.strength === 'direct');
    if (!hasDirectObservation) {
      caveats.push('No direct observation of the cause. Causality is inferred from timing.');
    }

    // Caveat: If there are counter-evidence items (cd-mer-inefficient)
    const counterEvidence = evidence.filter(e => e.weight < 0);
    if (counterEvidence.length > 0) {
      caveats.push('Counter-evidence detected: ' + counterEvidence.map(e => e.description).join('; '));
    }

    return caveats;
  }

  /**
   * Get default confidence configuration.
   */
  private getDefaultConfig(): ConfidenceConfig {
    return {
      evidenceWeights: {
        'direct-render-observation': 1.0,
        'signal-timing': 0.9,
        'input-timing': 0.9,
        'parent-render-causality': 0.85,
        'api-response-timing': 0.85,
        'user-interaction-trigger': 0.9,
        'zone-task-timing': 0.7,
        'route-change-timing': 0.85,
        'perfect-timing': 0.8,
        'all-steps-successful': 0.6,
        'long-chain': 0.7,
        'parallel-execution': 0.6,
        'store-dispatch-timing': 0.85,
        'subject-emit-timing': 0.85,
        'computed-update-timing': 0.8,
        'no-timing-gaps': 0.8,
        'cd-mer-efficient': 0.5,
        'cd-mer-inefficient': -0.3,
        'orphan-chain': 0.4,
        'external-callback': 0.3,
        'unknown-trigger': 0.2,
      },
      highThreshold: 80,
      mediumThreshold: 50,
      minEvidenceItems: 1,
      correlationWindow: 50,
      penalizeTimingGaps: true,
    };
  }
}
