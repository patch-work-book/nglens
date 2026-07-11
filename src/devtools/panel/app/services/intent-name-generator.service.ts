/**
 * Intent Name Generator Service
 * 
 * Converts causality chains into human-readable business intent names.
 * 
 * Examples:
 * [GET /api/revenue, updateRevenue, revenueSignal, RevenueChart] 
 *   → "Load Revenue"
 * 
 * [validateInput, searchAPI, searchStore, searchTable]
 *   → "Customer Search"
 * 
 * [userAPIresponse, userStore, headerComponent]
 *   → "Update User Context"
 * 
 * Algorithm:
 * 1. Extract domain/entity from step titles
 * 2. Classify operation (Load, Update, Delete, Validate, etc.)
 * 3. Combine into human-readable name
 */

import { Injectable } from '@angular/core';
import type { CausalityChain } from './causality-chain-detector.service';
import type { ExecutionStep } from '../../../../types/execution-intelligence';

interface IntentAnalysis {
  operation: string;      // "Load", "Update", "Delete", "Validate", "Search"
  entity: string;         // "Revenue", "Orders", "User", "Settings"
  confidence: number;     // 0-1
}

@Injectable({
  providedIn: 'root',
})
export class IntentNameGeneratorService {
  /**
   * Generate a human-readable name for a causality chain.
   */
  generateIntentName(chain: CausalityChain): { name: string; confidence: number } {
    // Analyze the chain to extract intent
    const intent = this.analyzeChainIntent(chain);

    // Build the name
    let name = `${intent.operation} ${intent.entity}`;

    // Trim and clean
    name = name.trim();

    return {
      name: name.length > 0 ? name : 'Execution Step',
      confidence: intent.confidence,
    };
  }

  /**
   * Analyze a chain to extract operation and entity.
   */
  private analyzeChainIntent(chain: CausalityChain): IntentAnalysis {
    // Extract entity (domain/resource) from all steps
    const entity = this.extractEntity(chain);

    // Classify operation type
    const operation = this.classifyOperation(chain);

    // Calculate confidence
    const confidence = Math.min(
      0.9,
      (entity.length > 0 ? 0.5 : 0) + (operation.length > 0 ? 0.4 : 0)
    );

    return {
      operation,
      entity,
      confidence,
    };
  }

  /**
   * Extract the main entity/domain from a chain.
   * Examples: "Revenue", "Orders", "User", "Dashboard"
   */
  private extractEntity(chain: CausalityChain): string {
    // Collect all meaningful words from titles
    const words = this.extractKeywordsFromChain(chain);

    // Remove common noise words
    const noiseWords = new Set([
      'component',
      'rendered',
      'service',
      'store',
      'signal',
      'updated',
      'api',
      'request',
      'response',
      'data',
      'get',
      'post',
      'put',
      'delete',
      'http',
      'dispatch',
      'emit',
    ]);

    let candidates = words.filter(w => !noiseWords.has(w.toLowerCase()));

    // Pick the most common word (likely the entity)
    if (candidates.length === 0) {
      // Fallback: try to extract from API endpoint
      const entity = this.extractEntityFromApi(chain.trigger);
      return entity;
    }

    // Frequency analysis: which word appears most?
    const wordFreq = new Map<string, number>();
    candidates.forEach(w => {
      wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
    });

    let topWord = '';
    let maxFreq = 0;
    wordFreq.forEach((freq, word) => {
      if (freq > maxFreq) {
        maxFreq = freq;
        topWord = word;
      }
    });

    return topWord.charAt(0).toUpperCase() + topWord.slice(1);
  }

  /**
   * Extract keywords from chain titles by splitting on camelCase and common separators.
   */
  private extractKeywordsFromChain(chain: CausalityChain): string[] {
    const keywords: string[] = [];

    chain.steps?.forEach(step => {
      const words = this.splitCamelCase(step.title);
      keywords.push(...words);
    });

    return keywords;
  }

  /**
   * Split camelCase and underscored strings into words.
   * "RevenueChart" → ["Revenue", "Chart"]
   * "GET /api/revenue" → ["GET", "api", "revenue"]
   */
  private splitCamelCase(str: string): string[] {
    // Remove leading underscore
    str = str.replace(/^_/, '');

    // Split on camelCase
    let words = str
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') // PascalCase
      .replace(/[\s\-_/\.]+/g, ' ') // common separators
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 0);

    return words;
  }

  /**
   * Extract entity from API endpoint.
   * "GET /api/revenue" → "Revenue"
   * "POST /api/users/search" → "Users"
   */
  private extractEntityFromApi(step: ExecutionStep): string {
    const title = step.title.toLowerCase();

    // Try to extract from common API patterns
    const patterns = [
      /\/api\/([a-z]+)/i,        // /api/revenue
      /\/v\d+\/([a-z]+)/i,       // /v1/revenue
      /get\s+([a-z]+)/i,         // GET revenue
      /post\s+([a-z]+)/i,        // POST revenue
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match && match[1]) {
        const entity = match[1];
        // Singularize common plurals
        if (entity.endsWith('s')) {
          return entity.slice(0, -1).charAt(0).toUpperCase() + entity.slice(1, -1).slice(1);
        }
        return entity.charAt(0).toUpperCase() + entity.slice(1);
      }
    }

    return '';
  }

  /**
   * Classify the operation type from chain structure.
   * Load: API + Store + Renders
   * Update: Store dispatch + Signals + Renders
   * Search: API with "search" keyword
   * Validate: Validation step
   * Initialize: Setup/bootstrap operations
   */
  private classifyOperation(chain: CausalityChain): string {
    const titleLower = chain.trigger.title.toLowerCase();
    const allTitles = chain.steps?.map(s => s.title.toLowerCase()).join(' ') || '';

    // Check for specific keywords
    if (
      allTitles.includes('search') ||
      titleLower.includes('search') ||
      allTitles.includes('filter')
    ) {
      return 'Search';
    }

    if (
      allTitles.includes('validate') ||
      titleLower.includes('validate') ||
      allTitles.includes('check')
    ) {
      return 'Validate';
    }

    if (
      allTitles.includes('delete') ||
      titleLower.includes('delete') ||
      allTitles.includes('remove')
    ) {
      return 'Delete';
    }

    if (
      allTitles.includes('create') ||
      titleLower.includes('create') ||
      allTitles.includes('new')
    ) {
      return 'Create';
    }

    if (
      allTitles.includes('init') ||
      titleLower.includes('init') ||
      allTitles.includes('bootstrap') ||
      allTitles.includes('load')
    ) {
      return 'Load';
    }

    // Pattern-based classification
    const hasApiCall = chain.trigger.type === 'data-fetch';
    const hasStateUpdate = chain.stateUpdates.length > 0;
    const hasRender = chain.renders.length > 0;

    // API + Store + Render = Load
    if (hasApiCall && hasStateUpdate && hasRender) {
      return 'Load';
    }

    // Just Store + Render = Update
    if (!hasApiCall && hasStateUpdate && hasRender) {
      return 'Update';
    }

    // Just API = Fetch
    if (hasApiCall && !hasStateUpdate) {
      return 'Fetch';
    }

    // Default based on trigger type
    switch (chain.trigger.type) {
      case 'data-fetch':
        return 'Load';
      case 'state-update':
        return 'Update';
      case 'computation':
        return 'Compute';
      case 'user-interaction':
        return 'Handle';
      case 'validation':
        return 'Validate';
      default:
        return 'Process';
    }
  }

  /**
   * Generate a detailed narrative for a chain.
   * Example: "Load Revenue from API and update dashboard store"
   */
  generateDetailedNarrative(chain: CausalityChain): string {
    const { name } = this.generateIntentName(chain);

    const parts: string[] = [name];

    // Add source if API
    if (chain.trigger.type === 'data-fetch') {
      const apiSource = this.extractApiSource(chain.trigger.title);
      if (apiSource) {
        parts.push(`from ${apiSource}`);
      }
    }

    // Add stores affected
    if (chain.stateUpdates.length > 0) {
      const stores = chain.stateUpdates
        .map(s => this.extractEntity(chain))
        .filter((v, i, a) => a.indexOf(v) === i); // unique
      if (stores.length > 0) {
        parts.push(`and store ${stores.join(', ')}`);
      }
    }

    // Add components affected
    if (chain.renders.length > 0) {
      parts.push(`to update UI`);
    }

    return parts.join(' ');
  }

  /**
   * Extract human-readable API source from title.
   * "GET /api/revenue" → "Revenue API"
   */
  private extractApiSource(title: string): string {
    const match = title.match(/\/api\/(\w+)/i);
    if (match && match[1]) {
      return `${match[1]} API`;
    }
    return '';
  }
}
