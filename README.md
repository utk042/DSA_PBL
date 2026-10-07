# PYQ Topic Analyser

Upload previous years' question papers and see:

- which topics are asked most,
- which topics are asked together,
- what to revise in the hours you have.

DSA-II (CCSE0301) project by Utkarsh Raj Shukla (2501330100398), B.Tech CSE-F, guided by Mr. Shamshad Ali.
The design choices are explained in [REPORT.md](REPORT.md).

## Using it

Open the site, then drop in your papers. It reads:

| Format | Notes |
|---|---|
| PDF | Text PDFs. A scanned PDF has no text, so it needs OCR first. |
| Word `.docx` | |
| PowerPoint `.pptx` | |
| Old `.doc` / `.ppt` | Best effort. Topics are found, but question numbers may be lost. |
| `.txt` | Free text, or the format below. |

Use one file per paper. The year is taken from the file name or the top of the paper, and you can change it after upload.
Topics are found by matching question text against the DSA-II topic list in `public/js/core/vocabulary.js`.
To check or fix what was read, open **Type or edit papers as text**.

Everything runs in the browser. Files are never uploaded anywhere.

### Text format

```text
=== 2023 ===                       a paper (a year or any label)
[Unit 2]                           unit for the questions below
Q4 (10): Kruskal, Prim             question, marks (optional), topics
@hours AVL Tree = 3                optional: study hours for a topic
@alias BST = Binary Search Tree    optional: short forms
```

## How it works

| Step | Data structure / algorithm | Code |
|---|---|---|
| Read files | pdf.js, a small ZIP reader for docx/pptx | `public/js/files.js`, `core/readers.js`, `core/zip.js` |
| Find questions and topics | phrase matching against the topic list | `core/extract.js` |
| Merge spellings | LCS similarity | `core/normalise.js`, `core/dp.js` |
| Count topics | AVL tree | `core/avl.js` |
| Rank | max-heap, heap sort | `core/heap.js` |
| Link topics | weighted adjacency list, BFS, DFS components | `core/graph.js` |
| Revision order | Kruskal, Prim | `core/graph.js` |
| Path between topics | Dijkstra | `core/graph.js` |
| Study plan | 0/1 knapsack | `core/dp.js` |

## Run locally

```bash
npm test        # Node 18+, no dependencies
npm run dev     # http://localhost:3000
```

Open the page through a server, not as a `file://` URL.

## Deploy on Vercel

Import the repo at <https://vercel.com/new> and keep the defaults.
`vercel.json` serves `public/` with no build step.
Each push to the production branch redeploys the site.

pdf.js (Apache-2.0) is included in `public/vendor/pdfjs`.
The app ships with no data: everything shown comes from the papers you add. The test fixtures in `tests/fixtures` are made up and are not real exam papers.
