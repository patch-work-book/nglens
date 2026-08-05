import { Component, inject, signal, effect } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { ToolbarComponent } from './layout/toolbar/toolbar.component';
import { WhyPanelComponent } from './layout/why-panel/why-panel.component';
import { DevtoolsPortService } from './services/devtools-port.service';
import { ThemeService } from './services/theme.service';
import { PanelState } from './state/panel.state';
import { displayName } from './utils/display-name';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  imports: [RouterOutlet, ToolbarComponent, WhyPanelComponent],
})
export class AppComponent {
  private readonly portService = inject(DevtoolsPortService);
  private readonly state = inject(PanelState);
  private readonly router = inject(Router);
  readonly themeService = inject(ThemeService);

  readonly selectedComponent = this.state.selectedComponent;
  readonly whyPanelExpanded = signal(false);
  readonly getDisplayName = displayName;

  constructor() {
    this.portService.connect();

    effect(() => {
      this.whyPanelExpanded.set(Boolean(this.state.selectedComponent()));
    });
  }

  toggleWhyPanel(): void {
    this.whyPanelExpanded.update(v => !v);
  }

  isRenderInspectorRoute(): boolean {
    return this.router.url.includes('/rendering');
  }
}
