// Scaffolding placeholder — see ADR-0041.
//
// Pending:
//   - validateUpload({ maxBytes, allowed }) — magic-byte sniff via file-type
//   - stripExif(blob) — exifr-driven EXIF removal via canvas re-encode
//   - createResumableUpload({ endpoint, metadata }) — tus-js-client wrapper
//
// Consumers should not import from this package until the API lands.
export {};
