# Checks every quest chain once per profile (tests/chains.js). Run from tests/ with the repo served on :8765.
import json, os, sys, asyncio, time
from playwright.async_api import async_playwright
state = {"active": "pvp", "profiles": {k: {"settings": {"setupDone": True}} for k in ("pvp", "seasonal", "pve")}, "ui": {}}
PROFILES = sys.argv[1].split(',') if len(sys.argv) > 1 else ['pvp', 'seasonal', 'pve']
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        ctx = await b.new_context(viewport={"width": 1200, "height": 800})
        await ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('eft-tracker-v1', JSON.stringify({json.dumps(state)})); sessionStorage.setItem('seeded','1'); }}")
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/#/quests')
        await page.wait_for_selector('.tabs .tab', timeout=60000)
        await page.wait_for_timeout(1000)
        await page.add_script_tag(content=open('chains.js').read())
        await page.wait_for_function('window.__chains', timeout=30000)
        total = 0
        for pr in PROFILES:
            t0 = time.time()
            r = await page.evaluate(f'window.__chains.run("{pr}")')
            print(f"== {pr}: {r['checked']} quests, {len(r['problems'])} problems, {time.time() - t0:.0f}s (B {r['msB']} ms)", flush=True)
            for x in r['problems'][:80]: print('  !!', x[:260])
            for x in r['notes']: print('  ..', x[:260])
            total += len(r['problems'])
        print('errors:', errs)
        print('RESULT', 'OK' if not total and not errs else f'{total} PROBLEMS')
        await b.close()
asyncio.run(main())
