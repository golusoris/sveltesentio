import { describe, it, expect } from 'vitest';
import {
  deriveNodeView,
  DEFAULT_NODE_LABELS,
  NODE_KIND_NAMES,
  type ExampleNodeKind,
} from '../src/node-view.js';

const kinds: ExampleNodeKind[] = ['process', 'decision', 'data'];

describe('deriveNodeView', () => {
  it('uses the data label when present and builds the aria name', () => {
    const view = deriveNodeView('process', { label: 'Validate input' });
    expect(view.label).toBe('Validate input');
    expect(view.ariaLabel).toBe('Process step: Validate input');
    expect(view.hasDescription).toBe(false);
    expect(view.description).toBeUndefined();
  });

  it.each(kinds)('falls back to the default label for kind %s', (kind) => {
    const view = deriveNodeView(kind);
    expect(view.label).toBe(DEFAULT_NODE_LABELS[kind]);
    expect(view.ariaLabel).toBe(`${NODE_KIND_NAMES[kind]}: ${DEFAULT_NODE_LABELS[kind]}`);
  });

  it('surfaces a non-empty description', () => {
    const view = deriveNodeView('data', { label: 'Users', description: 'Postgres table' });
    expect(view.hasDescription).toBe(true);
    expect(view.description).toBe('Postgres table');
  });

  it('treats an empty-string label/description as absent', () => {
    const view = deriveNodeView('decision', { label: '', description: '' });
    expect(view.label).toBe(DEFAULT_NODE_LABELS.decision);
    expect(view.hasDescription).toBe(false);
  });

  it('ignores a non-string label defensively (renderer passes Record<string, unknown>)', () => {
    // `data` is `Record<string, unknown>`; a malformed numeric label must not leak through.
    const view = deriveNodeView('process', { label: 42 as unknown as string });
    expect(view.label).toBe(DEFAULT_NODE_LABELS.process);
  });

  it('defaults to an empty data object when none is given', () => {
    expect(deriveNodeView('data').kind).toBe('data');
  });
});
