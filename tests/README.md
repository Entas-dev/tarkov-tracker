# Stress test
Serve the repo root: python3 -m http.server 8765
Run: python3 tests/stress_run.py 120 <seed> log.jsonl (Playwright/Chromium; run from tests/ so stress.js is found)
120 random quest ticks + 120 random mixed actions; after each: all tabs rendered + invariants.
