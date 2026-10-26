# rodzina-tablica

Private family-tree app. Browser-based, runs on Cloudflare (Pages now; Workers + D1 + Access later).

## Status
Live: https://rodzina-tablica.pages.dev/ (static; no server-side data, no login yet).

Views
- **Osoby**: search (diacritic-insensitive), filters, sorting; person editor (dates typed as 12.03.1950 are stored as GEDCOM), add/link parents, partners, children, delete; ancestor and descendant charts; kinship calculator.
- **Tablica**: whole-family chart (descendants of everyone without known parents, partners shown as "⚭"), search/highlight, zoom, SVG, print/PDF.
- **Statystyki**: totals, sex, living/deceased, data completeness, births/deaths/marriages by decade, lifespan, surnames, given names, places, family size, parent age, generations.
- **Kontrola**: data checks (impossible dates, parent/child age problems, duplicates with one-click merge, unnamed people, broken links), per-issue ignore.
- **Narzędzia**: kinship calculator, upcoming birthdays, exports: full `.ged`, `.ged` without living people (anonymised), CSV for Excel.

- **Oś czasu**: whole-family timeline (births, deaths, marriages, custom events) with a historical background (PL/world), and a life-lines chart (bars birth to death, filter by years and surname).
- **Zdjęcia** (per person tab): photos stored in the browser (IndexedDB), downscaled to 1600 px, primary photo used as avatar. Backup as `.zip` (GEDCOM + photos); the ZIP also contains a standards-only GEDCOM for Ahnenblatt/MyHeritage.
- **Miejsca**: place list with rename-everywhere, optional coordinates, schematic map. **Źródła**: sources and research tasks. Person events (occupation, residence, baptism, burial, ...) edited on the person card. Printable reports (index, family sheet), find and replace with preview.

Other: undo/redo (Ctrl+Z / Ctrl+Y), dark mode, keyboard shortcuts (`/`, `g o|t|s|k|n`), offline/installable (service worker + manifest), strict CSP.

GEDCOM: import UTF-8/UTF-16/ANSI (Windows-1250/1252), export 5.5.1 UTF-8, lossless for data the editor does not touch (media, burial, custom tags, extra names).

Data lives only in the browser (localStorage). Nothing is uploaded.

## Develop
    npm test          # node:test, no dependencies
    npm run dev       # wrangler pages dev public (needs network on first run)

## Privacy
No real family data in this repo (`.gitignore` blocks `*.ged`, `*.ahn`, JSON dumps). Production sits behind Cloudflare Access.

## Roadmap
1. GEDCOM import/export (done)
2. Person editor, ancestor/descendant charts, SVG/print (done)
3. Statistics, data checks, merge, anonymised export, whole-family chart (done)
4. Cloudflare Access login + D1 storage (needs Access enabled on the account)
5. Timeline, photos, places, sources, tasks, events, ZIP backup (done)
6. Next: Access login, D1 sync (photos to R2), map tiles for places, relationship-based reports
