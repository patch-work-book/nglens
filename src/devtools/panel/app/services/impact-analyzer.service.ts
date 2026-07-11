/**
 * Impact Analyzer Service
 * 
 * Computes downstream effects of each execution step.
 * Answers: "What changed as a result of this step?"
 * 
 * For each ExecutionStep, calculates:
 * - Components affected and render counts
 * - Signals modified
 * - Stores updated
 * - Services invoked
 * - RxJS chains activated
 * - Performance metrics
 */

import { Injectable } from '@angular/core';
import type {
  ExecutionStep,
  ExecutionStory,
  RuntimeEvent,
  ImpactMetrics,
} from '../../../../types/execution-intelligence';

@Injectable({ providedIn: 'root' })
export class ImpactAnalyzerService {
  /**
   * Analyze impact for all steps in a story.
   */
  analyzeStory(story: ExecutionStory, eventMap: Map<string, RuntimeEvent>): void {
    for (const step of story.steps) {
      this.analyzeStep(step, eventMap);
    }
  }

  /**
   * Analyze impact for a single step.
   */
  analyzeStep(step: ExecutionStep, eventMap: Map<string, RuntimeEvent>): void {
    // Get all events in this step
    const events = step.eventIds
      .map(id => eventMap.get(id))
      .filter((e): e is RuntimeEvent => !!e);

    // Compute impact metrics
    const impact = this.computeImpactMetrics(events, step.eventIds, eventMap);

    step.impact = impact;
  }

  /**
   * Compute the full impact metrics for a set of events.
   */
  private computeImpactMetrics(
    events: RuntimeEvent[],
    eventIds: string[],
    eventMap: Map<string, RuntimeEvent>
  ): ImpactMetrics {
    // Collect affected resources
    const components = new Set<string>();
    const signals = new Set<string>();
    const stores = new Set<string>();
    const services = new Set<string>();
    const rxjsStreams = new Set<string>();

    let totalRenderCount = 0;
    let totalDuration = 0;
    let renderCount = 0;
    let renderDurationSum = 0;

    // First pass: collect all affected resources
    for (const event of events) {
      if (event.sourceComponent) {
        components.add(event.sourceComponent);
      }

      if (event.ownerClass) {
        const ownerClass = event.ownerClass;
        
        if (ownerClass.includes('Store') || ownerClass.includes('Store')) {
          stores.add(ownerClass);
        } else {
          services.add(ownerClass);
        }
      }

      if (event.propertyName) {
        if (event.type === 'signal-write') {
          signals.add(event.propertyName);
        } else if (event.type === 'subject-emit') {
          rxjsStreams.add(event.propertyName);
        }
      }

      if (event.type === 'component-render') {
        totalRenderCount++;
        renderCount++;
        if (event.duration) {
          renderDurationSum += event.duration;
          totalDuration += event.duration;
        }
      } else {
        totalDuration += event.duration || 0;
      }
    }

    // Second pass: find transitive consumers
    // Look at events AFTER this step to see what consumed the results
    const firstEventTime = events[0]?.timestamp || 0;
    const lastEventTime = events[events.length - 1]?.timestamp || 0;
    const allEvents = Array.from(eventMap.values());

    const directConsumers = new Set<string>();
    const transitiveConsumers = new Set<string>();

    for (const event of allEvents) {
      // Events that happened shortly after this step
      if (event.timestamp > lastEventTime && event.timestamp - lastEventTime < 500) {
        // If it's a render, add the component
        if (event.type === 'component-render' && event.sourceComponent) {
          directConsumers.add(event.sourceComponent);
          transitiveConsumers.add(event.sourceComponent);
        }

        // If it's a store/signal read, add it
        if ((event.type === 'store-select' || event.type === 'subject-emit') && event.ownerClass) {
          directConsumers.add(event.ownerClass);
        }
      }
    }

    const averageRenderDuration = renderCount > 0 ? renderDurationSum / renderCount : 0;

    return {
      components: {
        count: components.size,
        names: Array.from(components),
        renders: totalRenderCount,
      },
      signals: {
        count: signals.size,
        names: Array.from(signals),
      },
      stores: {
        count: stores.size,
        names: Array.from(stores),
      },
      services: {
        count: services.size,
        names: Array.from(services),
      },
      rxjsChains: {
        count: rxjsStreams.size,
        subscriptionCount: Array.from(rxjsStreams)
          .reduce((sum, stream) => sum + this.countSubscriptions(stream, eventMap), 0),
      },
      totalRenderCount,
      averageRenderDuration,
      totalDuration,
      directConsumers: Array.from(directConsumers),
      transitiveConsumers: Array.from(transitiveConsumers),
    };
  }

  /**
   * Count how many times a stream was subscribed to.
   */
  private countSubscriptions(streamName: string, eventMap: Map<string, RuntimeEvent>): number {
    let count = 0;
    for (const event of eventMap.values()) {
      if (event.type === 'subject-emit' && event.propertyName === streamName) {
        count += event.subscribers?.length || 1;
      }
    }
    return count;
  }

  /**
   * Compute consumer tree for a resource (what consumes what).
   */
  computeConsumerTree(
    resourceName: string,
    eventMap: Map<string, RuntimeEvent>
  ): Set<string> {
    const consumers = new Set<string>();

    for (const event of eventMap.values()) {
      // If event originates from the resource
      if (
        event.propertyName === resourceName ||
        event.ownerClass === resourceName ||
        event.sourceComponent === resourceName
      ) {
        // Collect its subscribers
        if (event.subscribers) {
          for (const sub of event.subscribers) {
            consumers.add(sub);
          }
        }

        // Collect components that render due to this
        if (event.type === 'subject-emit' || event.type === 'signal-write') {
          const downstreamEvents = Array.from(eventMap.values()).filter(
            e => e.timestamp > event.timestamp && e.timestamp - event.timestamp < 1000
          );

          for (const downstream of downstreamEvents) {
            if (downstream.sourceComponent) {
              consumers.add(downstream.sourceComponent);
            }
          }
        }
      }
    }

    return consumers;
  }
}
