import { Component } from '@angular/core';

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <footer class="footer">
      <p>&copy; 2026 ngLens Test Suite. Simple App Scenario.</p>
    </footer>
  `,
  styles: [`
    .footer {
      background: #f5f5f5;
      padding: 15px;
      text-align: center;
      margin-top: 20px;
      border-top: 1px solid #ddd;
    }
    p { margin: 0; font-size: 0.85em; color: #666; }
  `]
})
export class FooterComponent {}
