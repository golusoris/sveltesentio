// @sveltesentio/uploads — transport-agnostic upload primitives (ADR-0041).
// validateUpload + stripExif have NO dependency on tus or the resumable path,
// so a downstream with no tus server can validate/strip then POST via FormData.
// The tus `createResumableUpload` wrapper is follow-through (separate sub-export).
export { validateUpload, detectFileType } from './validate.js';
export type {
	ValidateUploadOptions,
	ValidateUploadResult,
	DetectedFileType,
} from './validate.js';

export { stripExif, readExif } from './exif.js';
export type { StripExifOptions, Reencoder } from './exif.js';
