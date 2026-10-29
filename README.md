# ANIZDOR 🏡

ANIZDOR to RODZINA czytana od tyłu. (Formerly `rodzina-tablica`.)

Private family-tree app. Browser-based, runs on Cloudflare (Pages now; Workers + D1 + Access later).

## Status
Live: https://anizdor.pages.dev/ (end-to-end encrypted cloud vault, family password). The old URL https://rodzina-tablica.pages.dev/ redirects here.

Views
- **Osoby**: search (diacritic-insensitive), filters, sorting; person editor (dates typed as 12.03.1950 are stored as GEDCOM), add/link parents, partners, children, delete; ancestor and descendant charts; kinship calculator.
- **Tablica** (trzy widoki, wszystko liczone lokalnie w przeglądarce):
  - **Galaktyka**: wybrana osoba w centrum, krewni jako gwiazdy na orbitach, pary połączone złotą linią. Zoom kółkiem, przesuwanie tła, przeciąganie pojedynczych gwiazd (tylko w widoku), najechanie podświetla krewnych, kliknięcie otwiera kartę, dwuklik ustawia osobę w centrum. Liczba kroków i kierunek (przodkowie / potomkowie) do wyboru.
  - **Wachlarz przodków**: pierścienie pokoleń (2–9), pełne koło lub półkole, kolory wg pokolenia, płci albo kompletności danych. Brakujący rodzic to pusty, przerywany sektor, nigdy wymyślona osoba. Powtórzeni przodkowie (małżeństwa krewnych) są oznaczeni.
  - **Drzewo klasyczne**: dotychczasowa tablica całej rodziny, wyszukiwanie, SVG, druk.
  - Eksport SVG (bez zdjęć) i druk / PDF z każdego widoku.
  - Wektorowy PDF całej tablicy plus wachlarza (bez znaków wodnych): `node tools/export_layout.mjs plik.ged data/out/layout.json` i `uv run --with reportlab python tools/make_pdf.py data/out/layout.json data/out/Tablica.pdf "Tytuł"`. Wynik trafia do `data/` (poza repozytorium).
- **Statystyki**: totals, sex, living/deceased, data completeness, births/deaths/marriages by decade, lifespan, surnames, given names, places, family size, parent age, generations.
- **Kontrola**: data checks (impossible dates, parent/child age problems, duplicates with one-click merge, unnamed people, broken links), per-issue ignore.
- **Narzędzia**: kinship calculator, upcoming birthdays, exports: full `.ged`, `.ged` without living people (anonymised), CSV for Excel.

- **Oś czasu**: whole-family timeline (births, deaths, marriages, custom events) with a historical background (PL/world), and a life-lines chart (bars birth to death, filter by years and surname).
- **Zdjęcia** (per person tab): photos stored in the browser (IndexedDB), downscaled to 1600 px, primary photo used as avatar. Backup as `.zip` (GEDCOM + photos); the ZIP also contains a standards-only GEDCOM for Ahnenblatt/MyHeritage.
- **Miejsca**: place list with rename-everywhere, optional coordinates, schematic map. **Źródła**: sources and research tasks. Person events (occupation, residence, baptism, burial, ...) edited on the person card. Printable reports (index, family sheet), find and replace with preview.

Other: undo/redo (Ctrl+Z / Ctrl+Y), dark mode, keyboard shortcuts (`/`, `g o|t|s|k|n`), offline/installable (service worker + manifest), strict CSP.

GEDCOM: import UTF-8/UTF-16/ANSI (Windows-1250/1252), export 5.5.1 UTF-8, lossless for data the editor does not touch (media, burial, custom tags, extra names).

Data lives in the browser (localStorage + IndexedDB). With **Chmura** on, one shared copy also lives in Cloudflare D1, end-to-end encrypted.

## Cloud (Chmura, encrypted)
One family vault: the tree and all photos, shared by everyone who knows the family password.
- Opening the app on a remembered device loads the latest tree by itself. A new device asks for the password once.
- Edits upload about 3 s later; other devices check every 2 min and when the tab comes back into view.
- If two devices edit at once, the second one gets a choice: take the cloud version or keep its own (Ctrl+Z undoes either).
- The cloud keeps up to 30 older tree versions (at most one per 30 min): *Narzędzia → Chmura → Wcześniejsze wersje*.
- Crypto: PBKDF2-SHA256 (600k) turns the password into an AES-GCM key plus a separate auth secret. The server stores only SHA-256(auth secret) and ciphertext. Without the password the data cannot be read, and the password cannot be recovered.
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

## Develop
    npm test          # node:test, no dependencies (cloud API tested on node:sqlite as a D1 stand-in)
    npm run dev       # wrangler pages dev public (needs network on first run)

Local cloud: put `SETUP_CODE=...` in `.dev.vars` (gitignored), then `npx wrangler@4 pages dev public --persist-to <scratch dir>`.

## Privacy
No real family data in this repo (`.gitignore` blocks `*.ged`, `*.ahn`, JSON dumps). Cloud data is encrypted in the browser before upload. Cloudflare Access is not enabled on the account, so the password is the only gate.

## Roadmap
1. GEDCOM import/export (done)
2. Person editor, ancestor/descendant charts, SVG/print (done)
3. Statistics, data checks, merge, anonymised export, whole-family chart (done)
4. Cloudflare Access login + D1 storage (needs Access enabled on the account)
5. Timeline, photos, places, sources, tasks, events, ZIP backup (done)
6. Encrypted cloud vault: tree + photos in D1, auto sync, conflicts, version history (done)
7. Next: change family password (re-encrypt), map tiles for places, relationship-based reports
