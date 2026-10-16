# Zega Cursor Lab

A standalone, deterministic cursor protocol experiment. The three servers, messages and scheduling are simulated in the browser. A separate real Zega WASM instance runs the same selected ZQL against the same canonical artificial fixture. No application backend, Rust build, production repository or external service is needed.

## Open and run

Open `index.html` in a modern browser. The page embeds its JavaScript, D3 canvas and WASM bytes; there are no CDN requests or runtime asset fetches. Alternatively, with Node.js 22 or later:

```sh
npm run build
npm start
```

Open the printed loopback URL. `npm start` is only an optional development file server. No npm dependencies or install step are required.

Choose a scenario in the floating bottom bar. Step, Play/Pause, Back and Reset share recorded immutable snapshots. Timeline markers and the slider inspect recorded states. Scenario or scheduling changes reset execution and invalidate the previous WASM result. Tab changes preserve execution. The page uses the full available viewport with modest gutters. Each canvas measures its container and observes size changes, including tab switches; mobile layouts stack the server views.

- **1 server** shows every canonical data node using the existing Zega canvas component. This is the complete input to the real WASM reference.
- **3 servers** shows three independent instances of that same component. Solid nodes are owned data. Dashed nodes prefixed with ↗ are explicitly labeled remote references and are not locally owned. Every physical data node is present in its owner's view; force layout and fit bounds grow to include all displayed nodes.
- Drag the background to pan, drag a node to move it, scroll or use zoom controls, and use Fit/Reset. Focus the SVG for arrow-key panning, +/- zoom and F to fit. Click or press Enter/Space on a node to inspect it; relationships can be clicked. Layout settings are browser-local. Reduced motion disables decorative drift.
- **Run Zega** creates a fresh in-memory graph from the canonical fixture and executes the exact displayed query. Its result never supplies simulation output. Only a complete current simulated response and a complete current WASM result may say MATCH. Partial, stale, not-run and error states cannot match. The diff reports the first differing JSON line. Object key order is ignored; array order and values are preserved.

The coordinator-to-response cue activates only when the selected historical step changes the user JSON. Text explains additions/reordering or unchanged duplicate/path receipts. The outer cue connects the coordinator result row to the response-update banner through the column gutter, with a fixed-size open arrowhead. Anchor geometry refreshes on layout, tab and viewport changes. The Current event panel has a stable height and scrolls internally. The diagnostic path list retains protocol metadata separately.

## Scenarios and query semantics

1. **Cross-server chain:** one cursor crosses A → B → C, bounded to two follows hops. Dax is beyond the bound.
2. **Actor / movies:** ten fictional movies, five connected to Robert Downey Jr. across owners, five connected to another fictional actor. The query returns only linked `title` and `year` fields.
3. **Cities / restaurants:** five fictional cities, ten restaurants each, 55 actual data nodes. A virtual collection-scan operator (not a stored data node) forks five city work items; each city emits its selected header and forks/gathers its restaurant candidates. Headers and candidates contain fields read by their owners. The native ZQL query sorts restaurants within each city by rating descending, then name ascending, and returns one. Exact ties retain creation order. The simulator waits for each complete candidate group before publishing its winner; it never treats the first arrival as the winner.
4. **Advanced:** unequal branch lengths, three-server branching, diamond convergence with a four-hop cycle bound, and empty output.

For follows, the simulator retains **every bounded directed walk**, permits repeated nodes, and emits at each non-start node. A walk's identity and message ID remain separate from distinct node output. The displayed ZQL returns each reachable node once, excludes the start name, and selects only `name`. Its range traversal uses shortest depth then canonical insertion ID order. Receiving a shorter path later can reorder the partial response. Equal names on different target nodes remain separate rows. Target IDs are never deduplicated by projected values.

The movie query returns `{ "movies": [{ "title": "…", "year": 2010 }] }`. The follows query returns `{ "follows": [{ "name": "…" }] }`. The city collection query returns an array of `{ "name": "…", "restaurants": [{ "name": "…", "rating": 4.9 }] }`. No artificial `data`/type envelope or cursor metadata is added.

### Native per-city ranking

The bundled official `zega-wasm` 0.2.0 supports property ordering at both root and nested selections. Both executions use:

```text
query {
  City {
    name
    restaurants -> Restaurant order by rating desc, name limit 1 { name rating }
  }
}
```

Only an actual received city header establishes its candidate count. The simulation deduplicates candidate identities within each city, waits for the full count, then applies the same rating/name/creation-order rule. Unfinished cities have an empty partial restaurant list and explicitly show their progress. A winner is not published provisionally. City headers and all 50 candidates still count toward protocol completion; only five restaurants appear in final user JSON. Alder Bay contains a top-rating tie to demonstrate the secondary name key.

The prior dependency was the September 23 `zega-wasm` 0.1.2 artifact, whose parser accepted distance ordering only. That was a stale dependency, not a limitation of current ZQL. The corrected artifact is pinned to official source checkout `4ecaf43064c7320cd9d587fc68f21919e50ebc1d`, with its binary last changed at `61217bb8e81e3709e5980e88d38add1033e014d1`. No Rust feature or production source was edited. See [official ordering documentation](https://zega.dev/docs/zql/query/#order), `provenance.json`, and `sort-regressions.mjs` for the exact documented salary and nested-ranking regressions.

## Protocol rules

- Each owner has a local task queue, cursor records and accepted-delivery/executed-operation sets. Each directed link has an independent simulated message queue. Cursor transfers are direct between owners; the coordinator only starts and receives results/completion.
- Stable cursor ID + transfer generation + operation number prevent a retry from re-executing or rolling back work. Transfers preserve path, parent address and counts and add no graph hop.
- A branch parent seals its full child set before dispatch. It waits for one unique child completion per child. A completed cursor reports `own emitted results + summed unique child subtree counts`.
- Each logical result has a stable ID. Retries are ignored by ID. Distinct node projection is separate from result-message accounting.
- `rootDone` gives the expected logical result-message total. The coordinator declares complete only when its unique received-result count equals that total. It cannot inspect server queues to decide completion. It can finish before late retry traffic drains; Step continues to demonstrate those ignored deliveries.
- FIFO, newest-first, C-first, delayed-results, all-message retries, and seeded reorder/retry schedules are deterministic. Reset/replay preserve exact states. The seeded mode uses seed 12648430 by default.
- Static fixtures never mutate. Renderers work on copies. The single-machine DFS oracle is diagnostics only and never feeds execution or user responses.

No actual network, timing, speed, consistency, fault tolerance, crash recovery, message-loss recovery, mutable-data or production-scale claim follows from this simulation. Delivery is eventually scheduled; retries are bounded, not failure recovery. Rebalancing is a future design direction, not implemented here.

## Build, tests and evidence

```sh
npm run build
npm test
```

`build.cjs` embeds readable engine/query/timeline/UI sources, the attributed existing canvas modules and WASM, and writes `dist/index.html`. Builds are deterministic. Source `index.html` is also the standalone output; do not hand-edit its generated script sections. There are no package dependencies.

Tests cover 30 legacy fixture/schedule pairs, 500 seeded reorder/retry runs, 100 generated cyclic graphs, domain plans under all six schedules, adversarial duplicate and completion behavior, reset/replay, partial responses, timeline navigation, fixture ownership and graph tabs. Sort regressions cover the exact documented salary example, nested ranking, two-key ties, creation-order ties, delayed headers/candidates and first-arrival counterexamples. Every transition checks invariants. `verify-zql.mjs` executes the bundled real WASM and records exact responses in `verified-zql-responses.json`. Runtime tests initialize the exact embedded module/WASM in an isolated Node VM and test Run Zega success, stale-run cancellation, errors and comparison gating. Static checks verify source hashes, deterministic build and file serving.

`test-results.txt`, `runtime-test-results.txt` and `zql-verification.txt` are local generated reports (not committed). `protocol-walkthrough.txt` is a short actual delayed-results trace. The timeline SVG is diagnostic output, not a browser screenshot.

Real-browser layout, pointer, console and screenshot checks were blocked by the automation tool's prior file-URL policy denial. Node/DOM-harness checks are not visual QA. No alternate browser route was used to bypass that denial. A human browser pass remains necessary.

## Cloudflare static hosting (Sami's deployment step)

`wrangler.jsonc` contains only the worker name, compatibility date and `assets.directory: "./dist"`. There is no Worker application script, credential, account ID or domain configuration. The repository is suitable for Cloudflare Workers static assets: use `npm run build` as the build command and the managed Wrangler deploy command in the Cloudflare Git integration. Follow [Cloudflare's static assets guide](https://developers.cloudflare.com/workers/static-assets/get-started/) for account setup and deployment. Sami can add `cluster.zega.dev` after deployment. This task does not deploy, set DNS/custom domains, create credentials or change access.

Licenses, modifications and exact asset hashes: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [provenance.json](provenance.json), and [LICENSE](LICENSE).
