import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PanelState } from '../../state/panel.state';
import { CommandService } from '../../services/command.service';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="h-12 flex items-center px-3 bg-gray-800 border-b border-gray-700 gap-2">
      <!-- Logo -->
      <span class="text-sm font-semibold text-gray-100 mr-4">ngLens</span>

      <!-- Navigation tabs -->
      <nav class="flex gap-1">
        <a routerLink="/overview"
           routerLinkActive="bg-gray-700 text-white"
           class="px-3 py-1.5 text-xs text-gray-400 rounded hover:text-gray-200 transition-colors">
          Overview
        </a>
        <a routerLink="/rendering"
           routerLinkActive="bg-gray-700 text-white"
           class="px-3 py-1.5 text-xs text-gray-400 rounded hover:text-gray-200 transition-colors">
          Render Inspector
        </a>
        <a routerLink="/memory"
           routerLinkActive="bg-gray-700 text-white"
           class="px-3 py-1.5 text-xs text-gray-400 rounded hover:text-gray-200 transition-colors">
          Memory
        </a>
        <a routerLink="/recommendations"
           routerLinkActive="bg-gray-700 text-white"
           class="px-3 py-1.5 text-xs text-gray-400 rounded hover:text-gray-200 transition-colors">
          Recommendations
        </a>
      </nav>

      <!-- Frame Selector option -->
      <div class="ml-4 flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded px-2 py-0.5">
        <span class="text-[10px] text-gray-500 uppercase font-semibold select-none">Target:</span>
        <select
          [value]="selectedFrameId()"
          (change)="onFrameChange($event)"
          class="bg-transparent text-xs text-gray-200 border-0 outline-none cursor-pointer focus:ring-0 max-w-48 truncate py-0.5"
        >
          @for (frame of frames(); track frame.id) {
            <option [value]="frame.id" class="bg-gray-800 text-gray-200">
              {{ frame.isTop ? 'Top Window' : getUrlHost(frame.url) }}
            </option>
          }
        </select>
      </div>

      <!-- Options/Filters -->
      <div class="flex items-center gap-1 bg-gray-900 border border-gray-700 rounded px-2 py-0.5">
        <label class="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400 select-none">
          <input
            type="checkbox"
            [checked]="clearOnRouteChange()"
            (change)="toggleClearOnRoute()"
            class="rounded bg-gray-800 border-gray-700 text-blue-500 focus:ring-0 focus:ring-offset-0 w-3 h-3"
          />
          Clear on Route Change
        </label>
      </div>

      <!-- Spacer -->
      <div class="flex-1"></div>

      <!-- Action buttons -->
      <button
        (click)="toggleTracking()"
        class="px-2 py-1 text-xs rounded border transition-colors"
        [class]="isTracking() ? 'border-red-500 text-red-400 hover:bg-red-500/10' : 'border-green-500 text-green-400 hover:bg-green-500/10'">
        {{ isTracking() ? 'Stop' : 'Start' }}
      </button>
      <button
        (click)="clearData()"
        class="px-2 py-1 text-xs rounded border border-gray-600 text-gray-400 hover:bg-gray-700 transition-colors">
        Clear
      </button>

      <!-- Connection status indicator -->
      <span
        class="w-2 h-2 rounded-full"
        [class]="connectionDotClass()"
        [title]="connectionState()">
      </span>

      <!-- Degraded mode badge -->
      @if (degradedMode()) {
        <span class="text-xs text-amber-400 font-medium">Degraded</span>
      }
      @if (criticalPollutionCount() > 0) {
        <span class="text-xs text-red-400 font-medium animate-pulse">⚡ {{ criticalPollutionCount() }} Zone</span>
      }
      @if (trackingError()) {
        <span class="text-xs text-red-400 font-medium truncate max-w-64" [title]="trackingError()!">
          {{ trackingError() }}
        </span>
      }
    </div>
  `,
})
export class ToolbarComponent {
  private readonly state = inject(PanelState);
  private readonly commandService = inject(CommandService);

  readonly isTracking = this.state.isTracking;
  readonly degradedMode = this.state.degradedMode;
  readonly connectionState = this.state.connectionState;
  readonly clearOnRouteChange = this.state.clearOnRouteChange;
  readonly trackingError = this.state.trackingError;
  readonly criticalPollutionCount = this.state.criticalPollutionCount;
  readonly frames = this.state.frames;
  readonly selectedFrameId = this.state.selectedFrameId;

  readonly connectionDotClass = computed(() => {
    switch (this.state.connectionState()) {
      case 'connected':
        return 'bg-green-500';
      case 'disconnected':
        return 'bg-red-500';
      case 'reconnecting':
        return 'bg-amber-500';
    }
  });

  getUrlHost(url: string): string {
    if (!url || url === 'Top Window') return 'Top Window';
    try {
      const parsed = new URL(url);
      return `Iframe: ${parsed.host}${parsed.pathname}`;
    } catch {
      return `Iframe: ${url}`;
    }
  }

  onFrameChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.state.selectedFrameId.set(Number(select.value));
  }

  toggleTracking(): void {
    const currentlyTracking = this.state.isTracking();
    if (currentlyTracking) {
      this.commandService.stopTracking();
      this.state.isTracking.set(false);
    } else {
      this.state.trackingError.set(null);
      this.commandService.startTracking();
      this.state.isTracking.set(true);
    }
  }

  toggleClearOnRoute(): void {
    this.state.clearOnRouteChange.update(v => !v);
  }

  clearData(): void {
    this.commandService.clearData();
    this.state.clearActivity();
  }
}
