// @sveltesentio/ipc-sockmap — not yet implemented (see ADR-0051 + docs/compose/colocated-ipc.md)
//
// Tier 3 of the colocated-IPC ladder. Owns: opening the pinned BPF_MAP_TYPE_SOCKHASH
// that golusoris's pkg/sockmap module pins at /sys/fs/bpf/golusoris/sockhash,
// registering the SvelteKit server's listen FD, and exposing degrade-to-Tier-1 semantics
// when the map is unavailable (non-Linux host, kernel < 5.10, CAP_BPF missing, etc.).
//
// Blocked on golusoris/golusoris#27 (acceptance criteria 1-4). This stub reserves the
// public surface; implementation lands when the golusoris side ships.

export {};
