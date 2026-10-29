# ORGANIZATION-LOG

## 2026-10-28: rename rodzina-tablica -> anizdor
- Folder: `Hermes\projects\websites\rodzina-tablica` -> `Hermes\projects\websites\anizdor` (mv; no other writers, no cron jobs reference it).
- GitHub: `itstomekk/rodzina-tablica` -> `itstomekk/anizdor` (gh repo rename; GitHub redirects old git/web URLs). Local remote updated.
- Cloudflare Pages: new project `anizdor` (https://anizdor.pages.dev/). Old project `rodzina-tablica` now serves a 301 redirect stub (`redirect-old/`).
- Unchanged on purpose: D1 database name `rodzina-tablica` (cannot be renamed; binding `DB`), secret file `.secrets\rodzina-tablica-setup-code.txt`.
- Rollback: `gh repo rename rodzina-tablica -R itstomekk/anizdor`, move the folder back, redeploy `public/` to project `rodzina-tablica`.
