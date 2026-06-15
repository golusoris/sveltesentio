import { render, fireEvent } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import NodeBody from '../src/nodes/NodeBody.svelte';
import { deriveNodeView, NODE_KIND_NAMES, type ExampleNodeKind } from '../src/node-view.js';
import { expectNoAxeViolations } from './axe-helper.js';

// NodeBody is the `@xyflow/svelte`-free body shared by ProcessNode/DecisionNode/
// DataNode. Rendering it directly exercises the node a11y (role/label/described-by)
// without a SvelteFlow store context — the `<Handle>`s the shells add need that
// context and are not asserted here (they are thin, contextual passthroughs).

function renderBody(props: {
  kind: ExampleNodeKind;
  id?: string;
  label?: string;
  description?: string;
  selected?: boolean;
}) {
  const view = deriveNodeView(props.kind, {
    label: props.label,
    description: props.description,
  });
  return render(NodeBody, {
    id: props.id ?? 'n1',
    view,
    kind: props.kind,
    selected: props.selected ?? false,
  });
}

const kinds: ExampleNodeKind[] = ['process', 'decision', 'data'];

describe('<NodeBody>', () => {
  it.each(kinds)('renders a labelled group named for the %s kind + label', (kind) => {
    const { getByRole } = renderBody({ kind, label: 'My step' });
    const group = getByRole('group', { name: `${NODE_KIND_NAMES[kind]}: My step` });
    expect(group).toBeInTheDocument();
    // Tab focus is owned by @xyflow/svelte's NodeWrapper, not this body.
    expect(group.hasAttribute('tabindex')).toBe(false);
    expect(group).toHaveAttribute('data-kind', kind);
  });

  it('falls back to the default label so a node is never anonymous', () => {
    const { getByRole } = renderBody({ kind: 'process' });
    // `deriveNodeView` defaults the label to "Process".
    expect(getByRole('group', { name: 'Process step: Process' })).toBeInTheDocument();
  });

  it('wires aria-describedby to the description paragraph when present', () => {
    const { getByRole, getByText } = renderBody({
      kind: 'data',
      id: 'store-1',
      label: 'Users',
      description: 'Postgres table',
    });
    const group = getByRole('group');
    const desc = getByText('Postgres table');
    expect(desc.id).toBe('store-1-desc');
    expect(group.getAttribute('aria-describedby')).toBe('store-1-desc');
  });

  it('omits aria-describedby when there is no description', () => {
    const { getByRole } = renderBody({ kind: 'process', label: 'Step' });
    expect(getByRole('group').hasAttribute('aria-describedby')).toBe(false);
  });

  it('reflects the selected state via aria-current + data-selected', () => {
    const { getByRole, rerender } = renderBody({ kind: 'decision', label: 'Branch' });
    const group = getByRole('group');
    expect(group.hasAttribute('aria-current')).toBe(false);

    const view = deriveNodeView('decision', { label: 'Branch' });
    return rerender({ id: 'n1', view, kind: 'decision', selected: true }).then(() => {
      expect(group).toHaveAttribute('aria-current', 'true');
      expect(group).toHaveAttribute('data-selected', 'true');
    });
  });

  it('hides the decorative kind eyebrow from assistive tech', () => {
    const { container } = renderBody({ kind: 'process', label: 'Step' });
    const eyebrow = container.querySelector('.ssentio-flow-node__kind');
    expect(eyebrow).toHaveAttribute('aria-hidden', 'true');
    expect(eyebrow).toHaveTextContent('Process');
  });

  it('keeps the group reachable after a focus interaction', async () => {
    const { getByRole } = renderBody({ kind: 'process', label: 'Step' });
    const group = getByRole('group');
    await fireEvent.focus(group);
    expect(getByRole('group')).toBeInTheDocument();
  });

  it.each(kinds)('is axe-clean for the %s kind with a description', async (kind) => {
    const { container } = renderBody({
      kind,
      label: 'Labelled',
      description: 'A one-line summary.',
    });
    await expectNoAxeViolations(container);
  });

  it('is axe-clean without a description', async () => {
    const { container } = renderBody({ kind: 'data', label: 'Bare' });
    await expectNoAxeViolations(container);
  });
});
