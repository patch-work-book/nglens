# Execution Narrative - Implementation Plan

## Phase 1: Data Model (IMMEDIATE)

### New Types to Add

```typescript
// src/types/execution-narrative.ts

export interface ExecutionNarrative {
  id: string;
  storyId: string;
  
  // What happened at highest level
  title: string;              // "Dashboard Bootstrap"
  userIntent: string;         // "DashboardComponent.ngOnInit()"
  summary: string;            // One-line summary
  
  // Business-oriented structure
  chapters: Chapter[];        // Grouped by domain
  
  // The signature feature
  executionNarrative: string; // One paragraph explanation
  
  // Score
  score: ExecutionScore;
  
  // Observations (why this matters)
  observations: Observation[];
}

export interface Chapter {
  id: string;
  domain: string;             // "Revenue Module" (business language!)
  icon: string;               // "💰"
  
  // What this chapter did
  title: string;              // "Load Revenue Data"
  summary: string;
  duration: number;
  
  // Rollup metrics
  metrics: ChapterMetrics;
  
  // Tree structure
  parentChapterId?: string;
  childChapters: string[];    // IDs of child chapters
  
  // Causality
  causedBy: CausalityLink;    // What triggered this
  triggers: CausalityLink[];  // What this triggered
  
  // Implementation details (collapsible)
  subsections: Subsection[];
}

export interface ChapterMetrics {
  apiCalls: {
    count: number;
    duration: number;        // Total time in APIs
    endpoints: string[];     // GET /api/revenue, etc
  };
  stores: {
    count: number;
    updated: string[];       // Which stores
    propertiesChanged: number;
  };
  signals: {
    count: number;
    emitted: string[];
  };
  components: {
    count: number;
    updated: string[];       // Business-friendly names
    renders: number;
  };
}

export interface Subsection {
  id: string;
  label: string;             // "Revenue API" (not "APICall")
  icon: string;              // "🌐"
  type: 'api' | 'store' | 'signal' | 'component' | 'render';
  
  // What changed
  changes: FieldChange[];
  
  // Why and what triggered
  causedBy: string;          // "DashboardStore updated"
  triggered: string[];       // ["RevenueChart rendered"]
  
  // Timeline
  startTime: number;
  endTime: number;
  
  // Observations
  observations?: string[];
}

export interface CausalityLink {
  chapterId: string;
  relationship: 'triggered-by' | 'caused' | 'enabled' | 'followed-by';
  delay?: number;            // ms between events
}

export interface Observation {
  type: 'positive' | 'warning' | 'critical';
  title: string;             // "Double render detected"
  description: string;
  severity: number;          // 1-5
  affectedChapters: string[];
}

export interface TimelineEvent {
  timestamp: number;
  event: string;             // "Revenue API completed"
  duration?: number;
  status: 'started' | 'completed' | 'error';
}
```

---

## Phase 2: Narrative Builder Service

```typescript
// src/devtools/panel/app/services/narrative-builder.service.ts

@Injectable({ providedIn: 'root' })
export class NarrativeBuilderService {
  /**
   * Transform ExecutionStory into ExecutionNarrative
   */
  buildNarrative(story: ExecutionStory): ExecutionNarrative {
    // Step 1: Cluster steps into chapters by domain
    const chapters = this.clusterIntoChapters(story.steps);
    
    // Step 2: Build chapter tree (parent/child relationships)
    this.buildChapterTree(chapters);
    
    // Step 3: Detect causality between chapters
    this.detectChapterCausality(chapters);
    
    // Step 4: Generate observations
    const observations = this.generateObservations(story, chapters);
    
    // Step 5: Generate narrative paragraph
    const narrative = this.generateNarrativeText(story, chapters, observations);
    
    return {
      id: `narrative-${Date.now()}`,
      storyId: story.id,
      title: story.title,
      userIntent: this.detectUserIntent(story),
      summary: story.summary,
      chapters,
      executionNarrative: narrative,
      score: story.executionScore,
      observations,
    };
  }

  /**
   * Cluster steps by business domain
   * 
   * E.g., all "Revenue API", "Revenue Store", "RevenueChart Render"
   * become one chapter: "Revenue Module"
   */
  private clusterIntoChapters(steps: ExecutionStep[]): Chapter[] {
    // Algorithm:
    // 1. Extract domain keywords from each step
    //    "Revenue" from "RevenueChart", "Revenue API", etc
    // 2. Group steps by domain
    // 3. Create chapter for each domain cluster
    // 4. Order by execution time
    
    const domainClusters = new Map<string, ExecutionStep[]>();
    
    for (const step of steps) {
      const domain = this.extractDomain(step);
      if (!domainClusters.has(domain)) {
        domainClusters.set(domain, []);
      }
      domainClusters.get(domain)!.push(step);
    }
    
    return Array.from(domainClusters.entries())
      .map(([domain, steps]) => this.createChapter(domain, steps))
      .sort((a, b) => a.metrics.startTime - b.metrics.startTime);
  }

  /**
   * Extract business domain from step
   * "RevenueChart" → "Revenue"
   * "OrdersStore" → "Orders"
   * "UserAPI" → "User"
   */
  private extractDomain(step: ExecutionStep): string {
    // Use common naming patterns
    const patterns = [
      /^(_)?([A-Z][a-z]+)(?:Component|Store|API|Signal|Chart|Table|Card)/,
      /^(_)?([A-Z][a-z]+)/,
    ];
    
    for (const pattern of patterns) {
      const match = (step.title + step.summary).match(pattern);
      if (match) return match[2];
    }
    
    return 'Other';
  }

  /**
   * Create a chapter from a cluster of steps
   */
  private createChapter(domain: string, steps: ExecutionStep[]): Chapter {
    return {
      id: `chapter-${domain}-${Date.now()}`,
      domain,
      icon: this.getDomainIcon(domain),
      title: this.getDomainTitle(domain),
      summary: this.summarizeSteps(steps),
      duration: this.calculateDuration(steps),
      metrics: this.rollupMetrics(steps),
      childChapters: [],
      causedBy: { chapterId: '', relationship: 'triggered-by' },
      triggers: [],
      subsections: this.createSubsections(steps),
    };
  }

  /**
   * Detect causality between chapters
   * "Revenue API completed" → "Revenue Store updated"
   */
  private detectChapterCausality(chapters: Chapter[]): void {
    for (let i = 0; i < chapters.length - 1; i++) {
      const current = chapters[i];
      const next = chapters[i + 1];
      
      // Check if next likely caused by current
      if (this.isLikleyCaused(current, next)) {
        next.causedBy = {
          chapterId: current.id,
          relationship: 'triggered-by',
          delay: next.metrics.startTime - current.metrics.endTime,
        };
        current.triggers.push({
          chapterId: next.id,
          relationship: 'caused',
        });
      }
    }
  }

  /**
   * Generate observations about what happened
   */
  private generateObservations(
    story: ExecutionStory,
    chapters: Chapter[]
  ): Observation[] {
    const observations: Observation[] = [];
    
    // Check for double renders
    const doubleRenders = chapters
      .flatMap(c => c.subsections)
      .filter(s => s.type === 'component')
      .filter(s => s.triggered.length > 1);
    
    if (doubleRenders.length > 0) {
      observations.push({
        type: 'warning',
        title: 'Double renders detected',
        description: `${doubleRenders.length} components rendered more than once`,
        severity: 2,
        affectedChapters: [...new Set(
          doubleRenders.map(s => this.findChapterForSubsection(s, chapters))
        )],
      });
    }
    
    // Check for large payloads
    const largePayloads = chapters
      .flatMap(c => c.subsections)
      .filter(s => s.type === 'api')
      .filter(s => s.changes.some(c => c.size > 1000000));
    
    if (largePayloads.length > 0) {
      observations.push({
        type: 'warning',
        title: 'Large payloads detected',
        description: `${largePayloads.length} API responses were larger than expected`,
        severity: 2,
        affectedChapters: [],
      });
    }
    
    return observations;
  }

  /**
   * Generate the execution narrative (THE SIGNATURE FEATURE)
   * 
   * This is the one paragraph that explains everything
   */
  private generateNarrativeText(
    story: ExecutionStory,
    chapters: Chapter[],
    observations: Observation[]
  ): string {
    // Build narrative components
    const intent = this.detectUserIntent(story);
    const chronology = this.buildChronology(chapters);
    const impact = this.summarizeImpact(chapters);
    const observations_text = observations
      .map(o => `${o.type === 'positive' ? '+' : '-'} ${o.title}`)
      .join(', ');
    
    // Template-based narrative generation
    const template = `
    ${intent} 
    ${chronology}
    This caused ${impact}
    Total execution time: ${story.duration}ms.
    ${observations_text ? `Observations: ${observations_text}.` : ''}
    Execution Score: ${story.executionScore.score} - ${story.executionScore.summary}
    `;
    
    return template.trim();
  }

  /**
   * Detect what user action triggered this
   */
  private detectUserIntent(story: ExecutionStory): string {
    // Find first user interaction or component bootstrap
    const firstStep = story.steps[0];
    
    if (firstStep.type === 'user-interaction') {
      return `Triggered by user action: ${firstStep.summary}`;
    }
    
    if (story.boundary === 'component-bootstrap') {
      return `Triggered by ${story.title} initialization.`;
    }
    
    return `Execution started.`;
  }

  /**
   * Build readable chronology of what happened
   */
  private buildChronology(chapters: Chapter[]): string {
    const steps = chapters.map((c, i) => {
      const trigger = c.causedBy.relationship === 'triggered-by'
        ? `which updated ${c.domain}`
        : '';
      return `${i + 1}. ${c.title} (${c.duration}ms) ${trigger}`;
    });
    
    return steps.join('. ');
  }

  /**
   * Summarize the impact of all these changes
   */
  private summarizeImpact(chapters: Chapter[]): string {
    const totalComponents = chapters.reduce(
      (sum, c) => sum + c.metrics.components.count,
      0
    );
    const totalRenders = chapters.reduce(
      (sum, c) => sum + c.metrics.components.renders,
      0
    );
    
    return `${totalComponents} components to re-render (${totalRenders} renders total)`;
  }

  // ... helper methods ...
}
```

---

## Phase 3: UI Components Redesign

### Left Panel: Intent View

```typescript
// Show what happened at highest level, not events
// Sessions (1)
// 🟢 Dashboard Bootstrap
// 986ms
// ────────────────
// 6 APIs
// 18 Components
// 96 Renders
// 
// Execution Score
// 90
// Why? ↓
```

### Center Panel: Collapsible Story Tree

```typescript
// ① ▼ Revenue Module
//   320ms
//   ├─ Revenue API
//   ├─ Revenue Store
//   ├─ Revenue Signal
//   └─ RevenueChart Rendered
//
// ② ▼ Orders Module
//   450ms
//   └─ ...
```

### Right Panel: Narrative Inspector

```typescript
// 📖 What Happened?
// [One paragraph explanation]
//
// 🔗 Timeline
// 0ms → 250ms → 320ms → ...
//
// 📊 What Changed?
// Revenue: [] → [6 orders]
//
// 👥 Who Cares?
// RevenueChart, SummaryCard
//
// ⚠️ Observations
// + Good: Revenue API completed
// - Warning: Double render detected
```

---

## What Gets Built

1. **NarrativeBuilderService** - Transforms ExecutionStory → ExecutionNarrative
2. **New UI components** - Intent view, collapsible tree, narrative inspector
3. **ExecutionNarrativeGenerator** - Generates that one paragraph
4. **TimelineVisualizer** - Shows causality with time bars

---

## Why This Matters

The difference between:

**Now**: "Show me 58 events"
**Then**: "Here's what your app just did"

That's the gap we're closing.

---

## The Experience

Developer opens ngLens, sees:

> "Dashboard Bootstrap - 986ms - Score 90"
>
> Triggered by DashboardComponent.ngOnInit(). Six API requests were initiated. Revenue and Orders completed successfully. The Dashboard store updated 12 properties, which triggered 3 signals and caused 18 components to re-render. Total execution time: 986ms. One observation: the Revenue Chart rendered twice (possible re-trigger).

Developer thinks: "Wow. That's exactly what I needed to know. No noise. Just context."

**That's** the ngLens experience we're building.
