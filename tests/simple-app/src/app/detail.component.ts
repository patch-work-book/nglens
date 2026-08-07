import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Item } from './app.service';

@Component({
  selector: 'app-detail',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="detail-container" *ngIf="selectedItem">
      <h3>Details</h3>
      <div class="detail-info">
        <p><strong>ID:</strong> {{ selectedItem.id }}</p>
        <p><strong>Name:</strong> {{ selectedItem.name }}</p>
        <p><strong>Category:</strong> {{ selectedItem.category }}</p>
      </div>
    </div>
    <div class="detail-container" *ngIf="!selectedItem">
      <p class="placeholder">Select an item to see details</p>
    </div>
  `,
  styles: [`
    .detail-container {
      padding: 15px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      margin: 10px 0;
      background: #fafafa;
    }
    h3 { margin-top: 0; }
    .detail-info p { margin: 8px 0; }
    .placeholder { color: #999; font-style: italic; }
  `]
})
export class DetailComponent {
  @Input() selectedItem: Item | null = null;
}
