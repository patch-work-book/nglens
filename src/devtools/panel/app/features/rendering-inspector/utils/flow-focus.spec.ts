import { describe, it, expect } from 'vitest';
import { resolveFlowFocus, type CascadeNode } from './cascade-tree';

/** Identity display-name mapper for tests (components already use full names). */
const id = (raw: string) => raw;

function node(name: string, count: number, children: CascadeNode[] = []): CascadeNode {
  return { componentName: name, count, totalDuration: count, cause: { type: 'zone' }, depth: 0, children };
}

describe('resolveFlowFocus — selected-component consistency (trust rule)', () => {
  const tree: CascadeNode[] = [
    node('LayoutComponent', 3, [
      node('SideBarComponent', 1),
      node('InvoiceComponent', 2),
    ]),
  ];

  it('centers on the exact selected component when it exists', () => {
    const focus = resolveFlowFocus(tree, 'SideBarComponent', id);
    expect(focus?.componentName).toBe('SideBarComponent');
  });

  it('centers on a nested selected component, not the root', () => {
    const focus = resolveFlowFocus(tree, 'InvoiceComponent', id);
    expect(focus?.componentName).toBe('InvoiceComponent');
  });

  it('returns NULL when the selected component is absent — never a divergent fallback', () => {
    // This is the core trust guarantee: the flow must not silently center a
    // DIFFERENT component than the one selected in the right panel.
    const focus = resolveFlowFocus(tree, 'ExecutiveDashboardComponent', id);
    expect(focus).toBeNull();
  });

  it('previews the highest-count root only when NOTHING is selected', () => {
    const focus = resolveFlowFocus(tree, null, id);
    expect(focus?.componentName).toBe('LayoutComponent');
  });

  it('returns null for an empty tree', () => {
    expect(resolveFlowFocus([], 'Anything', id)).toBeNull();
    expect(resolveFlowFocus([], null, id)).toBeNull();
  });

  it('respects the display-name mapping when matching', () => {
    const rawTree: CascadeNode[] = [node('_MyCmp_ngfactory', 2)];
    const map = (raw: string) => (raw === '_MyCmp_ngfactory' ? 'MyCmp' : raw);
    expect(resolveFlowFocus(rawTree, 'MyCmp', map)?.componentName).toBe('_MyCmp_ngfactory');
    // A name that maps to nothing present → null, not a fallback.
    expect(resolveFlowFocus(rawTree, 'OtherCmp', map)).toBeNull();
  });

  // Cross-panel consistency contract: the tree highlight is a pure display-name
  // match (selectedName === row.displayName). This proves the flow focus and a
  // tree-row match resolve to the SAME node for a given selected display name —
  // so selecting LegendComponent can never highlight ExecutiveDashboardComponent.
  it('flow focus and tree-row display-name match agree on the same component', () => {
    const flatten = (nodes: CascadeNode[]): CascadeNode[] =>
      nodes.flatMap(n => [n, ...flatten(n.children)]);
    for (const selected of ['LayoutComponent', 'SideBarComponent', 'InvoiceComponent']) {
      const focus = resolveFlowFocus(tree, selected, id);
      const treeRowMatch = flatten(tree).find(n => id(n.componentName) === selected);
      expect(focus?.componentName).toBe(treeRowMatch?.componentName);
    }
  });
});
