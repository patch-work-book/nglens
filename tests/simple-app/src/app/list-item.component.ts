import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Item } from './app.service';

@Component({
  selector: 'app-list-item',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="list-item">
      <h4>{{ item.name }}</h4>
      <p>Category: {{ item.category }}</p>
    </div>
  `,
  styles: [`
    .list-item {
      padding: 10px;
      border: 1px solid #ddd;
      margin-bottom: 5px;
      border-radius: 4px;
      background: #f9f9f9;
    }
    h4 { margin: 0 0 5px 0; }
    p { margin: 0; font-size: 0.9em; color: #666; }
  `]
})
export class ListItemComponent {
  @Input() item!: Item;
}
