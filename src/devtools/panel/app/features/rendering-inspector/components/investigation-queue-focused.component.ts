import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface RankedInvestigation {
  rank: number;
  id: string;
  title: string;
  icon: string;
  impact: number;
  potential: number;
  gainScore: number;
  affected: number;
  savings: number;
  confidence: number;
  suggestion?: string;
}

@Component({
  selector: 'app-investigation-queue-focused',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="investigations-container">
      <div class="header">
        <h2>🔍 Ranked Investigations</h2>
        <span class="count">{{ investigations().length }} issues found</span>
      </div>

      <div class="investigations-list">
        @for (inv of investigations(); track inv.id) {
          <div class="investigation-card" 
               [ngClass]="'rank-' + inv.rank"
               (click)="selectInvestigation.emit(inv.id)">
            
            <!-- Rank Badge -->
            <div class="rank-badge">
              @if (inv.rank === 1) {
                🥇
              } @else if (inv.rank === 2) {
                🥈
              } @else if (inv.rank === 3) {
                🥉
              } @else {
                #{{ inv.rank }}
              }
            </div>

            <!-- Main Content -->
            <div class="card-content">
              <!-- Title Row -->
              <div class="card-title">
                <span class="icon">{{ inv.icon }}</span>
                <span class="title">{{ inv.title }}</span>
                <span class="gain-badge">{{ inv.gainScore.toFixed(0) }} pts</span>
              </div>

              <!-- Metrics Row -->
              <div class="metrics-row">
                <div class="metric-chip">
                  <span class="metric-value">{{ inv.impact.toFixed(0) }}</span>
                  <span class="metric-label">Impact</span>
                </div>
                <div class="metric-chip">
                  <span class="metric-value">{{ inv.potential.toFixed(0) }}%</span>
                  <span class="metric-label">Potential</span>
                </div>
                <div class="metric-chip">
                  <span class="metric-value">{{ inv.affected }}</span>
                  <span class="metric-label">Affected</span>
                </div>
                <div class="metric-chip">
                  <span class="metric-value">{{ inv.savings }}ms</span>
                  <span class="metric-label">Savings</span>
                </div>
              </div>

              <!-- Suggestion (if any) -->
              @if (inv.suggestion) {
                <div class="suggestion">
                  💡 {{ inv.suggestion }}
                </div>
              }
            </div>

            <!-- CTA -->
            <div class="cta">
              <span class="confidence">{{ inv.confidence }}%</span>
              <span class="arrow">→</span>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .investigations-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 4px;
      }

      .header h2 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--ri-text-bright);
      }

      .count {
        font-size: 11px;
        color: var(--ri-accent-blue);
        background: color-mix(in srgb, var(--ri-blue) 10%, transparent);
        padding: 2px 6px;
        border-radius: 3px;
      }

      .investigations-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .investigation-card {
        display: grid;
        grid-template-columns: 40px 1fr 50px;
        gap: 12px;
        align-items: center;
        padding: 12px;
        background: linear-gradient(135deg, color-mix(in srgb, var(--ri-blue) 5%, transparent), color-mix(in srgb, var(--ri-bg-raised) 10%, transparent));
        border: 1px solid color-mix(in srgb, var(--ri-blue) 30%, transparent);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .investigation-card:hover {
        background: linear-gradient(135deg, color-mix(in srgb, var(--ri-blue) 10%, transparent), color-mix(in srgb, var(--ri-bg-raised) 15%, transparent));
        border-color: color-mix(in srgb, var(--ri-blue) 50%, transparent);
        transform: translateX(4px);
      }

      .investigation-card.rank-1 {
        border-left: 3px solid var(--ri-accent-red);
        background: linear-gradient(135deg, color-mix(in srgb, var(--ri-red) 5%, transparent), color-mix(in srgb, var(--ri-bg-raised) 10%, transparent));
      }

      .investigation-card.rank-2 {
        border-left: 3px solid var(--ri-accent-amber);
      }

      .investigation-card.rank-3 {
        border-left: 3px solid var(--ri-accent-blue);
      }

      .rank-badge {
        font-size: 24px;
        text-align: center;
        font-weight: 600;
      }

      .card-content {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .card-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 600;
      }

      .icon {
        font-size: 16px;
      }

      .title {
        color: var(--ri-text-bright);
        flex: 1;
      }

      .gain-badge {
        background: linear-gradient(135deg, var(--ri-accent-blue), var(--ri-accent-blue));
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
      }

      .metrics-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .metric-chip {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 4px 6px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
        font-size: 10px;
      }

      .metric-value {
        color: var(--ri-accent-blue);
        font-weight: 600;
        font-size: 11px;
      }

      .metric-label {
        color: var(--ri-text-secondary);
        text-transform: uppercase;
        font-size: 9px;
        letter-spacing: 0.3px;
      }

      .suggestion {
        font-size: 10px;
        color: var(--ri-accent-blue);
        padding: 4px 6px;
        background: color-mix(in srgb, var(--ri-blue) 10%, transparent);
        border-left: 2px solid var(--ri-accent-blue);
        padding-left: 8px;
        border-radius: 2px;
      }

      .cta {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }

      .confidence {
        font-size: 11px;
        font-weight: 600;
        color: var(--ri-accent-blue);
      }

      .arrow {
        font-size: 16px;
        color: var(--ri-accent-blue);
        opacity: 0.6;
      }

      .investigation-card:hover .arrow {
        opacity: 1;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvestigationQueueFocusedComponent {
  investigations = input<RankedInvestigation[]>([]);
  selectInvestigation = output<string>();
}
