// MediaWiki API client for the EFT Fandom wiki. Works in browser (CORS via origin=*) and Node 18+.
import { WIKI_BASE, normTitle } from './wikitext.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class Wiki {
  constructor({ fetchFn, base = WIKI_BASE, log = () => {}, concurrency = 3, userAgent } = {}) {
    this.fetch = fetchFn || globalThis.fetch.bind(globalThis);
    this.base = base;
    this.log = log;
    this.concurrency = concurrency;
    this.userAgent = userAgent;
    this.requests = 0;
    this._active = 0;
    this._queue = [];
  }

  async _slot() {
    if (this._active < this.concurrency) { this._active++; return; }
    await new Promise(r => this._queue.push(r));
    this._active++;
  }
  _release() { this._active--; const n = this._queue.shift(); if (n) n(); }

  async api(params) {
    const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
    if (typeof window !== 'undefined') qs.set('origin', '*');
    const url = `${this.base}/api.php?${qs}`;
    await this._slot();
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          this.requests++;
          const headers = this.userAgent ? { 'User-Agent': this.userAgent, 'Api-User-Agent': this.userAgent } : undefined;
          const r = await this.fetch(url, headers ? { headers } : undefined);
          if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
          if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url.slice(0, 200));
          const j = await r.json();
          if (j.error) throw new Error('API error ' + j.error.code + ': ' + j.error.info);
          return j;
        } catch (e) {
          if (attempt === 4) throw e;
          await sleep(800 * (attempt + 1) ** 2);
        }
      }
    } finally { this._release(); }
  }

  async categoryMembers(cat, ns = 0) {
    const out = [];
    let cont;
    do {
      const j = await this.api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: 'max', cmnamespace: String(ns), ...(cont ? { cmcontinue: cont } : {}) });
      out.push(...j.query.categorymembers.map(x => x.title));
      cont = j.continue?.cmcontinue;
    } while (cont);
    return out;
  }

  // Generic batched prop query with continuation merge. fn(page) called per page.
  async _batched(titles, params, onPage, batch = 50) {
    const chunks = [];
    for (let i = 0; i < titles.length; i += batch) chunks.push(titles.slice(i, i + batch));
    const redirects = {};
    await Promise.all(chunks.map(async (chunk) => {
      let cont = {};
      do {
        const j = await this.api({ action: 'query', titles: chunk.join('|'), ...params, ...cont });
        for (const n of j.query?.normalized || []) redirects[n.from] = n.to;
        for (const r of j.query?.redirects || []) redirects[r.from] = r.to;
        for (const p of j.query?.pages || []) onPage(p);
        cont = j.continue ? { ...j.continue } : null;
        if (cont) delete cont.continue;
      } while (cont && Object.keys(cont).length);
    }));
    return redirects;
  }

  // Returns {title -> {title, wikitext, missing}} keyed by REQUESTED title (after resolving redirects)
  async wikitext(titles) {
    titles = [...new Set(titles.map(normTitle).filter(Boolean))];
    const pages = {};
    const redirects = await this._batched(titles, { prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1' }, (p) => {
      pages[p.title] = { title: p.title, missing: !!p.missing, wikitext: p.revisions?.[0]?.slots?.main?.content || '' };
    });
    const out = {};
    for (const t of titles) {
      let f = t, guard = 0;
      while (redirects[f] && guard++ < 5) f = redirects[f];
      out[t] = pages[f] || { title: f, missing: true, wikitext: '' };
    }
    return out;
  }

  async meta(titles) {
    titles = [...new Set(titles.map(normTitle))];
    const pages = {};
    await this._batched(titles, { prop: 'categories|templates', cllimit: 'max', tllimit: 'max' }, (p) => {
      const e = pages[p.title] || (pages[p.title] = { cats: new Set(), tpls: new Set() });
      for (const c of p.categories || []) e.cats.add(c.title.replace(/^Category:/, ''));
      for (const t of p.templates || []) e.tpls.add(t.title.replace(/^Template:/, ''));
    });
    return pages;
  }

  // files: array of file names (without "File:"). Returns {file -> {url, thumb, w, h}}
  async imageUrls(fileNames, width = 64) {
    const names = [...new Set(fileNames.filter(Boolean).map(f => normTitle(f.replace(/^(File|Image):/i, ''))))];
    const byTitle = {};
    const redirects = await this._batched(names.map(n => 'File:' + n), { prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: String(width), redirects: '1' }, (p) => {
      const ii = p.imageinfo?.[0];
      if (ii) byTitle[p.title] = { url: ii.url, thumb: ii.thumburl || ii.url, w: ii.width, h: ii.height };
    });
    const out = {};
    for (const n of names) {
      let t = 'File:' + n, g = 0;
      while (redirects[t] && g++ < 5) t = redirects[t];
      if (byTitle[t]) out[n] = byTitle[t];
    }
    return out;
  }

  async parseSection(page, sectionIndex) {
    const j = await this.api({ action: 'parse', page, prop: 'text|sections', section: String(sectionIndex), disablelimitreport: '1', disableeditsection: '1' });
    return j.parse;
  }
}
