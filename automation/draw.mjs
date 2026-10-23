import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: npm run draw -- input.json');
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const url = input.url ?? 'https://tsukiyo-arcana.pages.dev/creative';
const question = input.question?.trim();
if (!question || [...question].length > 300) throw new Error('question must contain 1–300 characters');
if (!/^https:\/\/tsukiyo-arcana\.pages\.dev\/creative\/?$/.test(url)) throw new Error('Unexpected origin/path');
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'ja-JP' });
const page = await context.newPage();
let clicked = false;
const log = { executed_at: new Date().toISOString(), url, mode: '本格', reversals: true, question, draw_count: 0, status: 'failed', cards: null, reading: null };
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // The approved creative page may use labels different from salon.html.
  // Fail closed on missing controls rather than guess or silently simulate a draw.
  const serious = page.getByRole('button', { name: '本格', exact: true });
  const three = page.getByRole('button', { name: /3枚/ });
  const questionBox = page.locator('textarea').first();
  const reverse = page.getByRole('checkbox', { name: /逆位置/ });
  const draw = page.getByRole('button', { name: 'カードを引く', exact: true });
  await serious.waitFor({ state: 'visible', timeout: 15000 });
  await serious.click();
  await three.click();
  await questionBox.fill(question);
  if (await reverse.count()) {
    if (!(await reverse.isChecked())) await reverse.check();
  } else throw new Error('Reverse-position setting not found');
  if (await draw.count() !== 1 || !(await draw.isEnabled())) throw new Error('Draw control not ready');
  await page.screenshot({ path: 'artifacts/before.png', fullPage: true });
  // Only this single click is permitted. Never click retry/reshuffle.
  clicked = true;
  log.draw_count = 1;
  await draw.click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'artifacts/after.png', fullPage: true });
  const body = await page.locator('body').innerText();
  log.reading = body.slice(0, 20000);
  // Conservatively require all three layout labels and orientations from real DOM.
  const labels = ['過去', '現在', '未来'];
  const cardNames = ['愚者','魔術師','女教皇','女帝','皇帝','教皇','恋人','戦車','力','隠者','運命の輪','正義','吊るされた男','死神','節制','悪魔','塔','星','月','太陽','審判','世界'];
  const sections = {};
  for (let i=0; i<labels.length; i++) {
    const start = body.indexOf(labels[i]);
    const end = i<2 ? body.indexOf(labels[i+1],start+labels[i].length) : Math.min(body.length,start+1200);
    const part = start>=0 ? body.slice(start,end>start?end:start+1200) : '';
    const name = cardNames.find(n => part.includes(n));
    const orientation = part.match(/逆位置|正位置/)?.[0];
    if (!name || !orientation) throw new Error('Cannot verify three card outcomes from rendered text; inspect screenshot/reading');
    sections[labels[i]] = { name, orientation };
  }
  log.cards = sections;
  log.status = 'verified';
} catch(e) {
  log.error = String(e?.message || e);
  log.status = clicked ? 'drawn_unverified' : 'failed_before_draw';
  try { await page.screenshot({ path:'artifacts/error.png', fullPage:true }); } catch {}
} finally {
  await writeFile('artifacts/result.json',JSON.stringify(log,null,2));
  await browser.close();
}
console.log(JSON.stringify({status:log.status,draw_count:log.draw_count,cards:log.cards,error:log.error}));
if(log.status!=='verified') process.exitCode=1;
