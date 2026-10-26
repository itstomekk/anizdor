# rodzina-tablica

Private family-tree app. Browser-based, runs on Cloudflare (Pages now; Workers + D1 + Access later).

## Status
Stage 1: read and write GEDCOM 5.5.1 (`.ged`) in the browser.

- Import: UTF-8 (with/without BOM), UTF-16, ANSI/Windows-1250/1252 (as exported by Ahnenblatt), CONC/CONT.
- Export: GEDCOM 5.5.1, UTF-8, lines wrapped under 255 chars.
- Round-trip tested on a fictional sample (`fixtures/sample.ged`).

## Develop
    npm test          # node:test, no dependencies
    npm run dev       # wrangler pages dev public (needs network on first run)

## Privacy
No real family data in this repo (`.gitignore` blocks `*.ged`, `*.ahn`, JSON dumps). Production sits behind Cloudflare Access.

## Roadmap
1. GEDCOM import/export (done in this commit)
2. Tree/chart view, SVG and PDF export
3. D1 storage + Access login, edit persons and families
4. Media, sources, places, more formats (CSV, JSON)
