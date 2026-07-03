import { Injectable, inject } from '@angular/core';
import { DevtoolsPortService } from './devtools-port.service';
import { PanelState } from '../state/panel.state';
import type { PortMessage } from '../../../../types/port-messages';

@Injectable({ providedIn: 'root' })
export class CommandService {
  private readonly portService = inject(DevtoolsPortService);
  private readonly state = inject(PanelState);

  startTracking(): void {
    this.send({ type: 'START_TRACKING', payload: null, timestamp: Date.now() });
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

  private send(message: PortMessage): void {
    this.portService.send(message);
  }
}
