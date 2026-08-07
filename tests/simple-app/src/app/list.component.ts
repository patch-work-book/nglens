import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppService, Item } from './app.service';
import { ListItemComponent } from './list-item.component';

@Component({
  selector: 'app-list',
  standalone: true,
  imports: [CommonModule, FormsModule, ListItemComponent],
  template: `
    <div class="list-container">
      <h3>Items</h3>
      <input
        type="text"
        placeholder="Filter items..."
        [(ngModel)]="filterQuery"
        (keyup)="onFilter()"
      />
      <div class="items">
        <app-list-item
          *ngFor="let item of filteredItems; trackBy: trackByItemId"
          [item]="item"
        ></app-list-item>
      </div>
    </div>
  `,
  styles: [`
    .list-container {
      padding: 15px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      margin: 10px 0;
    }
    h3 { margin-top: 0; }
    input {
      width: 100%;
      padding: 8px;
      margin-bottom: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    .items { max-height: 300px; overflow-y: auto; }
  `]
})
export class ListComponent implements OnInit {
  filterQuery = '';
  items: Item[] = [];
  filteredItems: Item[] = [];

  constructor(private appService: AppService) {}

  ngOnInit() {
    this.appService.items$.subscribe(items => {
      this.items = items;
      this.onFilter();
    });
  }

  onFilter() {
    this.filteredItems = this.appService.filterItems(this.filterQuery);
  }

  trackByItemId(index: number, item: Item): number {
    return item.id;
  }
}
