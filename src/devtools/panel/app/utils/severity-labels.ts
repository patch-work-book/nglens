import type { ComponentStats } from '../../../../types/panel';

export type SeverityLabel = 'HOT' | 'EXCESSIVE' | 'CASCADE' | 'ZONE TRIGGERED';

/**
 * Computes contextual severity labels for a component based on its render statistics.
 * Multiple labels can coexist when multiple conditions are satisfied.
 */
export function getSeverityLabels(stats: ComponentStats): SeverityLabel[] {
  const labels: SeverityLabel[] = [];

  if (stats.renderFrequency > 100) {
    labels.push('EXCESSIVE');
  } else if (stats.renderFrequency > 60) {
    labels.push('HOT');
  }

  const totalCauses = Object.values(stats.causesBreakdown).reduce((sum, v) => sum + v, 0);
  if (totalCauses > 0) {
    if (stats.causesBreakdown.parent / totalCauses > 0.5) {
      labels.push('CASCADE');
    }
    if (stats.causesBreakdown.zone / totalCauses > 0.5) {
      labels.push('ZONE TRIGGERED');
    }
  }

  return labels;
}

/**
 * Returns Tailwind CSS classes for a given severity label badge.
 */
export function getLabelClass(label: SeverityLabel): string {
  switch (label) {
    case 'EXCESSIVE': return 'text-red-500 bg-red-500/10';
    case 'HOT': return 'text-amber-500 bg-amber-500/10';
    case 'CASCADE': return 'text-purple-500 bg-purple-500/10';
    case 'ZONE TRIGGERED': return 'text-blue-500 bg-blue-500/10';
  }
}
