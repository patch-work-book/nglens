/**
 * Causality Narrative Service
 * 
 * Generates the "WHY" narrative for the inspector panel.
 * 
 * When a developer clicks a chapter, shows:
 * "Why did Revenue Module update?"
 * 
 * Timeline:
 * 0ms    → Revenue API initiated
 * 245ms  → Revenue API completed
 * 246ms  → Revenue Store updated
 * 247ms  → Revenue Signal emitted
 * 272ms  → RevenueChart re-rendered
 * 280ms  → Summary Card re-rendered
 * 
 * This is the centerpiece of the inspector panel.
 */

import { Injectable } from '@angular/core';
import type { CausalityChain } from './causality-chain-detector.service';
import type { Chapter } from '../../../../types/execution-narrative';

export interface CausalityTimelineEntry {
  time: number;         // Relative time in ms
  event: string;        // "Revenue API initiated"
  phase: string;        // "api" | "store" | "signal" | "render"
  duration?: number;    // How long this phase took
  icon: string;         // 🌐, 💾, ⚡, 🎨
  details?: string;     // Additional info
}

export interface CausalityNarrative {
  title: string;                      // "Revenue Module Update"
  why: string;                        // "Dashboard Bootstrap completed"
  timeline: CausalityTimelineEntry[]; // The causality chain with timestamps
  summary: string;                    // "Revenue Module triggered by Dashboard Bootstrap"
  
  /** Forensic metrics for Level 4 investigation */
  forensicMetrics?: {
    interactionToFinalPaint: number; // IFP in ms
    asyncToRenderRatio: number;      // 0-100 (high = IO bound, low = CPU/Render bound)
    criticalPathDepth: number;       // Number of hops in the main causality chain
    signalGlitches: number;          // Number of redundant reactive cycles
    bottleneckTrack: 'USER' | 'EXTERNAL' | 'LOGIC' | 'UI';
  };
}

@Injectable({
  providedIn: 'root',
})
export class CausalityNarrativeService {
  /**
   * Generate causality narrative from a chain.
   */
  generateNarrative(chain: CausalityChain): CausalityNarrative {
    const timeline = this.buildTimeline(chain);
    
    // Calculate Forensic Metrics
    const totalDuration = chain.endTime - (chain.trigger?.startTime || chain.startTime);
    const renderTime = (chain.renders || []).reduce((s, r) => s + (r.duration || 0), 0);
    const asyncToRenderRatio = totalDuration > 0 ? Math.round(((totalDuration - renderTime) / totalDuration) * 100) : 100;
    
    // Detect Critical Path Depth (hops through different phases)
    const phases = new Set(timeline.map(t => t.phase));
    const criticalPathDepth = phases.size;

    // Detect Signal Glitches (heuristic: same signal written > 1 time in one chain)
    const signalWrites = chain.computations || [];
    const signalGlitches = Math.max(0, signalWrites.length - new Set(signalWrites.map(s => s.title)).size);

    const forensicMetrics: CausalityNarrative['forensicMetrics'] = {
      interactionToFinalPaint: totalDuration,
      asyncToRenderRatio,
      criticalPathDepth,
      signalGlitches,
      bottleneckTrack: (renderTime / totalDuration > 0.5) ? 'UI' : (asyncToRenderRatio > 60 ? 'EXTERNAL' : 'LOGIC')
    };

    return {
      title: this.generateTitle(chain),
      why: this.generateWhy(chain),
      timeline,
      summary: this.generateSummary(chain, timeline),
      forensicMetrics,
    };
  }

  /**
   * Build the timeline showing causality flow with actual times.
   */
  private buildTimeline(chain: CausalityChain): CausalityTimelineEntry[] {
    const entries: CausalityTimelineEntry[] = [];
    const startTime = chain.startTime;

    // Phase 1: API Call (if present)
    if (chain.trigger) {
      const triggerTime = chain.trigger.startTime - startTime;
      entries.push({
        time: triggerTime,
        event: `${this.formatStepTitle(chain.trigger.title)} initiated`,
        phase: 'api',
        duration: 0,
        icon: '🌐',
      });

      const completionTime = chain.trigger.endTime - startTime;
      entries.push({
        time: completionTime,
        event: `${this.formatStepTitle(chain.trigger.title)} completed`,
        phase: 'api',
        duration: chain.trigger.duration,
        icon: '🌐',
      });
    }

    // Phase 2: State Updates
    chain.stateUpdates.forEach((update, idx) => {
      const updateTime = update.startTime - startTime;
      entries.push({
        time: updateTime,
        event: `${this.formatStepTitle(update.title)} updated store`,
        phase: 'store',
        duration: update.duration,
        icon: '💾',
        details: `Modified ${update.changes.modified.count} properties`,
      });
    });

    // Phase 3: Signals/Computations
    chain.computations.forEach(comp => {
      const compTime = comp.startTime - startTime;
      entries.push({
        time: compTime,
        event: `${this.formatStepTitle(comp.title)} emitted`,
        phase: 'signal',
        duration: comp.duration,
        icon: '⚡',
      });
    });

    // Phase 4: Renders
    chain.renders.forEach(render => {
      const renderTime = render.startTime - startTime;
      entries.push({
        time: renderTime,
        event: `${this.formatStepTitle(render.title)} re-rendered`,
        phase: 'render',
        duration: render.duration,
        icon: '🎨',
        details: `${render.duration}ms`,
      });
    });

    // Sort by time
    entries.sort((a, b) => a.time - b.time);

    return entries;
  }

  /**
   * Generate title for the narrative.
   */
  private generateTitle(chain: CausalityChain): string {
    // Extract domain from trigger
    const domain = this.extractDomain(chain.trigger.title);

    if (chain.stateUpdates.length > 0 && chain.renders.length > 0) {
      return `${domain} Module Updated`;
    } else if (chain.renders.length > 0) {
      return `${domain} Components Rendered`;
    } else if (chain.stateUpdates.length > 0) {
      return `${domain} Store Changed`;
    }

    return `${domain} Processing`;
  }

  /**
   * Generate "why" explanation.
   */
  private generateWhy(chain: CausalityChain): string {
    // If this is an API trigger, explain what API was called
    if (chain.trigger.type === 'data-fetch') {
      const apiCall = this.extractApiCall(chain.trigger.title);
      return `${apiCall} completed successfully`;
    }

    // If user interaction, explain the interaction
    if (chain.trigger.type === 'user-interaction') {
      return `User interaction triggered`;
    }

    // Default
    return `${this.formatStepTitle(chain.trigger.title)} occurred`;
  }

  /**
   * Generate summary of the entire causality chain.
   */
  private generateSummary(chain: CausalityChain, timeline: CausalityTimelineEntry[]): string {
    const parts: string[] = [];

    // Opening
    parts.push(`${this.generateTitle(chain)}.`);

    // Timeline summary
    if (timeline.length > 0) {
      const firstEvent = timeline[0];
      const lastEvent = timeline[timeline.length - 1];
      const totalTime = lastEvent.time - firstEvent.time;

      parts.push(
        `Started by ${this.formatEventName(firstEvent.event)}. ` +
          `Completed in ${Math.round(totalTime)}ms.`
      );
    }

    // Impact summary
    const impacts: string[] = [];
    if (chain.stateUpdates.length > 0) {
      impacts.push(`${chain.stateUpdates.length} store update${chain.stateUpdates.length !== 1 ? 's' : ''}`);
    }
    if (chain.computations.length > 0) {
      impacts.push(`${chain.computations.length} signal${chain.computations.length !== 1 ? 's' : ''}`);
    }
    if (chain.renders.length > 0) {
      impacts.push(`${chain.renders.length} re-render${chain.renders.length !== 1 ? 's' : ''}`);
    }

    if (impacts.length > 0) {
      parts.push(`Caused: ${impacts.join(', ')}.`);
    }

    return parts.join(' ');
  }

  /**
   * Format a step title for display.
   * "_RevenueChartComponent" → "RevenueChart"
   */
  private formatStepTitle(title: string): string {
    return title
      .replace(/^_/, '') // Remove leading underscore
      .replace(/Component$/, '') // Remove Component suffix
      .replace(/Service$/, '') // Remove Service suffix
      .replace(/Store$/, '') // Remove Store suffix
      .replace(/API$/, '') // Remove API suffix
      .trim();
  }

  /**
   * Format an event name for display.
   * "Revenue API initiated" → "Revenue API"
   */
  private formatEventName(event: string): string {
    return event.replace(/\s+(initiated|completed|updated|emitted|re-rendered)/, '');
  }

  /**
   * Extract domain from a title.
   * "RevenueChart" → "Revenue"
   */
  private extractDomain(title: string): string {
    const words = title
      .replace(/^_/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[\s\-_]+/);

    // Return first significant word
    if (words.length > 0 && words[0].length > 2) {
      return words[0];
    }

    return 'Data';
  }

  /**
   * Extract API call description from title.
   * "GET /api/revenue" → "GET /api/revenue"
   */
  private extractApiCall(title: string): string {
    const match = title.match(/(GET|POST|PUT|DELETE|PATCH)\s+([^\s]+)/i);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }

    return this.formatStepTitle(title);
  }

  /**
   * Generate a visual causality chain string.
   * For compact display in UI.
   */
  generateVisualChain(chain: CausalityChain): string {
    const parts: string[] = [];

    // Trigger
    parts.push(this.formatStepTitle(chain.trigger.title));

    // State updates
    chain.stateUpdates.forEach(s => {
      parts.push('→ ' + this.formatStepTitle(s.title));
    });

    // Computations
    chain.computations.forEach(c => {
      parts.push('→ ' + this.formatStepTitle(c.title));
    });

    // Renders
    chain.renders.forEach(r => {
      parts.push('→ ' + this.formatStepTitle(r.title));
    });

    return parts.join('\n');
  }

  /**
   * Generate causality narrative for chapter (for inspector).
   */
  generateChapterCausality(chapter: Chapter, chain: CausalityChain): string {
    const narrative = this.generateNarrative(chain);

    // Build a human-readable narrative
    const lines: string[] = [
      `## ${narrative.title}`,
      ``,
      `**Why?** ${narrative.why}`,
      ``,
      `**Timeline:**`,
      ...narrative.timeline.map(
        entry =>
          `${entry.time}ms ${entry.icon} ${entry.event}${entry.details ? ` (${entry.details})` : ''}`
      ),
      ``,
      `**Total Duration:** ${chapter.duration}ms`,
    ];

    return lines.join('\n');
  }
}
