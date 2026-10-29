# ANIZDOR: development notes

Technical details for people who want to run, change, or deploy ANIZDOR. For what the app does and why, see the [README](README.md).

ANIZDOR is the Polish word RODZINA ("family") read backwards. The project was formerly called `rodzina-tablica`; the old URL https://rodzina-tablica.pages.dev/ redirects to https://anizdor.pages.dev/.

The app UI is in Polish. It is a static site (`public/`, plain JavaScript, no build step) plus one Cloudflare Pages Function (`functions/api/[[path]].js`) for the optional encrypted cloud. It runs on Cloudflare Pages with D1 as the cloud store.

## Run it locally

    npm test          # node:test, no dependencies (cloud API tested on node:sqlite as a D1 stand-in)
    npm run dev       # wrangler pages dev public (needs network on first run)

For a quick look at the front end only, any static server works, for example `cd public && python -m http.server 8080`. Then load `public/demo.ged` (fictional data) with the **Wczytaj** button.

Local cloud: put `SETUP_CODE=...` in `.dev.vars` (gitignored), then run `npx wrangler@4 pages dev public --persist-to <scratch dir>`.

## Deploy

Deploy is automatic. Every push to `main` runs the tests and publishes to Cloudflare Pages via GitHub Actions (`.github/workflows/deploy.yml`). The workflow needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Watch runs at https://github.com/itstomekk/anizdor/actions.

Manual fallback:

    npx wrangler pages deploy public --project-name anizdor --branch main

Live: https://anizdor.pages.dev/ (encrypted cloud vault, family password).

## Features in detail

Everything is computed locally in the browser.

### Views

- **Osoby** (People): search (diacritic-insensitive), filters, sorting; person editor (dates typed as `12.03.1950` are stored as GEDCOM), add/link parents, partners, children, delete; ancestor and descendant charts; kinship calculator.
- **Tablica** (Board), three views:
  - **Galaktyka** (Galaxy): the chosen person in the centre, relatives as stars on orbits, couples joined by a gold line. Mouse wheel zooms, dragging the background pans, single stars can be dragged (view only), hover highlights relatives, click opens the person card, double-click recentres on that person. Number of steps and direction (ancestors / descendants) are selectable.
  - **Wachlarz przodków** (Ancestor fan): generation rings (2 to 9), full circle or half circle, colours by generation, sex, or data completeness. A missing parent is an empty dashed sector, never an invented person. Repeated ancestors (marriages between relatives) are marked.
  - **Drzewo klasyczne** (Classic tree): the original board of the whole family, search, SVG, print.
  - SVG export (without photos) and print / PDF from every view.
  - Vector PDF of the whole board plus the fan (no watermarks): `node tools/export_layout.mjs file.ged data/out/layout.json` and `uv run --with reportlab python tools/make_pdf.py data/out/layout.json data/out/Tablica.pdf "Title"`. Output goes to `data/` (outside the repository).
- **Statystyki** (Statistics): totals, sex, living/deceased, data completeness, births/deaths/marriages by decade, lifespan, surnames, given names, places, family size, parent age, generations.
- **Kontrola** (Data checks): impossible dates, parent/child age problems, duplicates with one-click merge, unnamed people, broken links; per-issue ignore. Safe issues have one-click fixes and fix-all.
- **Narzędzia** (Tools): kinship calculator, upcoming birthdays, exports: full `.ged`, `.ged` without living people (anonymised), CSV for Excel.
- **Oś czasu** (Timeline): whole-family timeline (births, deaths, marriages, custom events) with a historical background (PL/world), and a life-lines chart (bars from birth to death, filter by years and surname).
- **Zdjęcia** (Photos, per-person tab): photos stored in the browser (IndexedDB), downscaled to 1600 px, primary photo used as avatar. Backup as `.zip` (GEDCOM + photos); the ZIP also contains a standards-only GEDCOM for Ahnenblatt/MyHeritage.
- **Miejsca** (Places): place list with rename-everywhere, optional coordinates, schematic map. **Źródła** (Sources): sources and research tasks. Person events (occupation, residence, baptism, burial, ...) are edited on the person card. Printable reports (index, family sheet), find and replace with preview.

Other: undo/redo (Ctrl+Z / Ctrl+Y), dark mode, keyboard shortcuts (`/`, `g o|t|s|k|n`), offline/installable (service worker + manifest), strict CSP (`public/_headers`: everything from `'self'`, no third-party requests; also `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`).

### GEDCOM

Import UTF-8/UTF-16/ANSI (Windows-1250/1252), export 5.5.1 UTF-8, lossless for data the editor does not touch (media, burial, custom tags, extra names).

### Where data lives

Data lives in the browser (localStorage + IndexedDB). With **Chmura** (Cloud) on, one shared copy also lives in Cloudflare D1, end-to-end encrypted.

## Cloud (Chmura, encrypted)

One family vault: the tree and all photos, shared by everyone who knows the family password.

- Opening the app on a remembered device loads the latest tree by itself. A new device asks for the password once.
- Edits upload about 3 s later; other devices check every 2 min and when the tab comes back into view.
- If two devices edit at once, the second one gets a choice: take the cloud version or keep its own (Ctrl+Z undoes either).
- The cloud keeps up to 30 older tree versions (at most one per 30 min): *Narzędzia → Chmura → Wcześniejsze wersje*.
- Crypto: PBKDF2-SHA256 (600k iterations) turns the password into an AES-GCM key plus a separate auth secret. The server stores only SHA-256(auth secret) and ciphertext. Without the password the data cannot be read, and the password cannot be recovered.
- First setup needs the one-time `SETUP_CODE` (a Pages secret); after setup, `/api/vault/init` refuses further calls.

API (`functions/api/[[path]].js`, D1 binding `DB`, auth header `x-vault-auth`):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/vault` | public: initialized?, salt, iterations |
| POST | `/api/vault/init` | one time, needs `SETUP_CODE` |
| GET | `/api/items` | list: tree, photos, older tree versions |
| GET/PUT | `/api/items/tree` | PUT needs `x-base-rev`; 409 on conflict |
| GET | `/api/items/tree_h<rev>` | older version (read-only) |
| GET/PUT/DELETE | `/api/items/photo_<id>` | encrypted photo |

## Privacy rules for contributors

No real family data in this repo. `.gitignore` blocks `*.ged`, `*.gedcom`, `*.ahn`, `*.gramps` and JSON dumps; only `fixtures/*.ged` and `public/demo.ged` (both fictional) are allowed. Local working data goes in `data/` (gitignored). Screenshots of real data stay out of the repo too (`design/**/*.png` is ignored). Never paste real family data into issues or pull requests.

Cloud data is encrypted in the browser before upload. Cloudflare Access is not enabled on the account, so the password is the only gate.

## README screenshots

The screenshots in `.github/readme/` are taken from a fictional family (made-up names such as Kowalski, Nowak, Wiśniewski), never from real data. To redo them: serve `public/` locally, open it in a browser at 1280 px wide, load a fictional `.ged` with the **Wczytaj** button, and capture the views in the light theme.

## Roadmap

1. GEDCOM import/export (done)
2. Person editor, ancestor/descendant charts, SVG/print (done)
3. Statistics, data checks, merge, anonymised export, whole-family chart (done)
4. Cloudflare Access login + D1 storage (needs Access enabled on the account)
5. Timeline, photos, places, sources, tasks, events, ZIP backup (done)
6. Encrypted cloud vault: tree + photos in D1, auto sync, conflicts, version history (done)
7. Next: change family password (re-encrypt), map tiles for places, relationship-based reports
