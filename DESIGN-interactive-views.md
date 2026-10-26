# Interactive family-tree views — design note

## Goal
Replace the current static whole-family board view with a more exploratory view that supports (1) a galaxy-like family network and (2) a radial ancestor fan. Keep genealogy relations accurate and all data processing in the browser.

## Research findings
- Interactive fan charts are established genealogy visualizations. FamilySearch describes selectable focal person, generation depth, variants that highlight family lines and data coverage, and printable output: https://www.familysearch.org/en/blog/genealogy-fan-chart (2020-04-15).
- Draper & Riesenfeld's *Interactive Fan Charts: A Space-saving Technique for Genealogical Graph Exploration* describes compact radial layouts and interaction: https://www.researchgate.net/publication/242357439_Interactive_Fan_Charts_A_Space-saving_Technique_for_Genealogical_Graph_Exploration (2008).
- Ball, Jensen & Squadroni's *Interactive Timeline-based Fan Charts* describes lifespan/uncertainty bands and hover modes: https://icarus.cs.weber.edu/~rball/pubs/Ball_Jensen_Squardroni_final_submission.pdf (accessed 2026-10-26).
- D3 hierarchy supports tidy and radial tree layouts: https://d3js.org/d3-hierarchy/tree and https://d3js.org/d3-hierarchy/cluster. D3 zoom allows drag-to-pan and wheel zoom, with D3 drag composable: https://d3js.org/d3-zoom.

## Proposed design
Retain the existing `Tablica` route and replace its rendering with an interactive visualization workspace. Tabs inside it: `Galaktyka` (default), `Wachlarz przodków`, and `Drzewo klasyczne` (retain present board as fallback/print view). The first two use the selected person as focus; choose via an accessible search/select control. `Galaktyka` shows the connected family network around the focus, organizing immediate family into constellations, with generation/radius cues, sex colors, photo-aware nodes, and relationship edges (parent-child and spouse). Controls: choose depth 2–6, filter ancestors/descendants/collateral relatives, pan/zoom, reset, and search. Drag moves a node for the session only; `Reset layout` restores calculated positions. Click node opens that person's existing card; hover/focus shows name, years, and relationship to focus. Disconnected people are not mixed into the galaxy; disclose that and provide the classic board for full-forest browse.

`Wachlarz przodków` displays the focus at center and ancestor generations as nested angular sectors. Depth selector 2–8; sectors encode generation with accessible palette and missing-data state. Hover/focus shows person details, click opens the person's card. Provide a search-based focus chooser, center-on-person action, SVG export and print stylesheet. Never imply an unknown parent is known: render missing ancestors as clearly labeled empty sectors, not fabricated people.

## Technical approach
No remote visualization dependency: implement SVG geometry locally using existing GEDCOM model, `parentsOf`, `childrenOf`, `spousesOf`, names/date helpers and `avatar`/photo metadata. Use native pointer events for drag and pan, wheel for zoom, SVG `viewBox` transform. Share a small person picker and interaction/accessibility utilities. Add pure layout functions in `tree.js` or a focused `visualizations.js` module; keep DOM rendering in `app.js` or an imported view module. Guard against pedigree collapse and cycles by tracking ancestor path and deduplicating repeated ancestors while indicating repeats. Handle large trees by depth cap and only lay out nodes within requested focus neighborhood. Keep keyboard alternative to drag, with focusable nodes and buttons for centering/opening.

## Tests and acceptance
- Pure tests: ancestor-fan sectors, repeated ancestors/pedigree collapse, cycles, absent parents, depth limits, valid SVG-safe labels.
- Browser tests on fictional demo and the private 334-person file: both views render, picker changes focus, depth/filter updates counts, node click opens correct person, drag changes only view position, reset restores it, pan/zoom work, mobile has no page-level overflow, keyboard focus works, zero console errors.
- Preserve the existing forest board as `Drzewo klasyczne`, including its print/SVG export.
- No real family data in GitHub and no server-side upload. Login remains out of scope for this feature.

## Out of scope
A physics simulation that continually moves people; automatic merges or data edits from visualization; public data sharing; map-based migration charts; timeline fan beyond the existing timeline view.

## Decision
Tomek selected replacing the existing Tablica as the organization, with galaxy + ancestor fan as primary views. This design note awaits review/approval before implementation.
