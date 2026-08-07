import { Injectable } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { delay } from 'rxjs/operators';

export interface Item {
  id: number;
  name: string;
  category: string;
}

@Injectable({
  providedIn: 'root'
})
export class AppService {
  private itemsSubject = new BehaviorSubject<Item[]>([]);
  items$ = this.itemsSubject.asObservable();

  // Mock data
  private mockItems: Item[] = [
    { id: 1, name: 'Item A', category: 'Category 1' },
    { id: 2, name: 'Item B', category: 'Category 2' },
    { id: 3, name: 'Item C', category: 'Category 1' },
    { id: 4, name: 'Item D', category: 'Category 3' },
    { id: 5, name: 'Item E', category: 'Category 2' },
  ];

  loadItems() {
    // Simulate HTTP request with 500ms delay
    setTimeout(() => {
      this.itemsSubject.next(this.mockItems);
    }, 500);
  }

  filterItems(query: string): Item[] {
    if (!query) return this.mockItems;
    return this.mockItems.filter(item =>
      item.name.toLowerCase().includes(query.toLowerCase()) ||
      item.category.toLowerCase().includes(query.toLowerCase())
    );
  }
}
