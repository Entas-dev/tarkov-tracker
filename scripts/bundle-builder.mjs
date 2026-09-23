// Concatenate builder modules into one classic script (for testing via injection)
import fs from 'fs';
const order = ['wikitext.js','wiki.js','parse.js','build.js'];
let out = '(()=>{\n';
for (const f of order) {
  let s = fs.readFileSync(new URL('../builder/' + f, import.meta.url), 'utf8');
  s = s.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  s = s.replace(/^export\s+(async\s+function|function|class|const|let)/gm, '$1');
  out += `// ---- ${f}\n` + s + '\n';
}
out += 'window.__B = { buildDataset, Wiki, parseQuest, parseStoryChapter, parseHideout, parsePrestige, parseBattlePass, parseAchievements, parseEvents, classifyPage, tables, links, plain, inlineHtml, sectionList, bulletTree, templates, infobox };\n})();\n';
fs.writeFileSync(process.argv[2] || '/tmp/builder.bundle.js', out);
console.log('bytes', out.length);
