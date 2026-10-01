import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Phase, StoryStep } from '../../../services/execution-story.service';

@Component({
  selector: 'app-execution-story-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="timeline-container">
      <div class="timeline-header">
        <span class="header-label">📖 Execution Story</span>
        <span class="header-meta">{{ getTotalSteps() }} steps · {{ getTotalTime() }}ms</span>
      </div>
      <div class="timeline">
        <div class="timeline-line"></div>
        <div class="phase" style="left: 10%">
          <div class="phase-node phase-trigger">🎯</div>
          <div class="phase-label">
            <span class="label-text">Trigger</span>
            <span class="label-time">0ms</span>
          </div>
        </div>
        <div class="phase" style="left: 35%">
          <div class="phase-node phase-apis">🔌</div>
          <div class="phase-label">
            <span class="label-text">APIs</span>
          </div>
        </div>
        <div class="phase" style="left: 60%">
          <div class="phase-node phase-state">💾</div>
          <div class="phase-label">
            <span class="label-text">State</span>
          </div>
        </div>
        <div class="phase" style="left: 85%">
          <div class="phase-node phase-complete">✅</div>
          <div class="phase-label">
            <span class="label-text">Complete</span>
            <span class="label-time">{{ getTotalTime() }}ms</span>
          </div>
        </div>
      </div>
      <div class="steps-list">
        <div class="step-item severity-ok">
          <div class="step-indicator">🎯</div>
          <div class="step-content">
            <div class="step-header">
              <span class="step-label">Trigger</span>
              <span class="step-time">0ms</span>
            </div>
          </div>
        </div>
        <div class="step-item severity-ok">
          <div class="step-indicator">✅</div>
          <div class="step-content">
            <div class="step-header">
              <span class="step-label">Complete</span>
              <span class="step-time">{{ getTotalTime() }}ms</span>
            </div>
            <div class="step-detail">{{ getTotalSteps() }} total steps</div>
          </div>
        </div>
      </div>
      <div class="stats-footer">
        <div class="stat">
          <span class="stat-label">Total Duration</span>
          <span class="stat-value">{{ getTotalTime() }}ms</span>
        </div>
        <div class="stat">
          <span class="stat-label">Steps</span>
          <span class="stat-value">{{ getTotalSteps() }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Phases</span>
          <span class="stat-value">{{ phases().length }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .timeline-container {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
        background: linear-gradient(135deg, var(--ri-bg-deep) 0%, var(--ri-bg-card) 100%);
        border: 1px solid var(--ri-bg-raised);
        border-radius: 8px;
      }
      .timeline-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
      }
      .header-label {
        color: var(--ri-accent-blue);
        font-weight: 600;
      }
      .header-meta {
        color: var(--ri-accent-blue);
        font-size: 11px;
      }
      .timeline {
        position: relative;
        height: 80px;
        margin: 16px 0;
      }
      .timeline-line {
        position: absolute;
        top: 20px;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, var(--ri-bg-raised), var(--ri-accent-blue), var(--ri-bg-raised));
      }
      .phase {
        position: absolute;
        top: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }
      .phase-node {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        border: 2px solid var(--ri-bg-raised);
        background: var(--ri-bg-card);
      }
      .phase-trigger {
        background: var(--ri-accent-blue);
        border-color: var(--ri-accent-blue);
      }
      .phase-apis {
        background: var(--ri-accent-amber);
        border-color: var(--ri-accent-amber);
      }
      .phase-state {
        background: var(--ri-accent-green);
        border-color: var(--ri-accent-green);
      }
      .phase-renders {
        background: var(--ri-accent-indigo);
        border-color: var(--ri-accent-purple);
      }
      .phase-complete {
        background: var(--ri-accent-blue);
        border-color: var(--ri-accent-blue);
      }
      .phase-label {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        margin-top: 8px;
      }
      .label-text {
        font-size: 11px;
        font-weight: 600;
        color: var(--ri-text-bright);
      }
      .label-time {
        font-size: 9px;
        color: var(--ri-accent-blue);
      }
      .steps-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 12px;
      }
      .step-item {
        display: flex;
        gap: 12px;
        padding: 10px 12px;
        background: color-mix(in srgb, var(--ri-text-bright) 3%, transparent);
        border-left: 3px solid var(--ri-bg-raised);
        border-radius: 4px;
      }
      .step-item.severity-error {
        border-left-color: var(--ri-accent-red);
      }
      .step-item.severity-warn {
        border-left-color: var(--ri-accent-amber);
      }
      .step-item.severity-ok {
        border-left-color: var(--ri-accent-green);
      }
      .step-indicator {
        font-size: 16px;
        flex-shrink: 0;
      }
      .step-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .step-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
      }
      .step-label {
        color: var(--ri-text-bright);
        font-weight: 500;
      }
      .step-time {
        color: var(--ri-accent-blue);
        font-size: 11px;
      }
      .step-detail {
        font-size: 11px;
        color: var(--ri-text-primary);
      }
      .stats-footer {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        padding: 12px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
        font-size: 11px;
      }
      .stat {
        display: flex;
        flex-direction: column;
        gap: 2px;
        text-align: center;
      }
      .stat-label {
        color: var(--ri-accent-blue);
        text-transform: uppercase;
        font-size: 9px;
      }
      .stat-value {
        color: var(--ri-accent-blue);
        font-weight: 600;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionStoryTimelineComponent {
  phases = input<Phase[]>([]);
  steps = input<StoryStep[]>([]);

  getTotalTime(): number {
    const allSteps = this.steps();
    if (allSteps.length === 0) return 0;
    return Math.max(...allSteps.map(s => s.timestamp || 0));
  }

  getTotalSteps(): number {
    return this.steps().length;
  }
}
