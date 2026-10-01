# End-to-end test of the setup assistant: simulate a mid-wipe player with the tracker's own rules, render mock
# screenshots of every trader's in-game task list, feed them to the assistant (text recognition), apply
# "full task list" and compare the result with the simulated truth.
# Run from tests/ with the repo served on :8765:  python3 setup_e2e.py <seed> <level> <quests done>
import json, os, sys, asyncio, re, random
from playwright.async_api import async_playwright
SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 1
LEVEL = int(sys.argv[2]) if len(sys.argv) > 2 else 22
K = int(sys.argv[3]) if len(sys.argv) > 3 else 90
OUT = '/tmp/claude-0/e2e'
os.makedirs(OUT, exist_ok=True)
state = {"active": "pvp", "profiles": {}, "ui": {}}
STAT = [('Available', '#c9c7b5'), ('Active', '#a5c26a')]
def game(n): return re.sub(r'\s*\((quest|Prestige \d+)\)$', '', n)
def shot_html(trader, rows, size):
    trs = ''.join(f'<tr style="background:{"#d8d6cb" if i == 2 else ("#121212" if i % 2 else "#0c0c0c")};color:{"#111" if i == 2 else "#c9c7b5"}"><td style="color:#8d8b80">◈</td><td style="width:420px">{game(n)}</td><td>{mp}</td><td style="color:{"#111" if i == 2 else c}">{st}</td></tr>' for i, (n, mp, st, c) in enumerate(rows))
    return f'''<html><head><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500&display=swap" rel="stylesheet"><style>body{{margin:0;background:#070707;font-family:'Barlow Condensed';font-size:{size}px;color:#c9c7b5;width:1920px;height:1080px}}
    .top{{height:80px;display:flex;gap:30px;align-items:center;padding:0 40px;font-size:20px;text-transform:uppercase;background:#141414}} table{{border-collapse:collapse;width:760px;margin:20px 40px}} td,th{{padding:5px 10px;text-align:left;white-space:nowrap}} th{{color:#8d8b80;font-size:13px}}
    .desc{{position:absolute;left:840px;top:100px;right:40px;bottom:200px;background:#0d0d0d;border:1px solid #2a2a2a;padding:14px;line-height:1.4}}</style></head><body><div class="top"><span>Trading</span><span>Tasks</span><span style="margin-left:auto">{trader}</span></div>
    <table><tr><th></th><th>NAME</th><th>LOCATION</th><th>STATUS</th></tr>{trs}</table><div class="desc">Hand over the item in the special place. Find the hidden stash and report back to {trader}. Locate and mark the fuel tanks with an MS2000 marker.</div></body></html>'''
async def main():
    random.seed(SEED)
    async with async_playwright() as p:
        proxy = os.environ.get('HTTPS_PROXY')
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args=([f'--proxy-server={proxy}', '--proxy-bypass-list=127.0.0.1;localhost'] if proxy else []))
        ctx = await b.new_context(viewport={"width": 1400, "height": 900}, ignore_https_errors=True, color_scheme="dark")
        await ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('eft-tracker-v1', JSON.stringify({json.dumps(state)})); sessionStorage.setItem('seeded','1'); }}")
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append('pageerror ' + str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await page.goto('http://127.0.0.1:8765/#/story')
        await page.wait_for_selector('.wiz', timeout=60000)
        # ---- simulate a player with the tracker's own rules ----
        sim = await page.evaluate("""async ([seed, level, k]) => {
          const M = await import('/assets/model.js'); const { store } = await import('/assets/store.js');
          const D = M.D, IX = M.IX;
          let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
          const sp = JSON.parse(JSON.stringify(store.p));
          sp.settings.level = level; sp.ch = { Tour: 1 };
          const ll = {};
          for (const t of Object.keys(D.traders)) if (D.traders[t].ll?.length && t !== 'Fence') { const est = M.traderLL(t, sp); ll[t] = Math.max(1, est - (rnd() < 0.4 ? 1 : 0)); }
          sp.settings.ll = ll;
          const avail = () => IX.order.filter(n => M.visible(D.quests[n], sp) && !sp.quests[n] && !M.isPrestigeQuest(n) && M.questStatus(D.quests[n], sp).s === 'available');
          for (let i = 0; i < k; i++) { const a = avail(); if (!a.length) break; const pick = a[Math.floor(rnd() * Math.min(a.length, 12))]; sp.quests[pick] = 1; }
          const open = avail();
          const byT = {}; for (const n of open) (byT[D.quests[n].trader] = byT[D.quests[n].trader] || []).push(n);
          const traders = IX.traders.filter(t => (IX.byTrader[t] || []).some(n => M.visible(D.quests[n], sp)));
          return { done: Object.keys(sp.quests), open, byT, ll, traders, maps: Object.fromEntries(open.map(n => [n, (D.quests[n].maps || [])[0] || 'Any'])) };
        }""", [SEED, LEVEL, K])
        print(f"simulated: level {LEVEL}, {len(sim['done'])} done, {len(sim['open'])} open at {len(sim['byT'])} traders; LL {sim['ll']}")
        # ---- mock screenshots, 18 rows each ----
        sp = await ctx.new_page()
        files = []
        for t, names in sim['byT'].items():
            for c in range(0, len(names), 18):
                rows = [(n, sim['maps'][n], *random.choice(STAT)) for n in names[c:c + 18]]
                await sp.set_content(shot_html(t, rows, random.choice([15, 16, 17])))
                await sp.wait_for_timeout(700)
                f = f'{OUT}/{SEED}_{t.replace(" ", "_")}_{c}.png'
                await sp.screenshot(path=f, clip={'x': 0, 'y': 0, 'width': 1920 if random.random() < 0.5 else 820, 'height': 1080})
                files.append(f)
        await sp.close()
        # ---- walk through the assistant ----
        await page.click('[data-act=wz-fresh][data-v="0"]')
        await page.fill('.wiz-lvl', str(LEVEL)); await page.press('.wiz-lvl', 'Enter')
        await page.click('[data-act=wz-go][data-s=story]')
        await page.click('.wiz-ch:has-text("Tour") [data-act=wz-ch][data-v="2"]')
        await page.click('[data-act=wz-go][data-s=ll]')
        for t, l in sim['ll'].items():
            await page.click(f'.wiz-ll:has(b:text-is("{t}")) [data-act=setll][data-l="{l}"]')
        await page.click('[data-act=wz-go][data-s=quests]')
        await page.set_input_files('#wz-file', files)
        await page.wait_for_function(f'document.querySelectorAll(".wq-job").length === {len(files)} && ![...document.querySelectorAll(".wq-job .rb")].length', timeout=300000, polling=500)
        for t in sim['traders']:
            if t not in sim['byT']:
                await page.click(f'[data-act=wz-tr][data-t="{t}"]')
                await page.click(f'.wq-th [data-act=wz-noopen][data-t="{t}"]')
        res = await page.evaluate("""async (sim) => {
          const M = await import('/assets/model.js'); const { store } = await import('/assets/store.js');
          const act = Object.keys(store.p.active).filter(n => store.p.active[n]);
          const missOpen = sim.open.filter(n => !act.includes(n)), extraOpen = act.filter(n => !sim.open.includes(n));
          const miss = sim.open.filter(n => !act.includes(n));
          return { missOpen, extraOpen, jobs: [...document.querySelectorAll('.wq-job')].map(j => j.innerText.split('\\n')[0]), unm: [...document.querySelectorAll('.wq-un li')].map(l => l.textContent) };
        }""", sim)
        print('screenshots:', len(files), '| open recognised wrong/missing:', res['extraOpen'], res['missOpen'])
        if res['missOpen']: print('   unrecognised lines:', res['unm'])
        await page.click('[data-act=wz-apply][data-mode=strict]')
        await page.wait_for_timeout(400)
        cmp = await page.evaluate("""async (sim) => {
          const M = await import('/assets/model.js'); const { store } = await import('/assets/store.js');
          const p = store.p; const done = Object.keys(p.quests).filter(n => p.quests[n]);
          const T = new Set(sim.done);
          const why = sim.done.filter(n => !p.quests[n]).map(n => { const q = M.D.quests[n]; const st = M.questStatus(q); return n + ' [' + st.s + ': ' + st.reasons.map(r => r.k + (r.k === 'var' ? ' ' + r.x.trader + ' LL' + r.x.tier + ' min ' + r.x.min : r.k === 'pre' ? ' ' + r.g.map(a => a.q + '/' + a.type).join('|') : '')).join(', ') + ']'; });
          return { why, level: p.settings.level, missing: sim.done.filter(n => !p.quests[n]), extra: done.filter(n => !T.has(n)),
                   openNotAvail: Object.keys(p.active).filter(n => p.active[n] && M.questStatus(M.D.quests[n]).s !== 'available') };
        }""", sim)
        print('   why missing:', cmp['why'])
        print(f"after apply: level {cmp['level']} | done missing {len(cmp['missing'])} {cmp['missing'][:12]} | done extra {len(cmp['extra'])} {cmp['extra'][:12]} | open not available {cmp['openNotAvail'][:8]}")
        # the ones left open must be exactly the "can't tell" (loyalty group) list; ticking them there makes it exact
        cap = await page.evaluate("async () => { const M = await import('/assets/model.js'); const S = await import('/assets/setup.js'); const pv = M.previewActiveApply('strict', S.activeOpts()); return [...pv.capped, ...pv.choice]; }")
        notcap = [n for n in cmp['missing'] if n not in cap]
        print(f"can't-tell list: {len(cap)} · missing done outside it: {notcap}")
        for n in cmp['missing']:
            if n in cap:
                await page.click(f'[data-act=wz-done][data-q="{n}"]')
        if cmp['missing']:
            await page.click('[data-act=wz-apply][data-mode=strict]'); await page.wait_for_timeout(300)
            cmp2 = await page.evaluate("async (sim) => { const { store } = await import('/assets/store.js'); const p = store.p; const T = new Set(sim.done); return { missing: sim.done.filter(n => !p.quests[n]), extra: Object.keys(p.quests).filter(n => p.quests[n] && !T.has(n)) }; }", sim)
            print('after ticking them:', cmp2)
            cmp['extra'] += cmp2['extra']; notcap += cmp2['missing']
        await page.screenshot(path=f'{OUT}/apply_{SEED}.png')
        # finish, reload: assistant must stay closed; reset: it opens again
        await page.click('[data-act=wz-go][data-s=done]')
        await page.click('.wiz-f [data-act=wz-finish]')
        await page.wait_for_timeout(300)
        assert not await page.query_selector('.wiz'), 'assistant still open after finish'
        await page.reload(); await page.wait_for_selector('.tabs .tab'); await page.wait_for_timeout(1200)
        assert not await page.query_selector('.wiz'), 'assistant opened again after reload'
        await page.click('[data-act=profile][data-p=pve]'); await page.wait_for_timeout(500)
        assert await page.query_selector('.wiz'), 'assistant did not open for a fresh PvE profile'
        t = await page.inner_text('.wiz-ttl'); assert 'PVE' in t.upper(), t
        await page.click('[data-act=wz-close]'); await page.wait_for_timeout(200)
        await page.click('[data-act=profile][data-p=pvp]'); await page.wait_for_timeout(300)
        assert not await page.query_selector('.wiz')
        print('errors:', errs)
        ok = not res['missOpen'] and not res['extraOpen'] and not cmp['extra'] and not cmp['openNotAvail'] and not errs and not notcap
        print('RESULT', 'OK' if ok else 'PROBLEMS')
        await b.close()
asyncio.run(main())
