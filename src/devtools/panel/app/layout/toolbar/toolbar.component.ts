import { Component, computed, inject, ChangeDetectionStrategy, signal, effect } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { PanelState } from '../../state/panel.state';
import { CommandService } from '../../services/command.service';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  private readonly state = inject(PanelState);
  private readonly commandService = inject(CommandService);
  readonly router = inject(Router);
  readonly activeRoute = signal<string>('overview');

  constructor() {
    effect(() => {
      // Track route changes to update activeRoute signal
      const urlSegments = this.router.url.split('/').filter(s => s);
      if (urlSegments.length > 0) {
        this.activeRoute.set(urlSegments[0]);
      }
    });
  }

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

  /**
   * Navigate only if not already on that route.
   * Prevents component re-instantiation and duplicate data when clicking same tab.
   */
  navigateTo(route: string): void {
    if (this.activeRoute() !== route) {
      this.activeRoute.set(route);
      this.router.navigate([route]);
    }
  }
}
