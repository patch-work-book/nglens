import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'overview', pathMatch: 'full' },
  { path: 'overview', loadComponent: () => import('./features/performance-overview/overview.component').then(m => m.OverviewComponent) },
  { path: 'rendering', loadComponent: () => import('./features/rendering-inspector/rendering.component').then(m => m.RenderingComponent) },
  { path: 'profiler', redirectTo: 'rendering', pathMatch: 'full' },
  { path: 'memory', loadComponent: () => import('./features/memory-analyzer/memory.component').then(m => m.MemoryComponent) },
  { path: 'recommendations', loadComponent: () => import('./features/recommendations-engine/recommendations.component').then(m => m.RecommendationsComponent) },
];
