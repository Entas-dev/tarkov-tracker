import json, os, sys, asyncio, time
from playwright.async_api import async_playwright
N = int(sys.argv[1]) if len(sys.argv) > 1 else 120
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20260930
LOG = sys.argv[3] if len(sys.argv) > 3 else 'stress.log'
state = {"active": "pvp", "profiles": {"pvp": {"settings": {"level": 1, "faction": "USEC", "ending": "Savior", "ll": {}, "llAuto": True}}}, "ui": {}}
async def main():
    async with async_playwright() as p:
        proxy = os.environ.get('HTTPS_PROXY')
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args=([f'--proxy-server={proxy}', '--proxy-bypass-list=127.0.0.1;localhost'] if proxy else []))
        ctx = await b.new_context(viewport={"width": 1400, "height": 900}, ignore_https_errors=True, color_scheme="dark")
        await ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('eft-tracker-v1', JSON.stringify({json.dumps(state)})); sessionStorage.setItem('seeded','1'); }}")
        page = await ctx.new_page()
        page.on('pageerror', lambda e: print('PAGEERROR', e, flush=True))
        await page.goto('http://127.0.0.1:8765/#/story')
        await page.wait_for_function('document.querySelector(".tabs .tab")', timeout=60000)
        await page.wait_for_timeout(1500)
        await page.add_script_tag(content=open('stress.js').read())
        await page.wait_for_function('window.__stress', timeout=30000)
        await page.evaluate(f'window.__stress.setSeed({SEED})')
        out = open(LOG, 'w'); bad = 0; t0 = time.time()
        for run, kind in (('A', 'quest'), ('B', 'mixed')):
            for i in range(N):
                r = await page.evaluate(f'window.__stress.round({i}, "{kind}")')
                r['run'] = run
                out.write(json.dumps(r) + '\n'); out.flush()
                if r['problems']: bad += 1
                if r['problems'] or i % 20 == 0:
                    print(f"{run}{i:03d} {r['ms']:5d}ms p={r['profile']} lv={r['level']} done={r['done']} avail={r['avail']} | {r['action'][:70]}{' ['+r['dialog']+']' if r['dialog'] else ''}", flush=True)
                    for pr in r['problems'][:6]: print('     !!', pr[:300], flush=True)
        print(f'finished {2*N} rounds in {time.time()-t0:.0f}s, rounds with problems: {bad}', flush=True)
        await b.close()
asyncio.run(main())
