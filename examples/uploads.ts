// Magic-byte file-type validation + EXIF stripping (privacy).
import { validateUpload, detectFileType, stripExif } from '@sveltesentio/uploads';

const kind = await detectFileType(buffer); // sniffs real bytes, not the extension
const ok = validateUpload(file, { accept: ['image/png', 'image/jpeg'], maxBytes: 5_000_000 });
const clean = await stripExif(buffer); // removes GPS/camera metadata
