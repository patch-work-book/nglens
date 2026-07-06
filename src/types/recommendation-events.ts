// src/types/recommendation-events.ts

import type { SeverityLevel } from './panel';

export interface TrackByIssue {
  id: string;
  componentName: string;
  collectionProperty: string;
  collectionSize: number;
  severity: SeverityLevel;
  recommendation: string;
  frameId?: number;
  route?: string;
}

export interface OnPushScore {
  component: string;
  score: number;
  currentStrategy: 'Default' | 'OnPush';
  factors: OnPushFactor[];
  recommendation: string;
  frameId?: number;
  route?: string;
}

export interface OnPushFactor {
  name: string;
  weight: number;
  met: boolean;
  description: string;
}
