# EFT Quest Tracker

Escape from Tarkov progress tracker: Main Story (all 4 endings), Kappa, Hideout, Traders, Prestige, BattlePass, all quests, achievements and a global "needed items" list. Three separate profiles: PMC (PvP), PMC Seasonal and PvE.

- **Data source:** the [Escape from Tarkov Wiki](https://escapefromtarkov.fandom.com) (CC BY-SA). A GitHub Action rebuilds `data/dataset.json` every day; the site can also rebuild it directly from the wiki in your browser (Settings → Update data).
- **Map panel:** map images and marker coordinates come from [tarkov.dev](https://tarkov.dev).
- **Nothing reads or touches the game.** Progress is ticked manually and stored in your browser (Export/Import for backups).
- **Setup assistant** (wand button; opens by itself on a profile's first start and after a reset): edition, faction, level, goal (sets the Needed Items default, Story + Kappa unless you change it), ending, season perks, story progress, trader loyalty, open quests and hideout. Open quests can be entered per trader (only quests that can be open at your level / LL are listed) or by pasting screenshots of the in-game task lists – the text is recognised in your browser with [Tesseract.js](https://github.com/naptha/tesseract.js) (loaded from jsDelivr on first use); only the images you paste are read. Everything before an open quest counts as done, and with "this is my full task list" also everything unlocked that is not in your list. Before applying you see exactly what gets marked; either-or quests and higher loyalty groups, which a task list can't decide, are listed for you to tick.

- **Speedrun guide:** plans your next raids from your progress. "Right now, before your next raid" only lists trader visits (story talk steps, quests whose objectives are all ticked). Quests and story steps that only need items (find / hand over, weapon builds) are listed separately and are not assumed – what comes after them joins the plan once you tick them.
- **Gunsmith tasks** show the finished weapon (the wiki's "Modding Screen" picture of the example build).

## Structure
- `index.html`, `assets/` – the app (vanilla JS modules, no build step)
- `builder/` – wiki downloader + wikitext parsers (runs in Node and in the browser)
- `scripts/build-data.mjs` – Node entry used by the Action
- `data/` – generated dataset, map configs, tarkov.dev snapshots
