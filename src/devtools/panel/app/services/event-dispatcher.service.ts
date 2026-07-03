import { Injectable, Injector, inject } from '@angular/core';
import { PanelState } from '../state/panel.state';
import { DevtoolsPortService } from './devtools-port.service';
import type { PortMessage } from '../../../../types/port-messages';
import type { RenderEvent, FlowEvent } from '../../../../types/render-events';
import type { LeakEvent } from '../../../../types/leak-events';
import type { TrackByIssue, OnPushScore } from '../../../../types/recommendation-events';
import type { ZonePollutionEvent } from '../../../../types/zone-pollution-events';

@Injectable({ providedIn: 'root' })
export class EventDispatcherService {
  private readonly state = inject(PanelState);
  private readonly injector = inject(Injector);

  private _portService: DevtoolsPortService | null = null;

  private get portService(): DevtoolsPortService | null {
    if (!this._portService) {
      try {
        this._portService = this.injector.get(DevtoolsPortService);
      } catch {
        return null;
      }
    }
    return this._portService;
  }

  dispatch(message: PortMessage): void {
    const frameId = message.frameId ?? 0;
    const frameUrl = message.frameUrl ?? '';

    if (frameId !== 0 && frameUrl) {
      this.state.registerFrame(frameId, frameUrl, false);
    }

    switch (message.type) {
      case 'FRAME_LOADED': {
        const payload = message.payload as { url: string; isTop: boolean };
        this.state.registerFrame(frameId, payload.url, payload.isTop);
        break;
      }
      case 'EVENT_BATCH':
        this.handleEventBatch(message.payload as { events: RenderEvent[] }, frameId);
        break;
      case 'LEAK_EVENT':
        this.handleLeakEvent(message.payload as LeakEvent, frameId);
        break;
      case 'TRACKBY_ISSUE':
        this.handleTrackByIssue(message.payload as TrackByIssue, frameId);
        break;
      case 'ONPUSH_RESULT':
        this.handleOnPushResult(message.payload as OnPushScore, frameId);
        break;
      case 'ZONE_POLLUTION_EVENT':
        this.handleZonePollutionEvent(message.payload as ZonePollutionEvent, frameId);
        break;
      case 'FLOW_EVENT_BATCH':
        this.handleFlowEventBatch(message.payload as { events: FlowEvent[] }, frameId);
        break;
      case 'DEGRADED_MODE':
        this.state.degradedMode.set(true);
        break;
      case 'TRACKING_STARTED':
        this.state.trackingError.set(null);
        this.state.isTracking.set(true);
        break;
      case 'TRACKING_STOPPED':
        this.state.isTracking.set(false);
        break;
      case 'ERROR':
        this.handleError(message.payload as { message?: string; error?: string });
        break;
      case 'ROUTE_CHANGED':
        this.handleRouteChanged(message.payload as { timestamp: number }, frameId);
        break;
      case 'TAB_NAVIGATED':
        this.handleTabNavigated();
        break;
      case 'CONNECTION_ACK':
        this.state.connectionState.set('connected');
        break;
    }
  }

  private handleTabNavigated(): void {
    const shouldResumeTracking = this.state.isTracking();

    this.state.clearAll();
    // clearAll() resets connectionState to 'disconnected', restore it
    this.state.connectionState.set('connected');

    if (shouldResumeTracking) {
      this.state.isTracking.set(true);
      this.portService?.send({
        type: 'START_TRACKING',
        payload: null,
        timestamp: Date.now(),
      });
    } else {
      // Check if auto-start scan is enabled on navigation load
      try {
        chrome.storage.local.get('auto_start_scan', (result) => {
          if (result && result['auto_start_scan'] === true) {
            this.state.isTracking.set(true);
            this.portService?.send({
              type: 'START_TRACKING',
              payload: null,
              timestamp: Date.now(),
            });
          }
        });
      } catch { /* ignore */ }
    }
  }

  private handleEventBatch(payload: { events: RenderEvent[] }, frameId: number): void {
    this.state.addRenderEvents(payload.events, frameId);
  }

  private handleLeakEvent(payload: LeakEvent, frameId: number): void {
    this.state.addLeakEvent(payload, frameId);
  }

  private handleTrackByIssue(payload: TrackByIssue, frameId: number): void {
    this.state.addTrackByIssue(payload, frameId);
  }

  private handleOnPushResult(payload: OnPushScore, frameId: number): void {
    this.state.addOnPushResult(payload, frameId);
  }

  private handleError(payload: { message?: string; error?: string }): void {
    const message = payload.message ?? payload.error ?? '';
    // Non-fatal errors: overlay element not found, etc. — don't stop tracking.
    if (message.startsWith('Element not found')) return;

    this.state.setTrackingError(
      message || 'ngLens could not start tracking this page.'
    );
  }

  private handleZonePollutionEvent(payload: ZonePollutionEvent, frameId: number): void {
    this.state.setZonePollutionSources(payload.sources, frameId);
  }

  private handleFlowEventBatch(payload: { events: FlowEvent[] }, frameId: number): void {
    this.state.addFlowEvents(payload.events, frameId);
  }

  private handleRouteChanged(payload: { timestamp: number; url?: string }, frameId: number): void {
    // Add a flow event for the route change so it appears in the Render Inspector timeline
    this.state.addFlowEvents([{
      id: `route-${Date.now()}`,
      type: 'route-change' as const,
      timestamp: Date.now(),
      label: `Route changed: ${payload.url ?? 'Navigation detected'}`,
      detail: 'Navigation detected via router-outlet',
      toRoute: payload.url,
    }], frameId);

    // Optionally clear activity on route change
    if (this.state.clearOnRouteChange()) {
      this.state.clearActivity();
    }
  }
}
