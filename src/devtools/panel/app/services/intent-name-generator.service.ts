/**
 * Intent Name Generator Service
 * 
 * Converts causality chains into human-readable business intent names.
 * 
 * Examples:
 * [GET /api/revenue, updateRevenue, revenueSignal, RevenueChart] 
 *   → "Load Revenue"
 * 
 * [_Toast Rendered, _Toast Rendered, _Toast Rendered]
 *   → "Process Toast"
 * 
 * [validateInput, searchAPI, searchStore, searchTable]
 *   → "Customer Search"
 * 
 * [SidebarNavGroup, SidebarNav, DefaultLayout Rendered]
 *   → "Update Sidebar"
 * 
 * Algorithm:
 * 1. Collect all words from step titles (split camelCase)
 * 2. Remove framework noise (Rendered, Component, Service, etc.)
 * 3. Find most frequent meaningful word = entity
 * 4. Classify operation from trigger type + keywords
 * 5. Combine: "Load Revenue", "Process Toast", "Update Sidebar"
 */

import { Injectable } from '@angular/core';
import type { CausalityChain } from './causality-chain-detector.service';

interface IntentAnalysis {
  operation: string;      // "Load", "Update", "Delete", "Validate", "Search"
  entity: string;         // "Revenue", "Orders", "User", "Settings"
  confidence: number;     // 0-1
}

@Injectable({
  providedIn: 'root',
})
export class IntentNameGeneratorService {
  // Noise words that don't contribute to entity identification
  private readonly NOISE_WORDS = new Set([
    'component', 'rendered', 'service', 'store', 'signal',
    'updated', 'api', 'request', 'response', 'data',
    'get', 'post', 'put', 'delete', 'http', 'dispatch',
    'emit', 'module', 'handler', 'manager', 'factory',
    'provider', 'directive', 'pipe', 'guard', 'interceptor',
    'resolver', 'validator', 'adapter', 'wrapper', 'container',
    'controller', 'effect', 'reducer', 'action', 'selector',
    'state', 'update', 'set', 'next', 'subscribe',
    'observable', 'subject', 'behavior', 'replay',
    'on', 'ng', 'init', 'destroy', 'changes', 'check',
    'do', 'after', 'view', 'content', 'default',
    'app', 'root', 'main', 'core', 'shared', 'common',
    'base', 'abstract', 'generic', 'general',
  ]);

  // Framework-specific prefixes to strip
  private readonly FRAMEWORK_PREFIXES = [
    /^_/,              // Angular internal prefix (_Toast → Toast)
    /^ng/i,            // Angular lifecycle (ngOnInit → OnInit)
    /^cdk/i,           // Angular CDK
    /^mat/i,           // Angular Material
  ];

  /**
   * Generate a human-readable name for a causality chain.
   */
  generateIntentName(chain: CausalityChain): { name: string; confidence: number } {
    const intent = this.analyzeChainIntent(chain);

    let name = `${intent.operation} ${intent.entity}`.trim();

    // If entity is empty, try harder
    if (!intent.entity || intent.entity.length === 0) {
      name = this.generateFallbackName(chain);
    }

    return {
      name: name.length > 0 ? name : 'Execution',
      confidence: intent.confidence,
    };
  }

  /**
   * Analyze a chain to extract operation and entity.
   */
  private analyzeChainIntent(chain: CausalityChain): IntentAnalysis {
    const entity = this.extractEntity(chain);
    const operation = this.classifyOperation(chain);

    const confidence = Math.min(
      0.9,
      (entity.length > 0 ? 0.5 : 0) + (operation.length > 0 ? 0.4 : 0)
    );

    return { operation, entity, confidence };
  }

  /**
   * Extract the main entity/domain from a chain.
   * 
   * Strategy:
   * 1. Collect ALL words from step titles (camelCase split)
   * 2. Strip framework prefixes (_Toast → Toast)
   * 3. Remove noise words
   * 4. Frequency analysis — most common word wins
   * 5. Fallback to trigger's most meaningful word
   */
  private extractEntity(chain: CausalityChain): string {
    // Collect words from all sources
    const allWords: string[] = [];

    // From step titles
    chain.steps?.forEach(step => {
      const words = this.extractMeaningfulWords(step.title);
      allWords.push(...words);
    });

    // From trigger title
    const triggerWords = this.extractMeaningfulWords(chain.trigger.title);
    allWords.push(...triggerWords);

    // From render component names
    chain.renders.forEach(render => {
      const words = this.extractMeaningfulWords(render.title);
      allWords.push(...words);
    });

    // From state updates
    chain.stateUpdates.forEach(su => {
      const words = this.extractMeaningfulWords(su.title);
      allWords.push(...words);
    });

    // Filter noise
    const meaningful = allWords.filter(w => 
      w.length > 2 && !this.NOISE_WORDS.has(w.toLowerCase())
    );

    if (meaningful.length === 0) {
      // Last resort: try API endpoint extraction
      return this.extractEntityFromApi(chain.trigger.title);
    }

    // Frequency analysis
    const freq = new Map<string, number>();
    meaningful.forEach(w => {
      const normalized = w.toLowerCase();
      freq.set(normalized, (freq.get(normalized) || 0) + 1);
    });

    // Find most frequent word
    let topWord = '';
    let maxFreq = 0;
    freq.forEach((count, word) => {
      if (count > maxFreq) {
        maxFreq = count;
        topWord = word;
      }
    });

    // Capitalize
    if (topWord.length > 0) {
      return topWord.charAt(0).toUpperCase() + topWord.slice(1);
    }

    return '';
  }

  /**
   * Extract meaningful words from a title string.
   * Handles: camelCase, PascalCase, underscores, slashes, prefixes
   * 
   * "_SidebarNavGroupComponent" → ["Sidebar", "Nav", "Group"]
   * "GET /api/revenue" → ["revenue"]
   * "_Toast Rendered" → ["Toast"]
   */
  private extractMeaningfulWords(title: string): string[] {
    if (!title) return [];

    // Strip framework prefixes
    let cleaned = title;
    for (const prefix of this.FRAMEWORK_PREFIXES) {
      cleaned = cleaned.replace(prefix, '');
    }

    // Split on camelCase, PascalCase, common separators
    const words = cleaned
      .replace(/([a-z])([A-Z])/g, '$1 $2')     // camelCase split
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') // consecutive caps
      .replace(/[\s\-_/\.\,\:\;]+/g, ' ')       // separators
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 2);               // skip tiny words

    // Filter noise
    return words.filter(w => !this.NOISE_WORDS.has(w.toLowerCase()));
  }

  /**
   * Extract entity from API endpoint in title.
   * "GET /api/revenue" → "Revenue"
   * "POST /v1/users/search" → "Users"
   */
  private extractEntityFromApi(title: string): string {
    if (!title) return '';

    const patterns = [
      /\/api\/([a-z]+)/i,
      /\/v\d+\/([a-z]+)/i,
      /(?:GET|POST|PUT|DELETE|PATCH)\s+\/?\w*\/([a-z]+)/i,
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match && match[1] && match[1].length > 2) {
        const entity = match[1];
        return entity.charAt(0).toUpperCase() + entity.slice(1);
      }
    }

    return '';
  }

  /**
   * Generate a fallback name when entity extraction fails entirely.
   * Uses the trigger type and the first meaningful word from any step.
   */
  private generateFallbackName(chain: CausalityChain): string {
    // Try to get ANY word from render titles (most likely to have component names)
    for (const render of chain.renders) {
      const words = this.extractMeaningfulWords(render.title);
      if (words.length > 0) {
        const entity = words[0].charAt(0).toUpperCase() + words[0].slice(1);
        return `Render ${entity}`;
      }
    }

    // Try trigger title
    const triggerWords = this.extractMeaningfulWords(chain.trigger.title);
    if (triggerWords.length > 0) {
      const entity = triggerWords[0].charAt(0).toUpperCase() + triggerWords[0].slice(1);
      const operation = this.classifyOperation(chain);
      return `${operation} ${entity}`;
    }

    // Try state updates
    for (const su of chain.stateUpdates) {
      const words = this.extractMeaningfulWords(su.title);
      if (words.length > 0) {
        const entity = words[0].charAt(0).toUpperCase() + words[0].slice(1);
        return `Update ${entity}`;
      }
    }

    // Absolute fallback based on chain structure
    if (chain.renders.length > 0 && chain.stateUpdates.length === 0) {
      return 'UI Update';
    }
    if (chain.trigger.type === 'data-fetch') {
      return 'Data Fetch';
    }
    if (chain.trigger.type === 'user-interaction') {
      return 'User Action';
    }

    return 'Execution';
  }

  /**
   * Classify the operation type from chain structure and keywords.
   */
  private classifyOperation(chain: CausalityChain): string {
    const allTitles = (chain.steps?.map(s => s.title) || []).join(' ').toLowerCase();
    const triggerTitle = chain.trigger.title.toLowerCase();

    // Keyword-based classification
    if (allTitles.includes('search') || triggerTitle.includes('search') || allTitles.includes('filter')) {
      return 'Search';
    }
    if (allTitles.includes('validate') || triggerTitle.includes('validate') || allTitles.includes('check')) {
      return 'Validate';
    }
    if (allTitles.includes('delete') || triggerTitle.includes('delete') || allTitles.includes('remove')) {
      return 'Delete';
    }
    if (allTitles.includes('create') || triggerTitle.includes('create') || allTitles.includes('new') || allTitles.includes('add')) {
      return 'Create';
    }
    if (allTitles.includes('save') || triggerTitle.includes('save') || allTitles.includes('submit')) {
      return 'Save';
    }
    if (allTitles.includes('init') || triggerTitle.includes('init') || allTitles.includes('bootstrap') || allTitles.includes('load')) {
      return 'Load';
    }
    if (allTitles.includes('navigate') || triggerTitle.includes('route') || allTitles.includes('route')) {
      return 'Navigate';
    }
    if (allTitles.includes('toggle') || triggerTitle.includes('toggle') || allTitles.includes('open') || allTitles.includes('close')) {
      return 'Toggle';
    }

    // Pattern-based classification
    const hasApiCall = chain.trigger.type === 'data-fetch';
    const hasStateUpdate = chain.stateUpdates.length > 0;
    const hasRender = chain.renders.length > 0;

    if (hasApiCall && hasStateUpdate && hasRender) return 'Load';
    if (hasApiCall && !hasStateUpdate) return 'Fetch';
    if (!hasApiCall && hasStateUpdate && hasRender) return 'Update';
    if (!hasApiCall && !hasStateUpdate && hasRender) return 'Render';

    // Default based on trigger type
    switch (chain.trigger.type) {
      case 'data-fetch': return 'Load';
      case 'state-update': return 'Update';
      case 'computation': return 'Compute';
      case 'user-interaction': return 'Handle';
      case 'validation': return 'Validate';
      default: return 'Process';
    }
  }

  /**
   * Generate a detailed narrative for a chain.
   */
  generateDetailedNarrative(chain: CausalityChain): string {
    const { name } = this.generateIntentName(chain);
    const parts: string[] = [name];

    if (chain.trigger.type === 'data-fetch') {
      const apiSource = this.extractEntityFromApi(chain.trigger.title);
      if (apiSource) {
        parts.push(`from ${apiSource} API`);
      }
    }

    if (chain.stateUpdates.length > 0) {
      parts.push('and update state');
    }

    if (chain.renders.length > 0) {
      parts.push(`to refresh ${chain.renders.length} component${chain.renders.length > 1 ? 's' : ''}`);
    }

    return parts.join(' ');
  }
}
