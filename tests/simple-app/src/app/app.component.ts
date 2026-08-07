import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeaderComponent } from './header.component';
import { FooterComponent } from './footer.component';
import { ListComponent } from './list.component';
import { DetailComponent } from './detail.component';
import { AppService, Item } from './app.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HeaderComponent, FooterComponent, ListComponent, DetailComponent],
  template: `
    <div class="app">
      <app-header></app-header>
      
      <div class="main-content">
        <div class="controls">
          <button (click)="onLoadItems()">Load Items</button>
          <p class="status" *ngIf="loadingStatus">{{ loadingStatus }}</p>
        </div>

        <div class="container">
          <div class="left">
            <app-list></app-list>
          </div>
          <div class="right">
            <app-detail [selectedItem]="selectedItem"></app-detail>
          </div>
        </div>
      </div>

      <app-footer></app-footer>
    </div>
  `,
  styles: [`
    .app {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 20px;
    }
    .main-content { padding: 20px 0; }
    .controls {
      margin-bottom: 20px;
      padding: 15px;
      background: #f0f0f0;
      border-radius: 4px;
    }
    button {
      padding: 10px 20px;
      background: #1976d2;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1em;
    }
    button:hover { background: #1565c0; }
    .status {
      margin: 10px 0 0 0;
      color: #666;
      font-size: 0.9em;
    }
    .container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 768px) {
      .container { grid-template-columns: 1fr; }
    }
  `]
})
export class AppComponent {
  selectedItem: Item | null = null;
  loadingStatus = '';

  constructor(private appService: AppService) {}

  onLoadItems() {
    this.loadingStatus = 'Loading items...';
    this.appService.loadItems();
    // Simulate completion
    setTimeout(() => {
      this.loadingStatus = 'Items loaded!';
      setTimeout(() => this.loadingStatus = '', 2000);
    }, 500);
  }
}
