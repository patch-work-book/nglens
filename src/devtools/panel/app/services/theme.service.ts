import { Injectable, signal, effect } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly isDarkMode = signal(this.getInitialTheme());

  constructor() {
    effect(() => {
      const isDark = this.isDarkMode();
      const htmlEl = document.documentElement;
      htmlEl.setAttribute('data-theme', isDark ? 'dark' : 'light');
      htmlEl.style.colorScheme = isDark ? 'dark' : 'light';
      localStorage.setItem('nglens-theme', isDark ? 'dark' : 'light');
    });
  }

  toggleTheme(): void {
    this.isDarkMode.set(!this.isDarkMode());
  }

  setTheme(isDark: boolean): void {
    this.isDarkMode.set(isDark);
  }

  private getInitialTheme(): boolean {
    const saved = localStorage.getItem('nglens-theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;

    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true;
    }

    return true; // Default to dark
  }
}
