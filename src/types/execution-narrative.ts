/**
 * Execution Narrative Architecture
 * 
 * Transforms ExecutionStory (200+ events in 15 steps) into ExecutionNarrative
 * (5-8 business chapters with one-paragraph explanation).
 * 
 * Key insight: Developers think in business domains, not implementation details.
 * Instead of showing: "DataGrid Rendered", "Layout Rendered", "Store Updated"
 * Show: "Revenue Module" → [API, Store, Signal, Components]
 */

import type { ExecutionStep, ExecutionScore, InsightMessage, ImpactMetrics } from './execution-intelligence';

// ──────────────────────────────────────────────────────────────────────────────
// NARRATIVE BUILDER OUTPUT
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A business domain extraction from component/service names.
 * Examples:
 * - "RevenueChart", "RevenueStore", "RevenueAPI" → domain: "Revenue"
 * - "_OrdersDataGrid", "_OrdersService" → domain: "Orders"
 * - "UserHeader", "UserSidebar" → domain: "User"
 * 
 * Extraction algorithm:
 * 1. Remove common prefixes/suffixes (_Component, Component, Service, Store, API, etc.)
 * 2. Identify PascalCase word segments
 * 3. Group by first word (Revenue, Orders, User, etc.)
 * 4. Map common names to business icons
 */
export interface BusinessDomain {
  id: string;
  name: string;                      // "Revenue", "Orders", "User"
  icon: string;                      // "💰", "📦", "👤"
  
  // Raw components that matched this domain
  componentNames: string[];
  serviceNames: string[];
  apiEndpoints: string[];
  
  // Confidence that this domain is correct (0-1)
  confidence: number;
}

/**
 * One chapter in the execution narrative.
 * A chapter is a cluster of execution steps grouped by business domain.
 * 
 * Example: Revenue Module Chapter includes:
 * - Revenue API call
 * - Revenue Store update
 * - Revenue Signal emission
 * - RevenueChart, SummaryCard renders
 */
export interface Chapter {
  id: string;
  
  // Business identity
  domain: BusinessDomain;
  sequenceNumber: number;            // ① Revenue Module, ② Orders Module, etc.
  
  // Summary
  summary: string;                   // "Loaded revenue data from API"
  duration: number;
  
  // Timeline visualization
  startTime: number;
  endTime: number;
  
  // Steps in this chapter (original ExecutionSteps)
  stepIds: string[];                 // References to ExecutionStep.id
  
  // Aggregated metrics from all steps
  metrics: ChapterMetrics;
  
  // Causality
  causedBy: Chapter | null;          // Parent chapter (what triggered this)
  triggers: Chapter[];               // Child chapters (what this triggered)
  
  // Why this chapter exists
  trigger: string;                   // "DashboardComponent.ngOnInit()", "User clicked Refresh"
  
  // Data changes in this chapter
  changes: ChapterChange[];
  
  // Components affected in this chapter
  affectedComponents: string[];
  
  // Expandable tree structure (collapsible UI)
  subsections: Subsection[];
  
  // Insights specific to this chapter
  observations: string[];            // "Revenue API was slower than usual (450ms)"
}

/**
 * Aggregated metrics for a chapter (all its steps combined).
 */
export interface ChapterMetrics {
  // API metrics
  apiCalls: {
    count: number;
    endpoints: string[];
    totalDuration: number;
    failures: number;
  };
  
  // State management
  storeUpdates: {
    count: number;
    storeNames: string[];
    propertiesChanged: number;
  };
  
  // Reactivity
  signalEmissions: {
    count: number;
    signalNames: string[];
  };
  
  // UI rendering
  componentRenders: {
    count: number;
    componentNames: string[];
    totalDuration: number;
    slowRenders: number;              // Renders > 16ms
  };
  
  // Payload metrics
  payloadSize: number;               // Total bytes transferred
  payloadGrowth: number;             // Compared to baseline
}

/**
 * What changed during a chapter's execution.
 * Business-friendly representation of data changes.
 */
export interface ChapterChange {
  entityType: string;                // "Revenue", "Orders", "Settings"
  field: string;                     // "total", "count", "status"
  
  before: string;                    // Stringified value
  after: string;
  
  changeType: 'added' | 'removed' | 'modified' | 'increased' | 'decreased';
  
  // Business meaning
  humanReadable: string;             // "Revenue increased from $1000 to $1200"
  
  // Impact
  affectedComponents: string[];
}

/**
 * One subsection within a chapter (expandable tree item).
 * Examples:
 * - "Revenue API" → GET /api/revenue
 * - "Revenue Store" → Store dispatch
 * - "RevenueChart" → Component render
 */
export interface Subsection {
  id: string;
  
  type: 'api' | 'store' | 'signal' | 'component' | 'render' | 'computed';
  
  label: string;                     // "Revenue API", "Revenue Store", "RevenueChart"
  icon: string;                      // "🌐", "💾", "⚡", "🎨"
  
  // Business meaning
  summary: string;                   // "Fetched revenue data"
  
  // Implementation details
  implementation: string;            // "GET /api/revenue", "dispatch(updateRevenue)", "render()"
  
  duration?: number;
  
  // Data changes
  changes: ChapterChange[];
  
  // Causality
  causedBy: string;                  // Parent subsection label
  triggers: string[];                // Child subsection labels
  
  // Consumers
  consumers: string[];               // Components that depend on this
  
  // Performance
  isSlowOperation?: boolean;
  observations?: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// EXECUTION NARRATIVE (Main Output)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Complete narrative representation of an execution.
 * Transforms ExecutionStory into business-friendly narrative.
 * 
 * This is what the UI displays at all three levels:
 * - Sessions panel: domain icon + name + metrics
 * - Execution journal: collapsible tree of chapters
 * - Inspector: narrative paragraph + timeline + changes
 */
export interface ExecutionNarrative {
  id: string;
  
  // Identity (from parent ExecutionStory)
  storyId: string;
  title: string;                     // "Dashboard Bootstrap"
  trigger: string;                   // "DashboardComponent.ngOnInit()"
  
  // Timeline
  startTime: number;
  endTime: number;
  duration: number;
  
  // Story structure (grouped by business domain)
  chapters: Chapter[];
  chapterCount: number;
  
  // Overall narrative paragraph (signature feature!)
  executionNarrative: string;        // One paragraph explaining what happened
  
  // Overall metrics
  metrics: {
    totalApiCalls: number;
    totalComponents: number;
    totalRenders: number;
    totalPayloadSize: number;
    totalSignalEmissions: number;
  };
  
  // Overall insights and observations
  observations: string[];
  
  // Performance score (inherited from ExecutionStory)
  executionScore: ExecutionScore;
  
  // Insights from original story
  insights: InsightMessage[];
  
  // Raw execution data (for fallback)
  originalStory: any;                // Reference to ExecutionStory (for debugging)

  /** Forensic metrics for Level 4 investigation */
  forensicMetrics?: {
    interactionToFinalPaint: number; // IFP in ms
    asyncToRenderRatio: number;      // 0-100 (high = IO bound, low = CPU/Render bound)
    criticalPathDepth: number;       // Number of hops in the main causality chain
    signalGlitches: number;          // Number of redundant reactive cycles
    bottleneckTrack: 'USER' | 'EXTERNAL' | 'LOGIC' | 'UI';
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// NARRATIVE BUILDER CONFIG
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for domain extraction and chapter clustering.
 */
export interface NarrativeBuilderConfig {
  // Domain extraction
  domainKeywords: Record<string, string[]>;  // "Revenue": ["revenue", "income", "sales"]
  domainIcons: Record<string, string>;       // "Revenue": "💰"
  
  // Clustering
  maxChapters: number;               // Limit number of chapters (default: 10)
  minChapterSteps: number;           // Minimum steps to form a chapter (default: 1)
  chapterTimeThreshold: number;      // Group steps within this time window (ms)
  
  // Narrative generation
  verboseLevel: 'brief' | 'standard' | 'detailed'; // Length of generated narrative
}

/**
 * Default domain extraction keywords.
 * Maps business concepts to component/service name patterns.
 */
export const DEFAULT_DOMAIN_KEYWORDS: Record<string, string[]> = {
  'Revenue': ['revenue', 'income', 'sales', 'earn'],
  'Orders': ['order', 'purchase', 'transaction', 'checkout', 'cart'],
  'User': ['user', 'profile', 'account', 'customer', 'person'],
  'Settings': ['setting', 'config', 'preference', 'option'],
  'Notification': ['notification', 'alert', 'message', 'popup', 'toast'],
  'Search': ['search', 'query', 'filter', 'find'],
  'Dashboard': ['dashboard', 'home', 'overview', 'summary'],
  'Analytics': ['analytics', 'report', 'metric', 'chart', 'graph'],
  'Export': ['export', 'download', 'save', 'extract'],
  'Import': ['import', 'upload', 'load', 'ingest'],
};

export const DEFAULT_DOMAIN_ICONS: Record<string, string> = {
  'Revenue': '💰',
  'Orders': '📦',
  'User': '👤',
  'Settings': '⚙️',
  'Notification': '🔔',
  'Search': '🔍',
  'Dashboard': '📊',
  'Analytics': '📈',
  'Export': '📥',
  'Import': '📤',
};

export const DEFAULT_NARRATIVE_CONFIG: NarrativeBuilderConfig = {
  domainKeywords: DEFAULT_DOMAIN_KEYWORDS,
  domainIcons: DEFAULT_DOMAIN_ICONS,
  maxChapters: 10,
  minChapterSteps: 1,
  chapterTimeThreshold: 100,         // 100ms
  verboseLevel: 'standard',
};

// ──────────────────────────────────────────────────────────────────────────────
// NARRATIVE UI STATE
// ──────────────────────────────────────────────────────────────────────────────

/**
 * UI state for controlling which chapters/subsections are expanded.
 */
export interface NarrativeUIState {
  expandedChapters: Set<string>;     // Chapter IDs that are expanded
  expandedSubsections: Set<string>;  // Subsection IDs that are expanded
  selectedChapter: string | null;    // Currently selected chapter
  selectedSubsection: string | null; // Currently selected subsection
}

/**
 * Data needed for timeline visualization.
 */
export interface TimelineEntry {
  time: number;
  event: string;                     // "Revenue API initiated", "Store updated"
  duration?: number;
  type: 'api' | 'store' | 'signal' | 'render' | 'milestone';
  icon: string;
}

/**
 * Causality chain for a step (used in inspector).
 */
export interface CausalityChain {
  entries: TimelineEntry[];
  
  // Summary for display
  summary: string;
  
  // Root cause
  rootCause: string;
}
