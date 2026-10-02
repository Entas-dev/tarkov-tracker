# Tests
Serve the repo root: `python3 -m http.server 8765` (Playwright/Chromium, run the scripts from `tests/`).

## Stress test
`python3 stress_run.py 120 <seed> log.jsonl` – 120 random quest ticks + 120 random mixed actions (incl. a setup assistant
walkthrough); after each: all tabs rendered + invariants.

## Setup assistant end-to-end
`python3 setup_e2e.py <seed> <level> <quests done>` – simulates a mid-wipe player with the tracker's own rules, renders mock
screenshots of every trader's in-game task list, pastes them into the assistant (text recognition needs jsDelivr),
applies "full task list" and compares with the simulated truth: no quest may be marked done that the player has not
finished, and everything left open must be in the assistant's "can't tell" list.

## Every quest chain
`python3 chains_run.py [pvp,seasonal,pve]` – per profile and quest: (A) every requirement from the game files is part of
the tracker's chain, (B) with only this quest open and a full task list its chain is done, nothing after it is done,
no other quest counts as available and the Speedrun plan only works on it (or on what unlocks on the way),
(C) the chain alone unlocks it or the remaining gate is a known one (loyalty group, story step, event, either-or).
