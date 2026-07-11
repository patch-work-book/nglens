/**
 * Metrics Glossary Service
 * 
 * Plain-English explanations for ngLens metrics.
 * Designed for entry-level Angular developers.
 * 
 * Usage: Inject and call getExplanation(metricName) to get friendly text
 */

import { Injectable } from '@angular/core';

export interface MetricExplanation {
  name: string;
  icon: string;
  shortText: string;        // One-line summary
  longText: string;         // Detailed explanation
  example: string;          // Real-world example
  whatItMeans: string;      // What this metric tells you
  whyItMatters: string;     // Why should you care?
}

@Injectable({ providedIn: 'root' })
export class MetricsGlossaryService {
  private glossary: Record<string, MetricExplanation> = {
    'api-call': {
      name: 'API Call',
      icon: '🌐',
      shortText: 'Data fetched from server',
      longText: 'Your Angular app made a request to a server (using HTTP) to get or send data.',
      example: 'Clicking "Load Users" → sends request to /api/users → server responds with user list',
      whatItMeans: 'Your app is communicating with the backend. Each API call takes time and has a network cost.',
      whyItMatters: 'API calls are usually the slowest part of your app. Many API calls = potential performance bottleneck. Minimize unnecessary calls.',
    },

    'store-update': {
      name: 'Store Update',
      icon: '💾',
      shortText: 'Data saved to application state',
      longText: 'Your app received data from the server and saved it locally so components can access it. This is like a "save" operation.',
      example: 'Server sends user list → App saves to NgRx store or Signal → Components can now read the data',
      whatItMeans: 'Data is now available throughout your app. Components will be notified and can use this data.',
      whyItMatters: 'Store updates should be fast. If a store update takes a long time, you\'re doing too much processing. The data is now "ready" for the UI.',
    },

    'signal-emission': {
      name: 'Signal Emission',
      icon: '⚡',
      shortText: 'Change detected & broadcast to components',
      longText: 'When data changes, Angular (or your signal library) notifies all components that care about this data. It\'s like a "bell ringing" to say "hey, data changed!"',
      example: 'Store updates → Signal emits (bell rings) → Components listening to that signal wake up and see the new data',
      whatItMeans: 'Components are being told "update yourself, your data changed". This triggers component re-renders.',
      whyItMatters: 'Signal emissions are fast but many emissions = many component updates = potential performance issue. Unnecessary signals slow down your app.',
    },

    'component-render': {
      name: 'Component Render',
      icon: '🎨',
      shortText: 'Screen updated with new data',
      longText: 'Angular re-ran a component\'s template logic and updated what the user sees on the screen. This is the actual UI update.',
      example: 'Signal emitted → RevenueChart component re-renders → Chart on screen shows new revenue numbers',
      whatItMeans: 'The user sees something different on their screen now. The DOM was updated with new HTML/values.',
      whyItMatters: 'Component renders can be expensive if you have lots of data or complex templates. Many renders = slower app. This is usually the easiest to optimize.',
    },

    're-render': {
      name: 'Re-render',
      icon: '🔄',
      shortText: 'Component updated after data changed',
      longText: 'Component detected data changed and recalculated its template to show the new data on screen.',
      example: 'User clicks button → data updates → component re-renders → new button state appears',
      whatItMeans: 'Angular is keeping the UI in sync with data. One of the core Angular tasks.',
      whyItMatters: 'Each re-render costs CPU time. Too many = janky UI. Optimize by preventing unnecessary re-renders (OnPush, trackBy, etc).',
    },

    'execution-score': {
      name: 'Execution Score',
      icon: '📊',
      shortText: 'Overall performance rating (0-100)',
      longText: 'A score that rates how efficiently this operation completed. Higher = better.',
      example: 'Loading users fast (< 1s) = 90 score. Loading users slow (> 5s) = 30 score.',
      whatItMeans: 'Green (80+) = good. Yellow (50-79) = okay. Red (< 50) = needs optimization.',
      whyItMatters: 'Quickly see if an operation is performing well. Track over time to spot regressions.',
    },

    'causality-chain': {
      name: 'Causality Chain',
      icon: '🔗',
      shortText: 'One complete business operation',
      longText: 'A group of steps that happened in sequence: API call → data saved → components notified → UI updated. These are causally connected (one causes the next).',
      example: 'Click "Load Revenue" → calls API → saves to store → emits signal → chart renders. That\'s ONE causality chain, not 4 separate events.',
      whatItMeans: 'Think of it as one "transaction". A user action results in this sequence of steps.',
      whyItMatters: 'Causality chains show you the "flow" of data through your app. This is how you understand what your app is actually doing.',
    },

    'chapter': {
      name: 'Chapter',
      icon: '📖',
      shortText: 'Business operation grouped by intent',
      longText: 'A named chapter that describes what your app was doing (e.g., "Load Revenue"). It contains all the causality chains related to that business intent.',
      example: 'Chapter: "Load Revenue" contains API call + store update + signal emit + 3 component renders',
      whatItMeans: 'Instead of seeing 4 separate "events", you see one logical "Load Revenue" operation.',
      whyItMatters: 'Makes it easier to understand what your app is doing. "Load Revenue" is meaningful. "ComponentA rendered, ComponentB rendered" is noise.',
    },

    'insight': {
      name: 'Insight',
      icon: '⚠️',
      shortText: 'Performance warning or suggestion',
      longText: 'ngLens detected something that might be a performance issue or opportunity for optimization.',
      example: '"Component re-rendered 5 times unnecessarily" or "API call took 8 seconds (slow)"',
      whatItMeans: 'ngLens is pointing out something worth investigating.',
      whyItMatters: 'These insights help you spot performance bugs without having to understand the entire flow. Quick wins.',
    },

    'network-delay': {
      name: 'Network Delay',
      icon: '📡',
      shortText: 'Time waiting for server response',
      longText: 'The time between when your app sends a request and when the server responds. This is network latency + server processing time.',
      example: 'Request sent at 0ms → server processes → response arrives at 245ms = 245ms network delay',
      whatItMeans: 'How long the user has to wait for data from the server.',
      whyItMatters: 'Network delays are often the bottleneck. Slow API = slow app. Reduce by optimizing APIs, using caching, or pagination.',
    },

    'rendering-time': {
      name: 'Rendering Time',
      icon: '⏱️',
      shortText: 'Time spent updating the screen',
      longText: 'How long it took for Angular to update the DOM and display changes on screen.',
      example: 'Data arrives at 245ms → Angular renders → screen updated at 270ms = 25ms rendering time',
      whatItMeans: 'How responsive your app feels to data changes.',
      whyItMatters: 'Fast rendering = smooth experience (60fps needs ~16ms per frame). Slow rendering = janky UI.',
    },

    'memory-usage': {
      name: 'Memory Usage',
      icon: '🧠',
      shortText: 'Amount of RAM used by this operation',
      longText: 'How much memory your app consumed during this operation. Important for performance on low-end devices.',
      example: 'Loading 10k items = 2MB memory. Loading 100k items = 20MB (might cause lag)',
      whatItMeans: 'More data = more memory. Eventually runs out or becomes slow.',
      whyItMatters: 'Mobile users have limited RAM. Leaks or inefficient data handling causes crashes or slow apps.',
    },
  };

  getExplanation(metricName: string): MetricExplanation | null {
    return this.glossary[metricName] || null;
  }

  getAllMetrics(): MetricExplanation[] {
    return Object.values(this.glossary);
  }

  // Get a quick tooltip for header display
  getQuickTooltip(metricName: string): string {
    const exp = this.glossary[metricName];
    return exp ? exp.shortText : metricName;
  }

  // Explain a metric in one sentence (for developers in a hurry)
  getQuickExplanation(metricName: string): string {
    const exp = this.glossary[metricName];
    return exp ? exp.whatItMeans : metricName;
  }
}
