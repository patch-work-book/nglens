import { Component } from '@angular/core';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <header class="header">
      <h1>ngLens Test: Simple App</h1>
      <p>Baseline render tracking validation</p>
    </header>
  `,
  styles: [`
    .header {
      background: #1976d2;
      color: white;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 4px;
    }
    h1 { margin: 0 0 10px 0; }
    p { margin: 0; font-size: 0.9em; opacity: 0.9; }
  `]
})
export class HeaderComponent {}
