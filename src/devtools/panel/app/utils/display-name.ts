/**
 * Strips leading underscores from a component name for display purposes.
 * E.g., "_LayoutComponent" → "LayoutComponent"
 */
export function displayName(rawName: string): string {
  return rawName.replace(/^_+/, '');
}

/**
 * Converts a component class name to a CSS selector for DOM lookup.
 * Strips leading underscores, removes "Component" suffix, converts PascalCase
 * to kebab-case, and prepends "app-".
 *
 * E.g., "_LayoutComponent" → "app-layout"
 *       "HeroListComponent" → "app-hero-list"
 */
export function componentNameToSelector(rawName: string): string {
  // Strip leading underscores and "Component" suffix
  const cleaned = rawName.replace(/^_+/, '').replace(/Component$/, '');
  // PascalCase → kebab-case
  const kebab = cleaned.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `app-${kebab}`;
}

/**
 * Formats a raw render frequency rate (renders per trigger event) into a highly intuitive, human-readable string.
 */
export function formatRenderRate(renderFrequency: number): string {
  if (!renderFrequency || renderFrequency <= 0) {
    return 'Idle';
  }

  // If the value is a metric per trigger (which typically is a small float like 0.5, 1.2, 4.0),
  // we format it with "/trigger".
  // To differentiate from legacy or default fallbacks where values could represent per-minute rates (higher values like 30+),
  // we treat values < 10 as renders per trigger, or format all non-zero trigger rates perfectly.
  return `${renderFrequency.toFixed(1)}x / trigger`;
}
