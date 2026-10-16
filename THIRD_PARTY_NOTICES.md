# Third-party notices and provenance

## Zega

Zega is Copyright 2026 Sami Fouad and licensed under Apache-2.0. The license is included as `LICENSE` and `licenses/Zega-Apache-2.0.txt`.

Reused from [zegadb/zega](https://github.com/zegadb/zega), source checkout commit `5cf1c8df7de715b63bb6d11fd26fc30983369236`:

- `browser/graph.js` → `zega-graph.mjs`. Modified here to isolate SVG IDs across canvases, label remote ownership, use owner colors, add keyboard/fit/reset controls, respect reduced motion, and correct panning for scaled canvases. Physics, canvas interactions, rendering and settings derive from the existing Zega component.
- Relevant graph CSS from `browser/style.css` → scoped and adapted `graph.css`.
- `browser/pkg/zega_wasm.js` → unchanged `vendor/zega_wasm.mjs`.
- `browser/pkg/zega_wasm_bg.wasm` → `vendor/zega_wasm_bg.wasm`. Modified only to replace 47 embedded personal build-path prefixes with an equal-length generic prefix. Both upstream and experiment hashes are recorded in `provenance.json`; the resulting binary is tested in memory. The upstream package declares version 0.1.2 and Apache-2.0. Its exact binary build commit was not recorded, so it is not claimed to have been built from the source checkout commit above.

No production source was changed or Rust compiled for this experiment. A fresh in-memory WASM graph is created on each reference run. The original package/source remains available at the upstream repository.

## D3

Existing local vendored ES modules are bundled without changing their source bytes:

- d3-force 3.0.0 — ISC license, Mike Bostock; `licenses/d3-force.txt`.
- d3-quadtree 3.0.1 — ISC license, Mike Bostock; `licenses/d3-quadtree.txt`.
- d3-dispatch 3.0.1 — ISC license, Mike Bostock; `licenses/d3-dispatch.txt`.
- d3-timer 3.0.1 — ISC license, Mike Bostock; `licenses/d3-timer.txt`.

Each vendor file retains its original jsDelivr bundling notice. License texts were obtained from the corresponding official `d3` GitHub repository tags. `build.cjs` embeds these sources in isolated wrappers to produce a standalone page without runtime imports or CDN access. Exact original file hashes are in `provenance.json`.
