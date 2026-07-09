import { Directive, ElementRef, Input, OnInit, OnDestroy, inject } from '@angular/core';

@Directive({
  selector: '[appTooltip]',
  standalone: true,
})
export class TooltipDirective implements OnInit, OnDestroy {
  @Input() appTooltip: string = '';
  @Input() tooltipMaxWidth: string = '400px';

  private readonly el = inject(ElementRef);
  private tooltipElement: HTMLElement | null = null;
  private isTooltipVisible = false;
  private static tooltipContainer: HTMLElement | null = null;
  private static activeTooltip: TooltipDirective | null = null;
  private clickOutsideListener: ((e: Event) => void) | null = null;

  ngOnInit(): void {
    if (!this.appTooltip) return;

    // Create a shared container for all tooltips (only once)
    if (!TooltipDirective.tooltipContainer) {
      TooltipDirective.tooltipContainer = document.createElement('div');
      TooltipDirective.tooltipContainer.id = 'app-tooltips-container';
      document.body.appendChild(TooltipDirective.tooltipContainer);
    }

    // Create tooltip element
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.style.cssText = `
      position: fixed;
      z-index: 10000;
      background: #1f2937;
      color: #f3f4f6;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 10px;
      max-width: ${this.tooltipMaxWidth};
      white-space: pre-wrap;
      word-break: break-word;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
      border: 1px solid #374151;
      max-height: 250px;
      overflow-y: auto;
      line-height: 1.3;
      font-family: monospace;
      letter-spacing: -0.5px;
      display: none;
    `;
    this.tooltipElement.textContent = this.appTooltip;
    TooltipDirective.tooltipContainer!.appendChild(this.tooltipElement);

    // Click to toggle tooltip
    this.el.nativeElement.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      // Close any other open tooltip first
      if (TooltipDirective.activeTooltip && TooltipDirective.activeTooltip !== this) {
        TooltipDirective.activeTooltip.hideTooltip();
      }
      this.toggleTooltip();
      TooltipDirective.activeTooltip = this.isTooltipVisible ? this : null;
    });
  }

  ngOnDestroy(): void {
    if (this.tooltipElement?.parentNode) {
      this.tooltipElement.parentNode.removeChild(this.tooltipElement);
    }
    if (TooltipDirective.activeTooltip === this) {
      TooltipDirective.activeTooltip = null;
    }
    if (this.clickOutsideListener) {
      document.removeEventListener('click', this.clickOutsideListener);
    }
  }

  private toggleTooltip(): void {
    if (this.isTooltipVisible) {
      this.hideTooltip();
    } else {
      this.showTooltip();
    }
  }

  private showTooltip(): void {
    if (!this.tooltipElement) return;
    this.isTooltipVisible = true;
    this.tooltipElement.style.display = 'block';
    this.positionTooltip();
    
    // Add click outside listener
    this.clickOutsideListener = (e: Event) => {
      const target = e.target as Node;
      if (this.isTooltipVisible && 
          !this.el.nativeElement.contains(target) && 
          !this.tooltipElement?.contains(target)) {
        this.hideTooltip();
      }
    };
    document.addEventListener('click', this.clickOutsideListener);
  }

  private hideTooltip(): void {
    if (this.tooltipElement) {
      this.tooltipElement.style.display = 'none';
      this.isTooltipVisible = false;
    }
    if (this.clickOutsideListener) {
      document.removeEventListener('click', this.clickOutsideListener);
      this.clickOutsideListener = null;
    }
  }

  private positionTooltip(): void {
    if (!this.tooltipElement) return;

    const rect = this.el.nativeElement.getBoundingClientRect();
    let left = rect.right + 8;
    let top = rect.top + rect.height / 2 - 30;

    // Keep within viewport
    if (left + 400 > window.innerWidth) {
      left = rect.left - 408;
    }
    if (top < 0) top = 10;
    if (top + 250 > window.innerHeight) {
      top = window.innerHeight - 260;
    }

    this.tooltipElement.style.left = `${left}px`;
    this.tooltipElement.style.top = `${top}px`;
  }
}
