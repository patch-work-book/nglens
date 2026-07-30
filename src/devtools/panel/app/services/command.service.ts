import { Injectable, inject } from '@angular/core';
import { DevtoolsPortService } from './devtools-port.service';
import { PanelState } from '../state/panel.state';
import type { PortMessage } from '../../../../types/port-messages';

@Injectable({ providedIn: 'root' })
export class CommandService {
  private readonly portService = inject(DevtoolsPortService);
  private readonly state = inject(PanelState);

  startTracking(): void {
    this.sendWithRetry({ type: 'START_TRACKING', payload: null, timestamp: Date.now() });
  }

  stopTracking(): void {
    this.send({ type: 'STOP_TRACKING', payload: null, timestamp: Date.now() });
  }

  selectComponent(name: string): void {
    this.send({
      type: 'SELECT_COMPONENT',
      payload: { name },
      timestamp: Date.now(),
      frameId: this.state.selectedFrameId(),
    });
  }

  clearData(): void {
    this.send({ type: 'CLEAR_DATA', payload: null, timestamp: Date.now() });
  }

  /** Send with retry for critical commands like START_TRACKING */
  private sendWithRetry(message: PortMessage, attempts = 0): void {
    // Check both connectionState AND actual port connectivity
    const portService = this.portService;
    const isReady = this.state.connectionState() === 'connected' && portService;
    
    if (!isReady) {
      if (attempts < 5) {
        // Retry after 200ms if not fully ready yet
        setTimeout(() => {
          this.sendWithRetry(message, attempts + 1);
        }, 200);
        return;
      }
      // After 5 attempts (1 second total), try one more time
      console.warn('[ngLens] START_TRACKING retry timeout, attempting final send');
    }
    
    this.send(message);
  }

  private send(message: PortMessage): void {
    this.portService.send(message);
  }
}
