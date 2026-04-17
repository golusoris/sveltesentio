/**
 * UUIDv7 — time-ordered, k-sortable, monotonically increasing within a millisecond.
 * Spec: https://www.ietf.org/rfc/rfc9562.html#name-uuid-version-7
 *
 * 128-bit layout (big-endian):
 *   bits  0-31: unix_ts_ms top 32 bits      → UUID group 1 (8 hex chars)
 *   bits 32-47: unix_ts_ms bottom 16 bits   → UUID group 2 (4 hex chars)
 *   bits 48-51: ver = 0b0111 (7)            → UUID group 3 first char
 *   bits 52-63: rand_a (12 bits, seq counter)
 *   bits 64-65: var = 0b10                  → UUID group 4 first char high bits
 *   bits 66-127: rand_b (62 bits random)
 */

let lastMs = 0;
let seq = 0;

export function generateId(): string {
  let ms = Date.now();

  if (ms === lastMs) {
    seq = (seq + 1) & 0x0fff;
    if (seq === 0) {
      // Sequence overflow within same millisecond — wait for next tick
      while (Date.now() <= ms) { /* spin */ }
      ms = Date.now();
    }
  } else {
    lastMs = ms;
    seq = (crypto.getRandomValues(new Uint16Array(1))[0]!) & 0x0fff;
  }

  const rand = crypto.getRandomValues(new Uint8Array(8));

  // Timestamp: top 32 bits (bits 0-31) and bottom 16 bits (bits 32-47)
  const tsHi32 = Math.floor(ms / 0x10000) >>> 0;
  const tsLo16 = ms & 0xffff;

  const g1 = tsHi32.toString(16).padStart(8, '0');
  const g2 = tsLo16.toString(16).padStart(4, '0');
  // version 7 (top 4 bits) + 12-bit monotonic sequence
  const g3 = (0x7000 | (seq & 0x0fff)).toString(16).padStart(4, '0');
  // variant 0b10 in top 2 bits, then 14 bits of rand_b
  const varByte = ((rand[0]! & 0x3f) | 0x80);
  const g4 = (varByte * 256 + rand[1]!).toString(16).padStart(4, '0');
  const g5 = Array.from(rand.slice(2), (b) => b.toString(16).padStart(2, '0')).join('');

  return `${g1}-${g2}-${g3}-${g4}-${g5}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Extract the millisecond timestamp embedded in a UUIDv7. */
export function idToTimestamp(id: string): number {
  // Remove dashes, take first 12 hex chars = 48-bit timestamp
  const hex = id.replace(/-/g, '').slice(0, 12);
  const hi = parseInt(hex.slice(0, 8), 16);
  const lo = parseInt(hex.slice(8, 12), 16);
  return hi * 0x10000 + lo;
}

/** Nominal type brand for ID strings. Use in domain models. */
export type Id<Brand extends string = string> = string & { readonly __brand: Brand };

export function brandId<Brand extends string>(value: string): Id<Brand> {
  if (!isId(value)) throw new TypeError(`Not a valid UUIDv7: ${value}`);
  return value as Id<Brand>;
}
