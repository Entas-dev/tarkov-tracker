# EFT Quest Tracker

Escape from Tarkov progress tracker: Main Story (all 4 endings), Kappa, Hideout, Traders, Prestige, BattlePass, all quests, achievements and a global "needed items" list. Three separate profiles: PMC (PvP), PMC Seasonal and PvE.

- **Data source:** the [Escape from Tarkov Wiki](https://escapefromtarkov.fandom.com) (CC BY-SA). A GitHub Action rebuilds `data/dataset.json` every day; the site can also rebuild it directly from the wiki in your browser (Settings → Update data).
- **Map panel:** map images and marker coordinates come from [tarkov.dev](https://tarkov.dev).
- **Nothing reads or touches the game.** Progress is ticked manually and stored in your browser (Export/Import for backups).

## Structure
- `index.html`, `assets/` – the app (vanilla JS modules, no build step)
- `builder/` – wiki downloader + wikitext parsers (runs in Node and in the browser)
- `scripts/build-data.mjs` – Node entry used by the Action
- `data/` – generated dataset, map configs, tarkov.dev snapshots
