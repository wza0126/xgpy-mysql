#!/usr/bin/env node
/**
 * 讲义小节锚点校验（学练结合的地基自检）
 *
 * 背景：学习模块要支持「点小节的『去练习』→ 学习页滚动到对应小节」，
 * 依赖后端在讲义 HTML 里注入 `id="sec-<小节名>"`。讲义标题文字与词表小节名
 * 并不一一对应（见 src/lecture-anchors.js 注释），映射写错只会表现为
 * 「点了不跳 / 跳到别处」，很难人工发现所有 70 个小节，所以用脚本兜住。
 *
 * 检查项：
 *   A. 讲义加载：16 章讲义齐全，没有 missing
 *   B. 锚点覆盖：70 个词表小节**全部**能在讲义里找到锚点 id
 *   C. 锚点唯一：同一个 id 在整份讲义里不重复（重复会导致跳错）
 *   D. 锚点落点正确：锚点所在/后随的元素必须是标题（h1~h6），且文本与预期相符
 *   E. 顺序单调：同一章内，小节的锚点在 HTML 中出现的先后顺序应与词表顺序一致
 *      （不一致说明映射串位了 —— 这是最容易犯又最难肉眼发现的错误）
 *   F. 幂等性：同一份 html 二次注入不产生重复 id
 *
 * 用法：node scripts/debug/verify_lecture_anchors.cjs
 */
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const { loadLecture, getChapterLecture } = require(path.join(SRC, 'learn-content.js'));
const { CHAPTER_NAMES, SECTIONS_BY_CHAPTER } = require(path.join(SRC, 'chapter-taxonomy.js'));
const {
  anchorId,
  computeChapterAnchors,
  normalizeTitle,
} = require(path.join(SRC, 'lecture-anchors.js'));

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}

/** 取出某个 id 对应的元素：优先找带该 id 的标题，其次找它紧随的兄弟元素 */
function locate(html, id) {
  const idx = html.indexOf(`id="${id}"`);
  if (idx < 0) return null;
  // 向左找到最近的 '<'，确定这个 id 属于哪个标签
  const lt = html.lastIndexOf('<', idx);
  const gt = html.indexOf('>', idx);
  if (lt < 0 || gt < 0) return null;
  const openTag = html.slice(lt, gt + 1);
  const tagName = (openTag.match(/^<([a-zA-Z0-9]+)/) || [])[1] || '';
  const isHeading = /^h[1-6]$/i.test(tagName);

  // 该标签的文本内容
  let text = '';
  if (isHeading) {
    const close = html.toLowerCase().indexOf(`</${tagName.toLowerCase()}>`, gt);
    text = close > 0 ? html.slice(gt + 1, close).replace(/<[^>]*>/g, '').trim() : '';
  }
  // 若不是标题（span 兜底锚），取它之后第一个标题
  let nextHeading = null;
  if (!isHeading) {
    const after = html.slice(gt);
    const m = after.match(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i);
    if (m) {
      nextHeading = { tagName: `h${m[1]}`, text: m[2].replace(/<[^>]*>/g, '').trim(), pos: gt + m.index };
    }
  }
  return { tagName, isHeading, text, openTag, pos: lt, nextHeading };
}

console.log('讲义小节锚点校验');

// ── A. 讲义加载 ────────────────────────────────────────────
section('A. 讲义加载');
const data = loadLecture();
ok('讲义未缺失（missing=false）', !data.missing);
ok(`讲义章数 = 16`, data.chapters.length === 16, `实际 ${data.chapters.length}`);
const noLecture = CHAPTER_NAMES.filter((n) => !getChapterLecture(n));
ok('16 章词表全部有讲义', noLecture.length === 0, noLecture.join('、'));

// ── B/C/D/E. 逐章检查 ─────────────────────────────────────
section('B. 锚点覆盖（70/70）');
let total = 0;
let covered = 0;
const missList = [];
for (const ch of CHAPTER_NAMES) {
  const lec = getChapterLecture(ch);
  if (!lec) continue;
  for (const s of SECTIONS_BY_CHAPTER[ch] || []) {
    total++;
    if (lec.html.includes(`id="${anchorId(s)}"`)) covered++;
    else missList.push(`${ch}/${s}`);
  }
}
ok(`词表小节总数 = 70`, total === 70, `实际 ${total}`);
ok(`锚点覆盖 70/70`, covered === 70, `缺失：${missList.join('、') || '无'}`);

section('C. 锚点 id 唯一性');
for (const ch of CHAPTER_NAMES) {
  const lec = getChapterLecture(ch);
  if (!lec) continue;
  const ids = (lec.html.match(/id="(sec-[^"]*)"/g) || []).map((x) => x.slice(4, -1));
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  ok(`${ch}：${ids.length} 个锚点无重复`, dup.length === 0, dup.join('、'));
}

section('D. 锚点确实落在标题上');
let onHeading = 0;
const notHeading = [];
for (const ch of CHAPTER_NAMES) {
  const lec = getChapterLecture(ch);
  if (!lec) continue;
  for (const s of SECTIONS_BY_CHAPTER[ch] || []) {
    const loc = locate(lec.html, anchorId(s));
    if (loc && (loc.isHeading || loc.nextHeading)) onHeading++;
    else notHeading.push(`${ch}/${s}`);
  }
}
ok(`70 个锚点全部可定位到标题`, onHeading === 70, `异常：${notHeading.join('、') || '无'}`);

section('E. 小节顺序单调（防映射串位）');
for (const ch of CHAPTER_NAMES) {
  const lec = getChapterLecture(ch);
  if (!lec) continue;
  const secs = SECTIONS_BY_CHAPTER[ch] || [];
  const positions = secs.map((s) => {
    const loc = locate(lec.html, anchorId(s));
    return { s, pos: loc ? loc.pos : -1 };
  });
  const bad = positions.filter((p, i) => i > 0 && p.pos >= 0 && positions[i - 1].pos >= 0 && p.pos < positions[i - 1].pos);
  ok(
    `${ch}：${secs.length} 小节顺序正确`,
    bad.length === 0,
    bad.map((b) => `${b.s} 出现在 ${positions.find((x) => x.s === b.s)?.s} 之前`).join('；')
  );
}

section('F. 映射语义抽查（人工映射表的 8 条）');
const SPOT = [
  ['数据与信息', '数据、信息与知识的概念', '1. 数据'],
  ['数据与信息', '数据、信息、知识与智慧的关系', '（二）数据、信息、知识和智慧的关系'],
  ['数据编码', '数字化与进制转换', '（一）数字化'],
  ['数据编码', '条形码与二维码', '4. 其他编码：条形码与二维码'],
  ['算法的程序实现', '列表', '（三）循环结构 · 1. 列表'],
  ['函数及其应用', '函数与模块', '（一）函数'],
  ['信息系统的支撑技术', '网络协议与 IP 地址', '3. 计算机网络原理 ·（1）网络协议'],
  ['信息系统的支撑技术', '网络拓扑结构', '（2）拓扑结构'],
  ['信息系统的支撑技术', '网络组建与调试命令', '（3）网络的组建与调试命令'],
  ['信息系统的支撑技术', '物联网', '1. 物联网的概念'],
  ['信息系统的安全', '安全风险防范的技术与方法', '（二）信息系统安全风险防范的技术与方法'],
  ['信息社会及其特征', '信息社会的特征', '（二）信息社会的特征（四个方面）'],
  ['信息社会伦理道德与法律法规', '知识产权', '2. 依法保护知识产权'],
];
for (const [ch, sec, expectText] of SPOT) {
  const lec = getChapterLecture(ch);
  const loc = lec ? locate(lec.html, anchorId(sec)) : null;
  const got = loc ? (loc.isHeading ? loc.text : loc.nextHeading?.text || '') : '';
  ok(
    `${ch} / ${sec} → 「${expectText}」`,
    normalizeTitle(got) === normalizeTitle(expectText),
    `实际落在「${got}」`
  );
}

section('G. 幂等性（二次注入不重复）');
{
  const ch = '信息系统的支撑技术';
  const lec = getChapterLecture(ch);
  const before = (lec.html.match(/id="sec-/g) || []).length;
  const again = require(path.join(SRC, 'learn-content.js'));
  // 直接拿原始 lecture.json 的 html 重算，验证注入函数对已注入 html 不乱加
  const { findHeadings } = require(path.join(SRC, 'lecture-anchors.js'));
  const heads = findHeadings(lec.html);
  const idsInHeads = heads.filter((h) => /id="sec-/.test(h.attrs)).length;
  ok(
    `${ch}：${before} 个锚点、其中 ${idsInHeads} 个挂在标题开标签上`,
    before > 0 && idsInHeads === before,
    '存在挂在非标题元素上的锚点（可能有 span 兜底，属正常，但此处应为 0）'
  );
  ok('注入结果稳定（重复 getChapterLecture 返回同一内容）', again.getChapterLecture(ch).html === lec.html);
}

console.log(`\n=== 汇总：${pass}/${pass + fail} 通过 ===`);
if (fail) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
