#!/usr/bin/env node
/**
 * 从「信息技术学测考点精讲.html」抽取讲义内容，生成后端可用的结构化数据。
 *
 * 产物：
 *   backend/src/learn-content/lecture.json
 *     {
 *       source: '信息技术学测考点精讲.html',
 *       generatedAt: '...',
 *       chapters: [
 *         { cluster_id, code, part, part_index, cn, title, badge, html }
 *       ]
 *     }
 *
 * 说明：
 *   - html 只保留 <section class="chap" …>…</section> 的**内部**内容（去掉 section 外壳与 chap-h 标题行，
 *     标题由前端按词表渲染），外层包一个 <div class="xs-lecture"> 便于前端给 CSS 变量作用域。
 *   - 讲义自带 CSS 单独抽到 lecture.css，前端直接 import，改为作用域到 .xs-lecture 下。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// 讲义源文件（教师维护的考点精讲手册，改动后需重跑本脚本）
const SRC = path.join(ROOT, 'backend', 'database', 'learn-source', '信息技术学测考点精讲.html');
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'learn-content');

// 讲义 id（section 的 id 属性）→ 词表 cluster_id 一级（章）
const ID_TO_CLUSTER = {
  d1: '数据与信息',
  d2: '数据编码',
  d3: '数据获取与表达',
  d4: '人工智能',
  a1: '算法与问题解决',
  a2: '程序设计语言的基本知识',
  a3: '算法的程序实现',
  a4: '函数及其应用',
  a5: '经典算法应用',
  i1: '信息系统概述',
  i2: '信息系统的支撑技术',
  i3: '信息系统的设计与开发',
  i4: '信息系统的安全',
  s1: '信息技术发展及其影响',
  s2: '信息社会及其特征',
  s3: '信息社会伦理道德与法律法规',
};

// 四大部分
const PART_NAMES = {
  '必修一 · 数据': { part: '必修一 · 数据', partIndex: 1 },
  '必修一 · 算法程序': { part: '必修一 · 算法与程序', partIndex: 2 },
  '必修二 · 信息系统': { part: '必修二 · 信息系统', partIndex: 3 },
  '必修二 · 信息社会': { part: '必修二 · 信息社会', partIndex: 4 },
};

const SCOPE = '.xs-lecture';
// 讲义本身是整页文档，含 body/header/aside/footer/#top 等全局选择器，
// 直接塞进学生会污染全局。这里把选择器逐个前缀到 .xs-lecture 下。
// 但以下「装饰性/弃用」选择器整段丢弃（对应元素我们不会渲染）。
const DROP_SELECTORS = [
  /^html\b/, /^body\b/, /^#prog\b/, /^header\b/, /^\.hd\b/, /^\.logo\b/,
  /^\.sbox\b/, /^#menuBtn\b/, /^\.wrap\b/, /^aside\b/, /^\.tree\b/,
  /^\.hero\b/, /^\.howto\b/, /^\.part\b/, /^\.part-h\b/, /^footer\b/, /^#top\b/,
  /^\.chap-h\b/, /^section\.chap\b/, /^main\b/,
  // 顶部搜索下拉框残留（学习模块不用讲义自带搜索）
  /^\.res\b/, /^\.meta\b/,
];

/** 把一段 CSS 的所有规则选择器加上 .xs-lecture 前缀（支持 @media / @keyframes） */
function scopeCss(css) {
  // 先去掉注释，避免干扰解析
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < cleaned.length) {
    // 找到下一个 '{'
    const braceIdx = cleaned.indexOf('{', i);
    if (braceIdx === -1) break;
    const rawSel = cleaned.slice(i, braceIdx).trim();
    // 找匹配的右括号（支持嵌套一层）
    let depth = 1;
    let j = braceIdx + 1;
    while (j < cleaned.length && depth > 0) {
      if (cleaned[j] === '{') depth++;
      else if (cleaned[j] === '}') depth--;
      j++;
    }
    const body = cleaned.slice(braceIdx + 1, j - 1);

    if (rawSel.startsWith('@media') || rawSel.startsWith('@supports')) {
      out.push(`${rawSel}{\n${scopeCss(body)}\n}`);
    } else if (rawSel === ':root') {
      // 讲义的颜色变量改成 .xs-lecture 作用域，避免污染全局 :root
      out.push(`${SCOPE}{${body}}`);
    } else if (rawSel.startsWith('@')) {
      // @keyframes / @font-face 等原样保留
      out.push(`${rawSel}{${body}}`);
    } else {
      const kept = rawSel
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .filter(s => !DROP_SELECTORS.some(re => re.test(s)))
        .map(s => (s.includes(SCOPE) ? s : `${SCOPE} ${s}`));
      if (kept.length === 0) { i = j; continue; }
      out.push(`${kept.join(',')}{${body}}`);
    }
    i = j;
  }
  return out.join('\n');
}

function main() {
  const raw = fs.readFileSync(SRC, 'utf8');

  // 1. 抽 CSS 并做作用域隔离
  const styleMatch = raw.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleMatch) throw new Error('未找到 <style>');
  const css = scopeCss(styleMatch[1]);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'lecture.css'), css.trim() + '\n', 'utf8');

  // 2. 逐章抽 section
  const chapters = [];
  const secRe = /<section class="chap" id="([^"]+)" data-cn="([^"]*)">([\s\S]*?)<\/section>/g;
  let m;
  while ((m = secRe.exec(raw)) !== null) {
    const [, id, dataCn, inner] = m;
    const clusterId = ID_TO_CLUSTER[id];
    if (!clusterId) {
      console.warn(`[warn] section id=${id} 不在词表映射中，跳过`);
      continue;
    }
    const partMeta = PART_NAMES[dataCn] || { part: dataCn, partIndex: 0 };

    // 抽 chap-h 里的中文序号 / 标题 / badge
    const chapH = inner.match(/<div class="chap-h">([\s\S]*?)<\/div>/);
    let cn = '';
    let title = '';
    let badge = '';
    if (chapH) {
      const cnM = chapH[1].match(/<span class="cn">([^<]*)<\/span>/);
      const tM = chapH[1].match(/<h3>([\s\S]*?)<\/h3>/);
      const bM = chapH[1].match(/<span class="badge">([\s\S]*?)<\/span>/);
      cn = cnM ? cnM[1].trim() : '';
      title = tM ? tM[1].trim() : '';
      badge = bM ? bM[1].trim() : '';
    }

    // 去掉 chap-h，保留其余正文
    let body = inner.replace(/<div class="chap-h">[\s\S]*?<\/div>\s*/, '');
    body = body.trim();
    // 去掉最外层 <div class="card"> 包裹？保留 —— 讲义样式依赖 .card
    const html = `<div class="xs-lecture">\n${body}\n</div>`;

    chapters.push({
      cluster_id: clusterId,
      code: id,
      cn,
      title,
      badge,
      part: partMeta.part,
      part_index: partMeta.partIndex,
      html,
    });
  }

  // 3. 按词表顺序排序
  let { CHAPTER_NAMES } = require(path.resolve(__dirname, '..', 'src', 'chapter-taxonomy.js'));
  const order = new Map(CHAPTER_NAMES.map((n, i) => [n, i]));
  chapters.sort((a, b) => (order.get(a.cluster_id) ?? 999) - (order.get(b.cluster_id) ?? 999));

  const missing = CHAPTER_NAMES.filter(n => !chapters.some(c => c.cluster_id === n));
  if (missing.length) console.warn('[warn] 以下章未抽到讲义：', missing.join('、'));

  const out = {
    source: '信息技术学测考点精讲.html',
    generatedAt: new Date().toISOString(),
    chapters,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'lecture.json'),
    JSON.stringify(out, null, 2),
    'utf8'
  );

  console.log(`[ok] 抽出 ${chapters.length} 章讲义 -> src/learn-content/lecture.json`);
  chapters.forEach(c => {
    console.log(`     ${String(order.get(c.cluster_id) + 1).padStart(2, '0')}. ${c.cluster_id.padEnd(16, '　')} ${c.cn} ${c.title}  (${(c.html.length / 1024).toFixed(1)}KB)`);
  });
  console.log(`[ok] CSS -> src/learn-content/lecture.css (${(css.length / 1024).toFixed(1)}KB)`);
}

main();
