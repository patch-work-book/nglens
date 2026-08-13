import { Component, ChangeDetectionStrategy, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PanelState } from '../../state/panel.state';
import { DevtoolsPortService } from '../../services/devtools-port.service';

@Component({
  selector: 'app-signals-inspector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="h-full flex flex-col bg-slate-900 text-slate-200">
      <!-- Header -->
      <div class="p-4 border-b border-slate-700 flex justify-between items-center">
        <div>
          <h2 class="text-lg font-semibold text-white">Signal Dependency Graph</h2>
          <p class="text-xs text-slate-400">Visualize reactive chains and detect glitches in real-time.</p>
        </div>
        <div class="flex gap-2">
          <button (click)="refreshGraph()" 
            class="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors">
            Refresh Graph
          </button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="flex-1 overflow-hidden flex">
        <!-- Sidebar: Signal List -->
        <div class="w-64 border-r border-slate-700 overflow-y-auto p-2 bg-slate-900/50">
          <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-2">Active Signals</div>
          @for (s of signalsList(); track s.id) {
            <div (click)="selectedSignal.set(s.id)"
              [class.bg-indigo-500/20]="selectedSignal() === s.id"
              [class.border-indigo-500/50]="selectedSignal() === s.id"
              class="p-2 mb-1 rounded border border-transparent hover:border-slate-600 cursor-pointer transition-all">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full" [class.bg-blue-400]="s.type === 'signal'" [class.bg-purple-400]="s.type === 'computed'"></span>
                <span class="text-xs font-medium truncate">{{ s.label }}</span>
              </div>
              <div class="text-[10px] text-slate-500 truncate ml-4">{{ s.ownerComponent }}</div>
            </div>
          }
        </div>

        <!-- Graph Visualization Area -->
        <div class="flex-1 relative bg-slate-950/30">
          <div class="w-full h-full flex items-center justify-center p-8 overflow-auto">
            @if (!selectedSignal()) {
              <div class="text-slate-500 text-sm flex flex-col items-center gap-2">
                <span class="text-2xl">⚡</span>
                Select a signal to explore its dependency graph
              </div>
            } @else {
              <div class="w-full h-full flex flex-col items-center justify-center gap-8">
                <!-- Visual representation of the graph using CSS/HTML for simplicity -->
                <div class="flex flex-col items-center gap-12 max-w-full">
                   <!-- Producers -->
                   @if (currentSignal()?.producers?.length) {
                     <div class="flex flex-wrap justify-center gap-4">
                       @for (pId of currentSignal()?.producers; track pId) {
                         <div class="px-3 py-2 bg-slate-800 border border-slate-600 rounded shadow-lg text-[10px] max-w-[150px]">
                           <div class="text-slate-500 uppercase font-bold mb-1">Producer</div>
                           <div class="text-white truncate" [title]="pId">{{ pId }}</div>
                         </div>
                       }
                     </div>
                     <div class="h-8 w-px bg-slate-700 relative">
                       <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-slate-700"></div>
                     </div>
                   }
                   
                   <!-- The Node -->
                   <div class="px-6 py-4 bg-indigo-600 border border-indigo-400 rounded-lg shadow-xl text-center min-w-[200px]">
                     <div class="text-xs text-indigo-200 uppercase font-bold mb-1">{{ currentSignal()?.type }}</div>
                     <div class="text-lg font-bold text-white">{{ currentSignal()?.label }}</div>
                     <div class="text-xs text-indigo-100 mt-2 font-mono bg-indigo-900/50 rounded p-1">{{ currentSignal()?.value }}</div>
                   </div>

                   <!-- Consumers -->
                   @if (currentSignal()?.consumers?.length) {
                     <div class="h-8 w-px bg-slate-700 relative">
                       <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-slate-700"></div>
                     </div>
                     <div class="flex flex-wrap justify-center gap-4">
                       @for (cId of currentSignal()?.consumers; track cId) {
                         <div class="px-3 py-2 bg-slate-800 border border-slate-600 rounded shadow-lg text-[10px] max-w-[150px]">
                           <div class="text-slate-500 uppercase font-bold mb-1">Consumer</div>
                           <div class="text-white truncate" [title]="cId">{{ cId }}</div>
                         </div>
                       }
                     </div>
                   }
                </div>
              </div>
            }
          </div>

          <!-- Glitch Warning Badge -->
          @if (detectedGlitches().length > 0) {
            <div class="absolute top-4 right-4 bg-red-500/20 border border-red-500/50 text-red-200 px-3 py-1.5 rounded-full text-[10px] font-bold animate-pulse">
              ⚠️ {{ detectedGlitches().length }} Glitches Detected
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SignalsInspectorComponent {
  private readonly state = inject(PanelState);
  private readonly portService = inject(DevtoolsPortService);

  signalsList = signal<any[]>([]);
  selectedSignal = signal<string | null>(null);
  detectedGlitches = signal<any[]>([]);

  currentSignal = computed(() => {
    const id = this.selectedSignal();
    return this.signalsList().find(s => s.id === id);
  });

  constructor() {
    effect(() => {
      const results = this.state.lastScanResults();
      if (results) {
        const signalResult = results.results.find((r: any) => r.analyzer === 'signals-analyzer');
        if (signalResult?.metadata?.['signalGraph']) {
          const graph = signalResult.metadata['signalGraph'] as any;
          const nodes = Object.values(graph.nodes);
          this.signalsList.set(nodes);
          this.detectedGlitches.set(graph.glitches || []);
        }
      }
    });
  }

  refreshGraph(): void {
    this.portService.send({
      type: 'SCAN_REQUEST',
      payload: { analyzers: ['signals-analyzer'] },
      timestamp: Date.now()
    });
  }
}
