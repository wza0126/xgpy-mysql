/**
 * 学习模块讲义内容加载器
 *
 * 数据来源：scripts/extract-learn-content.js 从「信息技术学测考点精讲.html」抽取的
 *   - lecture.json  （16 章 HTML 正文，按词表 chapter-taxonomy.js 的 16 章对齐）
 *   - lecture.css   （讲义样式，已作用域到 .xs-lecture，可安全全局引入）
 *
 * 设计要点：
 *  - 纯静态资源，启动时一次性载入内存（约 100KB），请求零 IO。
 *  - lecture.css 由后端通过 /api/student/learn-lecture.css 下发。
 *  - 章节正文以 cluster_id（一级=章名）为键，与题库聚类、练习筛选共用同一套词表。
 *
 * 【重要】pkg 打包（exe）约束：
 *   pkg 的 snapshot 文件系统只包含「被打进包的」文件。数据文件（.json/.css）必须在
 *   backend/package.json 的 pkg.assets 里显式声明，否则运行时报
 *   「was not included into executable at compilation stage」。
 *   → 已在 pkg.assets 加上 "src/learn-content/**\/*"；新增其它数据文件时同样要登记。
 *   → 另外 pkg 会把 assets 解包到 process.pkg 的快照里，fs 读取需走同一路径。
 *
 * 【重要】讲义内容有更新时：
 *   1. 修改 backend/database/learn-source/信息技术学测考点精讲.html
 *   2. 在 backend/ 下跑 `node scripts/extract-learn-content.js`
 *   3. 重启后端
 */
const fs = require('fs');
const path = require('path');
const {
  computeChapterAnchors,
  anchorId,
  ANCHOR_ID_PREFIX,
} = require('./lecture-anchors.js');
const { SECTIONS_BY_CHAPTER } = require('./chapter-taxonomy.js');

/** 候选目录：本地源码目录 + pkg 快照内的同位置（打包后 __dirname 仍在快照内） */
const CONTENT_DIRS = [
  path.join(__dirname, 'learn-content'),
];

/** 兜底目录：打包后若未打进 assets，退回 exe 同级目录（便于手工放文件） */
if (process.pkg) {
  CONTENT_DIRS.push(path.join(path.dirname(process.execPath), 'learn-content'));
}

function findFile(name) {
  for (const dir of CONTENT_DIRS) {
    const p = path.join(dir, name);
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* 快照内可能抛错，忽略 */ }
  }
  return null;
}

let _cache = null;
let _cssCache = null;

/**
 * 把某章的锚点注入讲义 HTML。
 *
 * 为什么要在后端注入（而不是前端渲染后 DOM 操作）：
 *   - 左侧目录、右侧「去练习」按钮都用 `document.getElementById('sec-<小节名>')`
 *     做跳转；DOM 注入在 React 重渲染（dangerouslySetInnerHTML）时会被整体抹掉，
 *     必须每次渲染后重跑，容易漏。后端注入则一次到位、随 html 一起下发。
 *   - 讲义小节标题与词表小节名对不齐（见 lecture-anchors.js 注释），
 *     映射关系需要放在后端统一维护。
 *
 * 幂等：已经在 html 里出现过的 id 不再重复注入（同一 html 被二次处理时安全）。
 * 不报错：任何小节定位失败都只记 warning，学习模块仍应正常显示讲义全文。
 */
function injectSectionAnchors(chapterName, html) {
  if (!html || typeof html !== 'string') return html;
  const sections = SECTIONS_BY_CHAPTER[chapterName];
  if (!sections || !sections.length) return html;

  const already = new Set();
  const idRe = new RegExp(`id="${ANCHOR_ID_PREFIX}[^"]*"`, 'g');
  let im;
  while ((im = idRe.exec(html)) !== null) already.add(im[0].slice(4, -1));

  const { headings, map, issues } = computeChapterAnchors(chapterName, html, sections);
  for (const it of issues) {
    if (it.kind === 'no-heading') {
      console.warn(`[learn-content] ${chapterName} / ${it.section}：${it.message}`);
    }
  }

  // 同一个标题可能被多个小节指向（如「数据」被「数据、信息与知识的概念」占用）；
  // 一个标题上只挂第一个小节锚点，其余小节则把锚点插到该标题**之前**的空锚上，
  // 保证 70 个小节全都有独立可跳转的 id（前端按钮按小节名取 id，不会互相覆盖）。
  const usedHeading = new Map();        // heading.index -> 已挂的小节名
  const inserts = [];                   // { at, html }
  for (const sec of sections) {
    const info = map[sec];
    if (!info || info.index < 0) continue;
    const id = anchorId(sec);
    if (already.has(id)) continue;
    const head = headings[info.index];
    if (!head) continue;

    if (!usedHeading.has(info.index)) {
      usedHeading.set(info.index, sec);
      // 插到开标签的 '>' **之前**（openEnd 指向 '>' 之后一位，所以 -1）
      inserts.push({ at: head.openEnd - 1, html: id, kind: 'id' });
    } else {
      // 该标题已被别的小节占用 → 在标题标签之前插一个零高度 span 作为锚
      inserts.push({
        at: head.openStart,
        html: `<span id="${id}" class="xs-anchor" aria-hidden="true"></span>`,
        kind: 'span',
        before: true,
      });
    }
  }

  if (!inserts.length) return html;

  // 按插入点倒序处理，避免下标错位
  inserts.sort((a, b) => b.at - a.at);
  let out = html;
  for (const ins of inserts) {
    if (ins.kind === 'id') {
      const open = out.slice(0, ins.at);
      const rest = out.slice(ins.at);
      // open 形如 '<h4 class="h"'（已停在 '>' 之前），补上 id 再拼回 '>' 及其后内容
      out = `${open} id="${ins.html}"${rest}`;
    } else {
      out = out.slice(0, ins.at) + ins.html + out.slice(ins.at);
    }
  }
  return out;
}

function loadLecture() {
  if (_cache) return _cache;
  const jsonPath = findFile('lecture.json');
  if (!jsonPath) {
    // 不抛错：讲义缺失时学习模块应仍可显示目录与练习入口
    console.error('[learn-content] 未找到 lecture.json，讲义正文将不可用。' +
      '（exe 环境请确认 pkg.assets 已包含 src/learn-content/**）');
    _cache = { source: null, generatedAt: null, chapters: [], byChapter: new Map(), missing: true };
    return _cache;
  }
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  const byChapter = new Map();
  (parsed.chapters || []).forEach((c) => {
    // 【重要】锚点在后端注入（见 injectSectionAnchors 注释）：
    // 讲义原文一个 id 都没有，而左侧目录 / 小节「去练习」都要靠 id 跳转。
    byChapter.set(c.cluster_id, {
      ...c,
      html: injectSectionAnchors(c.cluster_id, c.html),
    });
  });
  _cache = {
    source: parsed.source,
    generatedAt: parsed.generatedAt,
    chapters: Array.from(byChapter.values()),
    byChapter,
    missing: false,
  };
  return _cache;
}

function getChapterLecture(chapterName) {
  const data = loadLecture();
  return data.byChapter.get(chapterName) || null;
}

function getLectureCss() {
  if (_cssCache !== null) return _cssCache;
  const cssPath = findFile('lecture.css');
  if (!cssPath) {
    console.error('[learn-content] 未找到 lecture.css，讲义将没有样式。');
    _cssCache = '';
    return _cssCache;
  }
  _cssCache = fs.readFileSync(cssPath, 'utf8');
  return _cssCache;
}

/**
 * 某章「所有已注入到讲义里的锚点 id」集合。
 *
 * 用途：`/api/student/learn-chapters`（目录接口）只下发章节目录、不返回 html，
 * 但前端「去练习」按钮同样需要 anchor 才能滚动跳转。为免把整章讲义塞进目录响应，
 * 这里只回传锚点 id 集合，目录接口按小节名拼 id 后判断「是否真的存在于讲义里」。
 *
 * @param {string} chapterName 章名
 * @returns {Set<string>} 锚点 id 集合（讲义缺失时为空集）
 */
function getChapterAnchorIds(chapterName) {
  const lec = getChapterLecture(chapterName);
  if (!lec || !lec.html) return new Set();
  const ids = new Set();
  const re = new RegExp(`id="(${ANCHOR_ID_PREFIX}[^"]*)"`, 'g');
  let m;
  while ((m = re.exec(lec.html)) !== null) ids.add(m[1]);
  return ids;
}

/** 讲义元信息（不含正文，用于前端首屏判断） */
function getLectureMeta() {
  const data = loadLecture();
  return {
    source: data.source,
    generatedAt: data.generatedAt,
    count: data.chapters.length,
    missing: !!data.missing,
    chapters: data.chapters.map((c) => ({
      cluster_id: c.cluster_id,
      code: c.code,
      cn: c.cn,
      badge: c.badge,
      part: c.part,
      part_index: c.part_index,
    })),
  };
}

module.exports = { loadLecture, getChapterLecture, getChapterAnchorIds, getLectureCss, getLectureMeta };
