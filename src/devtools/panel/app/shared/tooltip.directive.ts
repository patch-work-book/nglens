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
      TooltipDirective.tooltipContainer.style.cssText = 'pointer-events: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999;';
      document.body.appendChild(TooltipDirective.tooltipContainer);
    }

    // Remove any title attribute that would show browser default tooltip
    if (this.el.nativeElement.hasAttribute('title')) {
      this.el.nativeElement.removeAttribute('title');
    }

    // Create tooltip element
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.style.cssText = `
      position: fixed;
      z-index: 10000;
      background: #1f2937;
      color: #f3f4f6;
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 10px;
      max-width: ${this.tooltipMaxWidth};
      white-space: pre-wrap;
      word-break: break-word;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 0, 0, 0.8);
      border: 1px solid #4b5563;
      max-height: 250px;
      overflow-y: auto;
      line-height: 1.4;
      font-family: monospace;
      letter-spacing: -0.5px;
      display: none;
      pointer-events: auto;
      cursor: default;
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
    const tooltipWidth = 400; // Match tooltipMaxWidth default
    const tooltipHeight = Math.min(250, this.tooltipElement.scrollHeight);
    const viewportPadding = 10;

    // Default: try to position to the right with vertical centering
    let left = rect.right + 12;
    let top = rect.top + rect.height / 2 - tooltipHeight / 2;

    // If too far right, position to the left
    if (left + tooltipWidth > window.innerWidth - viewportPadding) {
      left = rect.left - tooltipWidth - 12;
    }

    // If still off-screen, center horizontally
    if (left < viewportPadding) {
      left = viewportPadding;
    }

    // Adjust vertical position if too high
    if (top < viewportPadding) {
      top = viewportPadding;
    }

    // Adjust vertical position if too low
    if (top + tooltipHeight > window.innerHeight - viewportPadding) {
      top = window.innerHeight - tooltipHeight - viewportPadding;
    }

    this.tooltipElement.style.left = `${left}px`;
    this.tooltipElement.style.top = `${top}px`;
  }
}
