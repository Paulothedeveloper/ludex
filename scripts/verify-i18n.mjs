// Verifica que toda string literal passada a t("...") nos arquivos-fonte existe
// no dicionário (ludexI18n.js) com os 5 idiomas-alvo (en/es/fr/zh/ru).
import fs from "fs";
import path from "path";

const root = path.resolve(".");
const dictSrc = fs.readFileSync(path.join(root, "src/ludexI18n.js"), "utf8");

// 1) Extrai as chaves do dicionário + quais idiomas cada uma tem.
// Formato: "CHAVE": { en: "...", es: "...", fr: "...", zh: "...", ru: "..." },
const LANGS = ["en", "es", "fr", "zh", "ru"];
// des-escapa o literal JS pro texto real (precisa nos DOIS lados — dict e t()).
const unescape = (s) => s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
const dict = {};
// pega cada entrada "key": { ... }  (linha a linha — robusto a CRLF)
const lineRe = /^\s{2}"((?:[^"\\]|\\.)*)":\s*\{(.*)\},?\s*$/;
for (const line of dictSrc.split(/\r?\n/)) {
  const m = lineRe.exec(line);
  if (!m) continue;
  const key = unescape(m[1]);
  const body = m[2];
  dict[key] = LANGS.filter((l) => new RegExp(`(^|[\\s{,])${l}:\\s*"`).test(body));
}

// 2) Extrai t("...") / t('...') dos arquivos fonte.
const files = fs.readdirSync(path.join(root, "src"))
  .filter((f) => /\.(jsx?|tsx?)$/.test(f))
  .map((f) => path.join(root, "src", f));

const tCallRe = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;
const tCallReS = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;

const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  let mm;
  while ((mm = tCallRe.exec(src)) !== null) used.add(unescape(mm[1]));
  while ((mm = tCallReS.exec(src)) !== null) used.add(mm[1]);
}

// 3) Compara. PT é a própria chave (fallback), então só checamos os 5 alvos.
const missingKey = [];
const incomplete = [];
for (const s of used) {
  if (!s || s.length < 2) continue;
  if (!(s in dict)) { missingKey.push(s); continue; }
  const have = dict[s];
  const miss = LANGS.filter((l) => !have.includes(l));
  if (miss.length) incomplete.push(`${s}  [falta: ${miss.join(",")}]`);
}

console.log(`Chaves no dicionário: ${Object.keys(dict).length}`);
console.log(`Strings t() usadas:   ${used.size}`);
console.log(`SEM entrada no dict:  ${missingKey.length}`);
console.log(`Incompletas (faltam idiomas): ${incomplete.length}`);
if (missingKey.length) { console.log("\n--- SEM ENTRADA ---"); missingKey.slice(0, 60).forEach((s) => console.log("  · " + JSON.stringify(s))); }
if (incomplete.length) { console.log("\n--- INCOMPLETAS ---"); incomplete.slice(0, 60).forEach((s) => console.log("  · " + s)); }
if (!missingKey.length && !incomplete.length) console.log("\n✅ 100% — toda string t() tem entrada completa nos 5 idiomas.");
