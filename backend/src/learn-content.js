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
  (parsed.chapters || []).forEach((c) => byChapter.set(c.cluster_id, c));
  _cache = {
    source: parsed.source,
    generatedAt: parsed.generatedAt,
    chapters: parsed.chapters || [],
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

module.exports = { loadLecture, getChapterLecture, getLectureCss, getLectureMeta };
