// `./canvas` sub-export — the `<FlowCanvas>` component plus its pure model.
// Re-exports the model so consumers can unit-test layout/keyboard wiring without
// mounting the `@xyflow/svelte` canvas.

export { default as FlowCanvas } from './FlowCanvas.svelte';

export {
  type CanvasNodeLike,
  type CanvasEdgeLike,
  type FallbackNodeSize,
  type FocusDirection,
  type OnLayout,
  resolveNodeSize,
  applyElkLayout,
  focusOrder,
  nextFocusTarget,
  canvasAriaLabel,
} from './canvas-model.js';
