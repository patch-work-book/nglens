/**
 * Sessions Panel Component (REDESIGNED - Intent-Focused)
 * 
 * New design: Shows business domain + rollup metrics instead of raw event counts.
 * 
 * Display per session:
 * 🟢 Dashboard Bootstrap
 * 986ms │ 6 APIs │ 18 Comp │ 96 Renders │ Score: 90
 * 
 * Input: Array of ExecutionSessions (paired with ExecutionNarratives via parent)
 * Output: (sessionSelected) event when user clicks a session
 */

import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ExecutionSession } from '../../../../../types/execution-intelligence';
import type { ExecutionNarrative } from '../../../../../types/execution-narrative';

@Component({
  selector: 'app-sessions-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="h-full flex flex-col bg-gray-900 text-2xs overflow-hidden">
      <!-- Ultra-compact header -->
      <div class="px-2 py-0.5 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <span class="font-semibold text-gray-100">📋 Sessions</span>
      </div>

      <!-- Sessions list -->
      <div class="flex-1 overflow-y-auto overflow-x-hidden">
        @for (session of sessions; track session.id) {
          <div
            class="px-2 py-1 border-b border-gray-700 cursor-pointer hover:bg-gray-800 transition-colors"
            [class.bg-blue-900/20]="selectedSessionId === session.id"
            (click)="onSessionClick(session)"
          >
            <!-- Row 1: Business Domain + Duration (Intent-Focused) -->
            <div class="flex items-center gap-2 mb-0.5">
              <!-- Status indicator + Domain name -->
              <span class="text-xs font-semibold text-gray-100">
                {{ session.boundary === 'component-bootstrap' ? '🟢' : '🟡' }}
                {{ formatBusinessDomain(session) }}
              </span>
              
              <!-- Duration (right-aligned) -->
              <span class="text-gray-400 ml-auto flex-shrink-0">{{ session.duration }}ms</span>
            </div>

            <!-- Row 2: Rollup Metrics (Compact) -->
            <div class="flex items-center gap-2 text-2xs text-gray-400 overflow-hidden">
              @if (session.apiCallCount > 0) {
                <span class="flex-shrink-0">🌐 {{ session.apiCallCount }}</span>
              }
              @if (session.componentCount > 0) {
                <span class="flex-shrink-0">📦 {{ session.componentCount }}</span>
              }
              @if (session.renderCount > 0) {
                <span class="flex-shrink-0">✨ {{ session.renderCount }}</span>
              }
              
              <!-- Score (rightmost) -->
              <span 
                [class]="getScoreClass(session)" 
                class="ml-auto flex-shrink-0 px-1 py-0 rounded text-2xs"
              >
                @if (narrativeMap.get(session.id); as narrative) {
                  {{ narrative.executionScore.score }}
                } @else {
                  —
                }
              </span>
            </div>
          </div>
        }

        @if (sessions.length === 0) {
          <div class="p-2 text-center text-gray-500 text-2xs">
            No sessions yet
          </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsPanelComponent {
  @Input() sessions: ExecutionSession[] = [];
  @Input() selectedSessionId: string | null = null;
  @Input() narrativeMap: Map<string, ExecutionNarrative> = new Map();

  @Output() sessionSelected = new EventEmitter<ExecutionSession>();

  onSessionClick(session: ExecutionSession): void {
    this.sessionSelected.emit(session);
  }

  /**
   * Format session as business domain instead of raw event count.
   * Examples: "Dashboard Bootstrap", "Search Results", "User Profile Updated"
   */
  formatBusinessDomain(session: ExecutionSession): string {
    // Get narrative if available
    const narrative = this.narrativeMap.get(session.id);
    if (narrative) {
      return narrative.title;
    }

    // Fallback to formatted boundary
    const map: Record<string, string> = {
      'user-interaction': 'User Action',
      'route-navigation': 'Route Navigation',
      'component-bootstrap': 'Component Bootstrap',
      'timer': 'Timer Event',
      'websocket': 'WebSocket Event',
      'background-task': 'Background Task',
      'manual-refresh': 'Manual Refresh',
    };
    return map[session.boundary] || 'Execution';
  }

  getScoreClass(session: ExecutionSession): string {
    const narrative = this.narrativeMap.get(session.id);
    if (!narrative) {
      return 'bg-gray-700 text-gray-300';
    }

    const status = narrative.executionScore.status;
    switch (status) {
      case 'good':
        return 'bg-green-900/50 text-green-300 font-semibold';
      case 'warning':
        return 'bg-yellow-900/50 text-yellow-300 font-semibold';
      case 'critical':
        return 'bg-red-900/50 text-red-300 font-semibold';
      default:
        return 'bg-gray-700 text-gray-300';
    }
  }
}
