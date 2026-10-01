import { Injectable, inject } from '@angular/core';
import { PanelState } from '../state/panel.state';
import { EventDispatcherService } from './event-dispatcher.service';
import type { PortMessage } from '../../../../types/port-messages';

@Injectable({ providedIn: 'root' })
export class DevtoolsPortService {
  private port: chrome.runtime.Port | null = null;
  private readonly state = inject(PanelState);
  private readonly dispatcher = inject(EventDispatcherService);
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  connect(): void {
    try {
      this.port = chrome.runtime.connect({ name: 'ngLens-panel' });
    } catch (err) {
      // Extension context invalidated (extension was reloaded)
      this.state.connectionState.set('disconnected');
      return;
    }

    this.port.postMessage({
      type: 'INIT',
      tabId: chrome.devtools.inspectedWindow.tabId,
      timestamp: Date.now(),
    });

    this.state.connectionState.set('connected');
    this.reconnectAttempts = 0;

    // Direct auto start check on connect/load
    try {
      chrome.storage.local.get('auto_start_scan', (result) => {
        if (result && result['auto_start_scan'] === true) {
          this.state.setTracking(true);
          // Use short delay to ensure message queue is ready
          setTimeout(() => {
            this.send({
              type: 'START_TRACKING',
              payload: null,
              timestamp: Date.now(),
            });
          }, 50);
        }
      });
    } catch { /* ignore outside extension context */ }

    this.port.onMessage.addListener((msg: PortMessage) => {
      this.dispatcher.dispatch(msg);
    });

    this.port.onDisconnect.addListener(() => {
      this.port = null;
      this.state.connectionState.set('disconnected');

      // Check if the disconnect was due to extension context being invalidated
      if (chrome.runtime.lastError?.message?.includes('invalidated')) {
        // Extension was reloaded — stop trying to reconnect
        return;
      }

      this.scheduleReconnect();
    });
  }

  send(message: PortMessage): void {
    try {
      if (!this.port) {
        console.warn('[ngLens] Port not connected, attempting reconnect before sending:', message.type);
        // Try to reconnect if port is null
        this.connect();
        // Schedule retry after a brief delay - longer for critical messages
        const delay = message.type === 'START_TRACKING' ? 300 : 100;
        setTimeout(() => {
          if (this.port) {
            this.port.postMessage(message);
          } else {
            console.warn('[ngLens] Port still not available after reconnect attempt, queuing message');
          }
        }, delay);
        return;
      }
      this.port.postMessage(message);
    } catch (err) {
      // Port may be disconnected or context invalidated
      console.warn('[ngLens] Failed to send message:', err);
      this.state.connectionState.set('disconnected');
      // Retry connection
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      // Give up after max attempts
      return;
    }
    this.reconnectAttempts++;
    this.state.connectionState.set('reconnecting');
    setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
  }
}
