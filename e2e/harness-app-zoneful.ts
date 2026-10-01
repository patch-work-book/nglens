/**
 * ZONEFUL bootstrap entry for the E2E harness.
 * Imports zone.js and uses default (Zone-based) change detection — the path
 * most production Angular apps use and the one ngLens's Zone hook targets.
 */
// zone.js MUST be imported before Angular core for the patches to apply.
import 'zone.js';
// JIT compiler so Vite (no Angular AOT plugin) can run decorator templates.
import '@angular/compiler';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './harness-components';

bootstrapApplication(AppComponent)
  .then(() => { window.__ngAppReady = true; })
  .catch((err: unknown) => { window.__ngAppError = String(err); });
