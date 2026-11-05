# RON Rust Forensics (`ron-forensics`)

Off-main-thread forensic signal engine: Boundary ΔELA + 2D FFT grid detection +
1-bit Bayer dither masks. Compiled to WebAssembly and loaded inside
`src/lib/workers/forensics.worker.ts`.

## Prereqs

- Rust stable (`rustup update stable`)
- `cargo install wasm-pack`

## Build (outputs straight into SvelteKit `static/`)

```sh
cd rust-forensics
wasm-pack build --target web --out-dir ../static/wasm --out-name ron_forensics
```

This produces:

- `static/wasm/ron_forensics.js` — ESM glue
- `static/wasm/ron_forensics_bg.wasm` — the compiled engine
- `static/wasm/ron_forensics.d.ts` — types

## Dev without WASM

The worker **automatically falls back** to an identical TypeScript
`Uint8ClampedArray` implementation when the `.wasm` bundle is absent, so
`npm run dev` works immediately with zero extra steps:

```sh
npm run dev
```

## FFI contract

```c
// rgba_ptr: w*h*4 readable bytes (RGBA row-major)
// out_ptr:  w*h*3 writable bytes ([ela | fft | dither], one byte per pixel each)
void compute_forensic_maps(
  const uint8_t *rgba_ptr, uint8_t *out_ptr,
  uint32_t width, uint32_t height,
  uint8_t ela_q, float fft_cutoff
);
```

`alloc(len)` / `dealloc(ptr, len)` are exported for worker-owned buffers.

## Tests

```sh
cargo test
```
