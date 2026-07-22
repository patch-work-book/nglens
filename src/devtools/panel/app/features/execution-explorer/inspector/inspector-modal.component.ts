/**
 * Inspector Modal Component
 * 
 * Level 4 of the execution tree hierarchy.
 * Displays detailed information about a selected step/subsection.
 * 
 * Organized as collapsible dropdown sections (per vision doc):
 * ▼ 📖 What Happened?     → Narrative explanation
 * ▼ ⏱️ Timeline           → Start/End/Duration
 * ▼ 📊 What Changed?      → State diffs (open by default)
 * ▼ 👥 Who Cares?         → Consumer components
 * ▶ 📦 Payload            → Raw data (collapsed by default)
 * ▶ ⚠️ Observations       → Performance notes (collapsed if empty)
 */

import { Component, Input, Output, EventEmitter, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { TreeNode } from '@nglens/types/execution-tree';
import type { ExecutionNarrative, Subsection, ChapterChange } from '@nglens/types/execution-narrative';

@Component({
  selector: 'app-inspector-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="inspector-overlay" (click)="onClose()">
      <div class="inspector-panel" (click)="$event.stopPropagation()">
        
        <!-- Header -->
        <div class="panel-header">
          <div class="header-left">
            <span class="header-icon">{{ step.icon }}</span>
            <span class="header-title">{{ step.label }}</span>
          </div>
          <button class="close-btn" (click)="onClose()">✕</button>
        </div>
        
        <!-- Content: Collapsible Sections -->
        <div class="panel-content">
          
          <!-- ▼ 📖 What Happened? -->
          @if (subsection?.summary) {
            <div class="section">
              <button class="section-header" (click)="toggleSection('narrative')">
                <span class="toggle">{{ sections().narrative ? '▼' : '▶' }}</span>
                <span class="section-icon">📖</span>
                <span class="section-title">What Happened?</span>
              </button>
              @if (sections().narrative) {
                <div class="section-body narrative-body">
                  <p>{{ subsection!.summary }}</p>
                </div>
              }
            </div>
          }
          
          <!-- ▼ ⏱️ Timeline -->
          <div class="section">
            <button class="section-header" (click)="toggleSection('timeline')">
              <span class="toggle">{{ sections().timeline ? '▼' : '▶' }}</span>
              <span class="section-icon">⏱️</span>
              <span class="section-title">Timeline</span>
              <span class="section-badge">{{ step.duration || 0 }}ms</span>
            </button>
            @if (sections().timeline) {
              <div class="section-body">
                <div class="timeline-grid">
                  <div class="timeline-row">
                    <span class="timeline-label">Start</span>
                    <span class="timeline-value">{{ step.startTime }}ms</span>
                  </div>
                  <div class="timeline-row">
                    <span class="timeline-label">End</span>
                    <span class="timeline-value">{{ step.endTime }}ms</span>
                  </div>
                  <div class="timeline-row" [class.is-slow]="(step.duration || 0) > 250">
                    <span class="timeline-label">Duration</span>
                    <span class="timeline-value">{{ step.duration || 0 }}ms</span>
                  </div>
                </div>
              </div>
            }
          </div>
          
          <!-- ▼ 📊 What Changed? (open by default) -->
          @if (subsection?.changes && subsection!.changes.length > 0) {
            <div class="section">
              <button class="section-header" (click)="toggleSection('changes')">
                <span class="toggle">{{ sections().changes ? '▼' : '▶' }}</span>
                <span class="section-icon">📊</span>
                <span class="section-title">What Changed?</span>
                <span class="section-badge">{{ subsection!.changes.length }}</span>
              </button>
              @if (sections().changes) {
                <div class="section-body">
                  <div class="changes-list">
                    @for (change of subsection!.changes; track change.field) {
                      <div class="change-row">
                        <div class="change-header">
                          <span class="change-entity">{{ change.entityType }}</span>
                          <span class="change-field">.{{ change.field }}</span>
                        </div>
                        <div class="change-diff">
                          <span class="diff-before">{{ change.before }}</span>
                          <span class="diff-arrow">→</span>
                          <span class="diff-after">{{ change.after }}</span>
                        </div>
                        @if (change.humanReadable) {
                          <div class="change-meaning">{{ change.humanReadable }}</div>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
          
          <!-- ▼ 👥 Who Cares? -->
          @if (subsection?.consumers && subsection!.consumers.length > 0) {
            <div class="section">
              <button class="section-header" (click)="toggleSection('consumers')">
                <span class="toggle">{{ sections().consumers ? '▼' : '▶' }}</span>
                <span class="section-icon">👥</span>
                <span class="section-title">Who Cares?</span>
                <span class="section-badge">{{ subsection!.consumers.length }}</span>
              </button>
              @if (sections().consumers) {
                <div class="section-body">
                  <div class="consumers-grid">
                    @for (consumer of subsection!.consumers; track consumer) {
                      <div class="consumer-chip">{{ consumer }}</div>
                    }
                  </div>
                </div>
              }
            </div>
          }
          
          <!-- ▶ 📦 Payload (collapsed by default) -->
          @if (subsection?.implementation) {
            <div class="section">
              <button class="section-header" (click)="toggleSection('payload')">
                <span class="toggle">{{ sections().payload ? '▼' : '▶' }}</span>
                <span class="section-icon">📦</span>
                <span class="section-title">Payload</span>
                <span class="section-badge subtle">{{ formatType(subsection!.type) }}</span>
              </button>
              @if (sections().payload) {
                <div class="section-body">
                  <code class="payload-code">{{ subsection!.implementation }}</code>
                </div>
              }
            </div>
          }
          
          <!-- ▶ ⚠️ Observations (collapsed by default) -->
          @if (subsection?.observations && subsection!.observations.length > 0) {
            <div class="section">
              <button class="section-header" (click)="toggleSection('observations')">
                <span class="toggle">{{ sections().observations ? '▼' : '▶' }}</span>
                <span class="section-icon">⚠️</span>
                <span class="section-title">Observations</span>
                <span class="section-badge warn">{{ subsection!.observations.length }}</span>
              </button>
              @if (sections().observations) {
                <div class="section-body">
                  <div class="observations-list">
                    @for (obs of subsection!.observations; track obs) {
                      <div class="observation-item">{{ obs }}</div>
                    }
                  </div>
                </div>
              }
            </div>
          }
          
        </div>
        
        <!-- Footer -->
        <div class="panel-footer">
          <button class="close-action" (click)="onClose()">Close</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }

    .inspector-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.12s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .inspector-panel {
      background: rgb(17, 24, 39);
      border: 1px solid rgb(55, 65, 81);
      border-radius: 8px;
      width: 90%;
      max-width: 520px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
      animation: slideUp 0.12s ease-out;
    }

    @keyframes slideUp {
      from { transform: translateY(12px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    /* ═══ HEADER ═══ */
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid rgb(55, 65, 81);
      background: rgb(31, 41, 55);
      border-radius: 8px 8px 0 0;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header-icon { font-size: 16px; }

    .header-title {
      font-size: 13px;
      font-weight: 600;
      color: rgb(243, 244, 246);
    }

    .close-btn {
      width: 24px;
      height: 24px;
      border: none;
      background: none;
      color: rgb(156, 163, 175);
      font-size: 16px;
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;

      &:hover {
        color: white;
        background: rgba(255, 255, 255, 0.1);
      }
    }

    /* ═══ CONTENT ═══ */
    .panel-content {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    /* ═══ SECTIONS (Dropdowns) ═══ */
    .section {
      border-bottom: 1px solid rgba(55, 65, 81, 0.5);

      &:last-child { border-bottom: none; }
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 10px 16px;
      border: none;
      background: none;
      color: rgb(209, 213, 219);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: background 0.1s;

      &:hover {
        background: rgba(255, 255, 255, 0.03);
      }
    }

    .toggle {
      font-size: 9px;
      color: rgb(107, 114, 128);
      width: 12px;
      text-align: center;
      flex-shrink: 0;
    }

    .section-icon {
      font-size: 13px;
      flex-shrink: 0;
    }

    .section-title {
      flex: 1;
    }

    .section-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      background: rgba(99, 102, 241, 0.2);
      color: rgb(165, 180, 252);
      font-weight: 500;
      flex-shrink: 0;

      &.subtle {
        background: rgba(107, 114, 128, 0.2);
        color: rgb(156, 163, 175);
      }

      &.warn {
        background: rgba(217, 119, 6, 0.2);
        color: rgb(253, 186, 116);
      }
    }

    .section-body {
      padding: 4px 16px 12px 36px;
      font-size: 11px;
      color: rgb(156, 163, 175);
      animation: expand 0.1s ease-out;
    }

    @keyframes expand {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ═══ NARRATIVE ═══ */
    .narrative-body p {
      margin: 0;
      color: rgb(209, 213, 219);
      line-height: 1.5;
      padding: 8px 12px;
      background: rgba(59, 130, 246, 0.08);
      border-left: 3px solid rgb(59, 130, 246);
      border-radius: 4px;
    }

    /* ═══ TIMELINE ═══ */
    .timeline-grid {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .timeline-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;

      &.is-slow {
        .timeline-value {
          color: rgb(254, 202, 202);
          font-weight: 600;
        }
      }
    }

    .timeline-label {
      color: rgb(107, 114, 128);
    }

    .timeline-value {
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 11px;
      color: rgb(209, 213, 219);
    }

    /* ═══ CHANGES (DIFFS) ═══ */
    .changes-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .change-row {
      padding: 6px 8px;
      background: rgba(30, 41, 59, 0.6);
      border-radius: 4px;
      border: 1px solid rgba(55, 65, 81, 0.5);
    }

    .change-header {
      margin-bottom: 4px;
    }

    .change-entity {
      color: rgb(165, 243, 252);
      font-weight: 500;
    }

    .change-field {
      color: rgb(156, 163, 175);
    }

    .change-diff {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 10px;
    }

    .diff-before {
      color: rgb(252, 165, 165);
      text-decoration: line-through;
    }

    .diff-arrow {
      color: rgb(107, 114, 128);
    }

    .diff-after {
      color: rgb(134, 239, 172);
    }

    .change-meaning {
      margin-top: 4px;
      font-size: 10px;
      color: rgb(156, 163, 175);
      font-style: italic;
    }

    /* ═══ CONSUMERS ═══ */
    .consumers-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .consumer-chip {
      padding: 4px 8px;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 4px;
      font-size: 11px;
      color: rgb(134, 239, 172);
    }

    /* ═══ PAYLOAD ═══ */
    .payload-code {
      display: block;
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 10px;
      color: rgb(165, 243, 252);
      word-break: break-all;
      white-space: pre-wrap;
    }

    /* ═══ OBSERVATIONS ═══ */
    .observations-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .observation-item {
      padding: 6px 8px;
      background: rgba(217, 119, 6, 0.08);
      border-left: 2px solid rgb(217, 119, 6);
      border-radius: 3px;
      font-size: 11px;
      color: rgb(253, 224, 71);
    }

    /* ═══ FOOTER ═══ */
    .panel-footer {
      display: flex;
      justify-content: flex-end;
      padding: 10px 16px;
      border-top: 1px solid rgb(55, 65, 81);
      background: rgb(31, 41, 55);
      border-radius: 0 0 8px 8px;
    }

    .close-action {
      padding: 6px 14px;
      border: 1px solid rgb(75, 85, 99);
      background: rgb(55, 65, 81);
      color: rgb(229, 231, 235);
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;

      &:hover { background: rgb(75, 85, 99); }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorModalComponent {
  @Input() step!: TreeNode;
  @Input() narrative!: ExecutionNarrative | null;
  @Output() close = new EventEmitter<void>();

  // Dropdown section states
  // narrative, timeline, changes open by default; payload, observations collapsed
  readonly sections = signal({
    narrative: true,
    timeline: true,
    changes: true,
    consumers: true,
    payload: false,
    observations: false,
  });

  get subsection(): Subsection | undefined {
    return this.step?.subsectionData;
  }

  toggleSection(key: keyof ReturnType<typeof this.sections>): void {
    this.sections.update(s => ({ ...s, [key]: !s[key] }));
  }

  onClose(): void {
    this.close.emit();
  }

  formatType(type: string): string {
    const typeMap: Record<string, string> = {
      'api': 'API Call',
      'store': 'Store Update',
      'signal': 'Signal',
      'component': 'Component',
      'render': 'Render',
      'computed': 'Computed',
    };
    return typeMap[type] || type;
  }
}
