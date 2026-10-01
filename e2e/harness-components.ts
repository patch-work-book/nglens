/**
 * Shared Angular components for the E2E accuracy harness.
 *
 * Used by BOTH the zoneless and zoneful bootstrap entries so the two modes test
 * identical component behavior — only the change-detection strategy differs.
 *
 * Every component calls window.__gtRender(name) on each template render (via a
 * getter read in the template) to capture ground truth.
 */
import { Component, signal, ChangeDetectionStrategy, Input } from '@angular/core';

declare global {
  interface Window {
    __gtRender?: (name: string) => void;
    __ngAppReady?: boolean;
    __ngAppError?: string;
  }
}

function gt(name: string): string {
  window.__gtRender?.(name);
  return '';
}

@Component({
  selector: 'own-trigger-cmp',
  standalone: true,
  template: `<button id="own-btn" (click)="inc()">own {{ n() }}</button><span>{{ marker }}</span>`,
})
export class OwnTriggerComponent {
  n = signal(0);
  get marker() { return gt('OwnTriggerComponent'); }
  inc() { this.n.update(v => v + 1); }
}

@Component({
  selector: 'cascade-child-cmp',
  standalone: true,
  template: `<div>child {{ marker }}</div>`,
})
export class CascadeChildComponent {
  get marker() { return gt('CascadeChildComponent'); }
}

@Component({
  selector: 'parent-cascade-cmp',
  standalone: true,
  imports: [CascadeChildComponent],
  template: `<button id="parent-btn" (click)="bump()">parent {{ n() }}</button>
    <span>{{ marker }}</span><cascade-child-cmp></cascade-child-cmp>`,
})
export class ParentCascadeComponent {
  n = signal(0);
  get marker() { return gt('ParentCascadeComponent'); }
  bump() { this.n.update(v => v + 1); }
}

@Component({
  selector: 'onpush-stable-cmp',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div>onpush {{ data }} {{ marker }}</div>`,
})
export class OnPushStableComponent {
  @Input() data = 'const';
  get marker() { return gt('OnPushStableComponent'); }
}

@Component({
  selector: 'onpush-parent-cmp',
  standalone: true,
  imports: [OnPushStableComponent],
  template: `<button id="onpush-btn" (click)="bump()">onpush-parent {{ n() }}</button>
    <span>{{ marker }}</span><onpush-stable-cmp [data]="stableInput"></onpush-stable-cmp>`,
})
export class OnPushParentComponent {
  n = signal(0);
  stableInput = 'const'; // never changes
  get marker() { return gt('OnPushParentComponent'); }
  bump() { this.n.update(v => v + 1); }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [OwnTriggerComponent, ParentCascadeComponent, OnPushParentComponent],
  template: `
    <own-trigger-cmp></own-trigger-cmp>
    <parent-cascade-cmp></parent-cascade-cmp>
    <onpush-parent-cmp></onpush-parent-cmp>`,
})
export class AppComponent {}
