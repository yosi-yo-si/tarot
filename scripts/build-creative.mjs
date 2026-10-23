import { readFileSync, writeFileSync } from "node:fs";
const source = readFileSync(new URL("../salon.html", import.meta.url), "utf8");
const page = source
  .replace('<html lang="ja">', '<html lang="ja" data-creative="true">')
  .replace('<title>大アルカナ占い</title>', '<title>月夜のアルカナ｜物語のアトリエ</title>\n<meta name="robots" content="noindex,nofollow">')
  .replace('<h1>大アルカナ占い</h1>', '<h1>物語のアトリエ</h1>')
  .replace('<span class="sub">Major Arcana</span>', '<span class="sub">月夜のアルカナ · Creative</span>')
  .replace('  <main>', '  <p class="lead">架空の人物の相談から、過去・現在・未来の物語を。合言葉は不要です。</p>\n  <main>')
  .replace('相談したいこと(任意)', '架空の人物の相談（必須）')
  .replace('例:仕事を変えるか迷っています', '例：父の食堂を継いだ主人公。新しい料理を出したいのに、常連さんの反応が怖い。')
  .replace('<textarea id="qIn"', '<textarea required id="qIn"');
writeFileSync(new URL("../creative.html", import.meta.url), page);
