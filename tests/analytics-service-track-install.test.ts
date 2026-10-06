import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AnalyticsService } from '../src/services/analytics-service';

// Mock chrome.storage.local
let mockStorage: Record<string, unknown> = {};

const getMock = vi.fn(async (key: string | string[]) => {
  if (typeof key === 'string') {
    return { [key]: mockStorage[key] };
  }
  const result: Record<string, unknown> = {};
  for (const k of key) {
    result[k] = mockStorage[k];
  }
  return result;
});

const setMock = vi.fn(async (items: Record<string, unknown>) => {
  Object.assign(mockStorage, items);
});

Object.defineProperty(globalThis, 'chrome', {
  value: {
    storage: {
      local: {
        get: getMock,
        set: setMock,
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
  },
  writable: true,
  configurable: true,
});

// Mock import.meta.env
vi.stubEnv('VITE_GA4_API_SECRET', 'test-secret');

// Mock fetch
const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

// Construct an AnalyticsService with the release kill-switch forced ON, so the
// retry/backoff/dedup MECHANISM can be exercised. In production the kill-switch
// is OFF (ANALYTICS_ENABLED_IN_RELEASE = false) and nothing is transmitted —
// that default-off behavior is covered by its own test below.
function newEnabledService(): AnalyticsService {
  const svc = new AnalyticsService();
  (svc as unknown as { releaseEnabled: boolean }).releaseEnabled = true;
  return svc;
}

describe('AnalyticsService.trackInstall', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockStorage = {};
    vi.clearAllMocks();
    fetchMock.mockReset();

    // Default: consent granted
    mockStorage['analytics_consent'] = 'granted';

    service = newEnabledService();
  });

  it('is DISABLED by default in this release (kill-switch off → never sends)', async () => {
    // A plain, non-overridden service must send nothing even with consent granted.
    const releaseService = new AnalyticsService();
    const promise = releaseService.trackInstall('1.0.0');
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends extension_installed event when consent is granted', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const promise = service.trackInstall('1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('measurement_id=G-0XE578T3EQ');
    expect(url).toContain('api_secret=test-secret');

    const body = JSON.parse(options.body);
    expect(body.events[0].name).toBe('extension_installed');
    expect(body.events[0].params.extension_version).toBe('1.0.0');
  });

  it('does not send event when consent is denied', async () => {
    mockStorage['analytics_consent'] = 'denied';
    service = newEnabledService();

    const promise = service.trackInstall('1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send event when already tracked', async () => {
    mockStorage['analytics_install_tracked'] = true;

    const promise = service.trackInstall('1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sets analytics_install_tracked flag on success', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const promise = service.trackInstall('1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(setMock).toHaveBeenCalledWith({ analytics_install_tracked: true });
  });

  it('retries up to 2 additional times on failure with exponential backoff', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // attempt 1 fails
      .mockResolvedValueOnce({ ok: false }) // attempt 2 fails
      .mockResolvedValueOnce({ ok: true });  // attempt 3 succeeds

    const promise = service.trackInstall('1.0.0');

    // First attempt happens immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Wait 1000ms for first backoff delay
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Wait 2000ms for second backoff delay
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await promise;

    // Should have set the tracked flag on success
    expect(setMock).toHaveBeenCalledWith({ analytics_install_tracked: true });
  });

  it('discards event silently after all retries exhausted', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false });

    const promise = service.trackInstall('1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Should NOT set the tracked flag
    expect(setMock).not.toHaveBeenCalledWith({ analytics_install_tracked: true });
  });

  it('makes at most 3 total attempts', async () => {
    fetchMock.mockResolvedValue({ ok: false });

    const promise = service.trackInstall('1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry on first success', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const promise = service.trackInstall('1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes extension_version in event params', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const promise = service.trackInstall('2.5.3');
    await vi.runAllTimersAsync();
    await promise;

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.events[0].params).toEqual({ extension_version: '2.5.3' });
  });

  it('handles network errors as failures and retries', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true });

    const promise = service.trackInstall('1.0.0');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setMock).toHaveBeenCalledWith({ analytics_install_tracked: true });
  });
});
