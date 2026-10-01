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
