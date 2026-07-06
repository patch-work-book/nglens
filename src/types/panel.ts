// src/types/panel.ts

import type { RenderCause } from './render-events';

export type SeverityLevel = 'CRITICAL' | 'WARNING' | 'INFO';

export interface Issue {
  id: string;
  type: 'render-hot' | 'leak' | 'trackby' | 'onpush' | 'hotspot' | 'zone-pollution';
  componentName: string;
  severity: SeverityLevel;
  title: string;
  description: string;
  timestamp: number;
  route?: string;
}

export interface ComponentStats {
  componentName: string;
  renderCount: number;
  renderFrequency: number;
  averageDuration: number;
  totalDuration: number;
  causesBreakdown: Record<RenderCause['type'], number>;
  firstSeen: number;
  lastSeen: number;
  route?: string;
  // CD-MER metrics
  cdCount?: number;
  mutationCount?: number;
  cdMer?: number;
  // Trigger metrics
  triggerCount?: number;
  // Custom template metrics from Ivy context
  totalTemplateBindings?: number;
  totalOutputListeners?: number;
  hasHighFrequencyZonePollution?: boolean;
  highFrequencyEvents?: string[];
}

export interface ComponentHotspot {
  componentName: string;
  score: number;
  renderCount: number;
  renderFrequency: number;
  averageDuration: number;
  totalDuration: number;
  primaryCause: RenderCause['type'] | 'unknown';
  reasons: string[];
  route?: string;
}

export interface InteractionProfile {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  duration: number;
  renderCount: number;
  componentCount: number;
  totalRenderDuration: number;
  averageRenderDuration: number;
  slowestComponent: string | null;
  dominantCause: RenderCause['type'] | 'unknown';
}

export interface PerformanceSnapshot {
  id: string;
  label: string;
  createdAt: number;
  metrics: {
    issues: number;
    components: number;
    renders: number;
    renderFrequency: number;
    averageRenderDuration: number;
    totalRenderDuration: number;
    leaks: number;
    recommendations: number;
    hotspots: number;
  };
}

export interface SnapshotComparison {
  baseline: PerformanceSnapshot;
  current: PerformanceSnapshot;
  delta: PerformanceSnapshot['metrics'];
}

export type HeatmapSortField = 'renderCount' | 'renderFrequency' | 'averageDuration' | 'totalDuration';
export type SortDirection = 'asc' | 'desc';
