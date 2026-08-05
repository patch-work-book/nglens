/**
 * Metrics Help Component
 * 
 * Modal/overlay showing plain-English explanations for ngLens metrics.
 * Designed for entry-level Angular developers.
 * 
 * Shows:
 * - What each metric means
 * - Why you should care
 * - Real examples
 * - What good/bad looks like
 */

import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MetricsGlossaryService } from '../../services/metrics-glossary.service';

@Component({
  selector: 'app-metrics-help',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <!-- Modal -->
      <div class="bg-gray-900 rounded-lg border border-gray-700 max-w-2xl max-h-96 overflow-auto text-sm">
        <!-- Header -->
        <div class="sticky top-0 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
          <h2 class="text-base font-semibold text-gray-100">📖 ngLens Metrics Explained</h2>
          <button 
            class="text-gray-400 hover:text-gray-200"
            (click)="close()"
          >
            ✕
          </button>
        </div>

        <!-- Content -->
        <div class="p-4 space-y-4 text-gray-300">
          <!-- Introduction -->
          <div class="bg-blue-900/20 rounded p-3 border-l-2 border-blue-500">
            <p class="text-sm font-semibold text-blue-300 mb-1">New to ngLens?</p>
            <p class="text-2xs text-gray-300 leading-relaxed">
              ngLens breaks down everything your Angular app does into understandable pieces. 
              Below is a plain-English guide to help you understand the metrics.
            </p>
          </div>

          <!-- Metrics Grid -->
          <div class="space-y-3">
            @for (metric of metrics; track metric.name) {
              <div class="bg-gray-800 rounded p-3 border-l-2 border-gray-600 hover:border-gray-500 transition-colors">
                <!-- Header: Icon + Name + Short Text -->
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-lg flex-shrink-0">{{ metric.icon }}</span>
                  <div class="flex-1">
                    <div class="font-semibold text-gray-100">{{ metric.name }}</div>
                    <div class="text-gray-500 text-2xs">{{ metric.shortText }}</div>
                  </div>
                </div>

                <!-- Content -->
                <div class="ml-6 space-y-2 text-2xs">
                  <!-- Long explanation -->
                  <div>
                    <span class="text-gray-400">What it is:</span>
                    <div class="text-gray-300 ml-3 mt-0.5">{{ metric.longText }}</div>
                  </div>

                  <!-- Example -->
                  <div>
                    <span class="text-gray-400">Example:</span>
                    <div class="text-gray-300 ml-3 mt-0.5 font-mono bg-gray-900 p-2 rounded border border-gray-700">
                      {{ metric.example }}
                    </div>
                  </div>

                  <!-- What it means -->
                  <div>
                    <span class="text-gray-400">What it means:</span>
                    <div class="text-gray-300 ml-3 mt-0.5">{{ metric.whatItMeans }}</div>
                  </div>

                  <!-- Why it matters -->
                  <div>
                    <span class="text-amber-400">Why it matters:</span>
                    <div class="text-amber-200 ml-3 mt-0.5">{{ metric.whyItMatters }}</div>
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Tips Section -->
          <div class="bg-green-900/20 rounded p-3 border-l-2 border-green-500 mt-4">
            <p class="text-sm font-semibold text-green-300 mb-2">💡 Quick Tips</p>
            <ul class="space-y-1 text-2xs text-gray-300">
              <li>🎯 Focus on <strong>API calls first</strong> - they're usually the bottleneck</li>
              <li>⚡ Too many <strong>signals/renders</strong> = optimization opportunity</li>
              <li>📊 If <strong>score &lt; 50</strong>, something is definitely slow</li>
              <li>🔗 Read the <strong>causality chain</strong> to understand the flow</li>
              <li>⚠️ Click on <strong>Insights</strong> for specific suggestions</li>
            </ul>
          </div>

          <!-- Common Issues -->
          <div class="bg-red-900/20 rounded p-3 border-l-2 border-red-500">
            <p class="text-sm font-semibold text-red-300 mb-2">🔴 Common Issues</p>
            <ul class="space-y-1 text-2xs text-gray-300">
              <li>❌ <strong>Many API calls:</strong> Loading same data multiple times? Use caching</li>
              <li>❌ <strong>Slow API response:</strong> Backend is slow. Ask your BE team</li>
              <li>❌ <strong>Many re-renders:</strong> Using OnPush? Using trackBy in *ngFor?</li>
              <li>❌ <strong>Memory increasing:</strong> Possible memory leak. Check subscriptions</li>
            </ul>
          </div>
        </div>

        <!-- Footer -->
        <div class="bg-gray-800 border-t border-gray-700 px-4 py-2 flex justify-end gap-2">
          <button 
            class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm"
            (click)="close()"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsHelpComponent {
  private glossary = inject(MetricsGlossaryService);

  metrics = this.glossary.getAllMetrics();

  close(): void {
    // Emit close event or navigate back
    // For now, just log
    console.log('Close metrics help');
  }
}
