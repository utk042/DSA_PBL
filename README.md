# PYQ Topic Frequency Analyser

DSA-II (CCSE0301) project-based learning — Utkarsh Raj Shukla · 2501330100398 · B.Tech CSE-F · Guide: Mr. Shamshad Ali

The analyser takes previous years' question papers and produces a topic-frequency table,
a Top-N ranking, clusters of topics that are examined together, a revision route through
each cluster, and the best set of topics to revise in a fixed number of hours.

The full design write-up, covering why each data structure was chosen and which ones were
rejected, is in **[REPORT.md](REPORT.md)**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Futk042%2FDSA_PBL)

## Live demo

The demo is a static site in `public/`. It has no build step and no dependencies, and
every stage of the pipeline runs in the browser. It opens with a synthetic five-year sample,
and there is a second preset that reproduces the worked example from Section 7 of the
report. You can also paste your own papers or load a `.txt` file.

| Pipeline stage | Implementation | File |
|---|---|---|
| 1 Parser | line-based PYQ format | `public/js/core/parser.js` |
| 2 Normaliser | clean-up + LCS similarity merge | `public/js/core/normalise.js`, `dp.js` |
| 3 Topic store | AVL tree (all four rotations), in/pre/post-order | `public/js/core/avl.js` |
| 4 Ranking | binary max-heap, Top-N, Heap Sort | `public/js/core/heap.js` |
| 5 Co-occurrence graph | weighted adjacency list, `w = 1/count` | `public/js/core/graph.js` |
| 6 Clustering | BFS, DFS, connected components | `graph.js` |
| 7 Revision route | Kruskal (union-find), Prim (heap) | `graph.js` |
| 8 Bridge topics | Dijkstra (heap) | `graph.js` |
| 9 Allocator | 0/1 Knapsack vs greedy baseline | `dp.js` |
| Wiring | whole pipeline + per-stage timings | `public/js/core/analyser.js` |

## Deploying on Vercel

1. Go to <https://vercel.com/new> and import `utk042/DSA_PBL`, or click the button above.
2. Leave every setting at its default. `vercel.json` already tells Vercel that there is no
   framework, no install step and no build step, and that the site is served from `public/`.
3. Click **Deploy**. Every push to the production branch redeploys automatically.

You can also deploy from the CLI: `npx vercel --prod` from the repo root.

## Running locally

```bash
npm test            # 12 unit tests (Node 18+, no dependencies)
npm run dev         # serves public/ on http://localhost:3000
# or: python3 -m http.server 3000 -d public
```

The page uses ES modules, so open it through a server and not as `file://`.

## Input format

```text
// comment
@alias BST = Binary Search Tree     abbreviation the LCS merge can't catch
@hours AVL Tree = 3                 study-hour estimate (default 2)
=== 2023 ===                        a paper (year)
[Unit 2]                            syllabus unit for the next questions
Q4 (10): Kruskal's Algorithm, Prim  marks optional; topics split on , or ;
```

The sample papers in `public/js/samples.js` are synthetic. They exist to show how the
pipeline works and are not real university question papers.
