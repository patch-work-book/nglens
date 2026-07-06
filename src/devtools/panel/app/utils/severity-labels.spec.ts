import { describe, it, expect } from 'vitest';
import { getSeverityLabels, getLabelClass, type SeverityLabel } from './severity-labels';
import type { ComponentStats } from '../../../../types/panel';

function makeStats(overrides: Partial<ComponentStats> = {}): ComponentStats {
  return {
    componentName: 'TestComponent',
    renderCount: 10,
    renderFrequency: 50,
    averageDuration: 5,
    totalDuration: 50,
    causesBreakdown: { signal: 0, input: 0, zone: 0, parent: 0, 'manual-cd': 0 },
    firstSeen: 0,
    lastSeen: 60000,
    ...overrides,
  };
}

describe('getSeverityLabels', () => {
  it('returns empty array when no thresholds are met', () => {
    const stats = makeStats({ renderFrequency: 50 });
    expect(getSeverityLabels(stats)).toEqual([]);
  });

  it('returns HOT when renderFrequency is between 61 and 100', () => {
    const stats = makeStats({ renderFrequency: 75 });
    expect(getSeverityLabels(stats)).toEqual(['HOT']);
  });

  it('returns HOT at boundary (61 renders per minute)', () => {
    const stats = makeStats({ renderFrequency: 61 });
    expect(getSeverityLabels(stats)).toContain('HOT');
  });

  it('does not return HOT at exactly 60 renders per minute', () => {
    const stats = makeStats({ renderFrequency: 60 });
    expect(getSeverityLabels(stats)).not.toContain('HOT');
  });

  it('returns EXCESSIVE when renderFrequency exceeds 100', () => {
    const stats = makeStats({ renderFrequency: 150 });
    expect(getSeverityLabels(stats)).toEqual(['EXCESSIVE']);
  });

  it('returns EXCESSIVE at boundary (101 renders per minute)', () => {
    const stats = makeStats({ renderFrequency: 101 });
    expect(getSeverityLabels(stats)).toContain('EXCESSIVE');
  });

  it('does not return EXCESSIVE at exactly 100 renders per minute', () => {
    const stats = makeStats({ renderFrequency: 100 });
    expect(getSeverityLabels(stats)).not.toContain('EXCESSIVE');
    expect(getSeverityLabels(stats)).toContain('HOT');
  });

  it('returns CASCADE when parent causes exceed 50% of total', () => {
    const stats = makeStats({
      causesBreakdown: { signal: 1, input: 1, zone: 1, parent: 10, 'manual-cd': 1 },
    });
    expect(getSeverityLabels(stats)).toContain('CASCADE');
  });

  it('does not return CASCADE when parent causes are exactly 50%', () => {
    const stats = makeStats({
      causesBreakdown: { signal: 0, input: 0, zone: 0, parent: 5, 'manual-cd': 5 },
    });
    expect(getSeverityLabels(stats)).not.toContain('CASCADE');
  });

  it('returns ZONE TRIGGERED when zone causes exceed 50% of total', () => {
    const stats = makeStats({
      causesBreakdown: { signal: 1, input: 1, zone: 10, parent: 1, 'manual-cd': 1 },
    });
    expect(getSeverityLabels(stats)).toContain('ZONE TRIGGERED');
  });

  it('does not return ZONE TRIGGERED when zone causes are exactly 50%', () => {
    const stats = makeStats({
      causesBreakdown: { signal: 0, input: 0, zone: 5, parent: 0, 'manual-cd': 5 },
    });
    expect(getSeverityLabels(stats)).not.toContain('ZONE TRIGGERED');
  });

  it('returns multiple labels when multiple conditions are met', () => {
    const stats = makeStats({
      renderFrequency: 150,
      causesBreakdown: { signal: 0, input: 0, zone: 0, parent: 10, 'manual-cd': 1 },
    });
    const labels = getSeverityLabels(stats);
    expect(labels).toContain('EXCESSIVE');
    expect(labels).toContain('CASCADE');
  });

  it('guards against division by zero when all causes are 0', () => {
    const stats = makeStats({
      renderFrequency: 150,
      causesBreakdown: { signal: 0, input: 0, zone: 0, parent: 0, 'manual-cd': 0 },
    });
    const labels = getSeverityLabels(stats);
    expect(labels).toEqual(['EXCESSIVE']);
    expect(labels).not.toContain('CASCADE');
    expect(labels).not.toContain('ZONE TRIGGERED');
  });
});

describe('getLabelClass', () => {
  it('returns red classes for EXCESSIVE', () => {
    expect(getLabelClass('EXCESSIVE')).toBe('text-red-500 bg-red-500/10');
  });

  it('returns amber classes for HOT', () => {
    expect(getLabelClass('HOT')).toBe('text-amber-500 bg-amber-500/10');
  });

  it('returns purple classes for CASCADE', () => {
    expect(getLabelClass('CASCADE')).toBe('text-purple-500 bg-purple-500/10');
  });

  it('returns blue classes for ZONE TRIGGERED', () => {
    expect(getLabelClass('ZONE TRIGGERED')).toBe('text-blue-500 bg-blue-500/10');
  });
});
