export type ColorMode = 'dark' | 'light' | 'system';

export type InterfaceType =
  | 'media'
  | 'dashboard'
  | 'webapp'
  | 'pwa'
  | 'ten-foot'
  | 'flow'
  | 'file-manager';

export interface Preset {
  /** Unique identifier for the preset. */
  readonly id: InterfaceType;
  /** Human-readable name. */
  readonly name: string;
  /** Short description of the target use case. */
  readonly description: string;
  /** Default color mode for this interface type. */
  readonly defaultMode: ColorMode;
  /** Primary hue in the oklch color space. */
  readonly primaryHue: number;
  /** CSS file path (relative to package root). Import in your app.css. */
  readonly cssFile: string;
  /** Minimum accessible touch/click target size in px. */
  readonly minTargetPx: number;
  /** Whether a bottom nav bar is the primary navigation pattern. */
  readonly bottomNav: boolean;
  /** Whether this preset is optimized for D-pad / TV remote navigation. */
  readonly dpadNav: boolean;
}
