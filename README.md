# rodzina-tablica

Private family-tree app. Browser-based, runs on Cloudflare (Pages now; Workers + D1 + Access later).

## Status
MVP live at https://rodzina-tablica.pages.dev/ (static, no server-side data).

- Import `.ged`: UTF-8 (BOM or not), UTF-16, ANSI/Windows-1250/1252 (Ahnenblatt), CONC/CONT.
- Export `.ged` (GEDCOM 5.5.1, UTF-8), lossless: media links, burial, custom tags and extra names are kept.
- Person list with search, editor (name, sex, birth/death date and place), add/link parents, partners, children, delete.
- Ancestor and descendant charts (SVG download, print/PDF).
- Data lives only in the browser (localStorage). Nothing is uploaded.

## Develop
    npm test          # node:test, no dependencies
    npm run dev       # wrangler pages dev public (needs network on first run)

## Privacy
No real family data in this repo (`.gitignore` blocks `*.ged`, `*.ahn`, JSON dumps). Production sits behind Cloudflare Access.

## Roadmap
1. GEDCOM import/export (done)
2. Person editor, ancestor/descendant charts, SVG/print (done)
3. Cloudflare Access login + D1 storage (needs Access enabled on the account), full-family chart like the Ahnenblatt board
4. Media, sources, places, more formats (CSV, JSON)
