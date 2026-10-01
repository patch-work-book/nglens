/**
 * ZONELESS bootstrap entry for the E2E harness.
 * Uses provideZonelessChangeDetection() — no zone.js.
 */
// JIT compiler so Vite (no Angular AOT plugin) can run decorator templates.
import '@angular/compiler';
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './harness-components';

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection()],
})
  .then(() => { window.__ngAppReady = true; })
  .catch((err: unknown) => { window.__ngAppError = String(err); });
