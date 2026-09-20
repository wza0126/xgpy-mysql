/**
 * 学习模块讲义内容加载器
 *
 * 数据来源：scripts/extract-learn-content.js 从「信息技术学测考点精讲.html」抽取的
 *   - lecture.json  （16 章 HTML 正文，按词表 chapter-taxonomy.js 的 16 章对齐）
 *   - lecture.css   （讲义样式，已作用域到 .xs-lecture，可安全全局引入）
 *
 * 设计要点：
 *  - 纯静态资源，启动时一次性载入内存（约 100KB），请求零 IO。
 *  - lecture.css 由后端通过 /api/student/learn-lecture.css 下发（也便于 pkg 打包后仍可读）。
 *  - 章节正文以 cluster_id（一级=章名）为键，与题库聚类、练习筛选共用同一套词表。
 *
 * 【重要】讲义内容有更新时：
 *   1. 修改 backend/database/learn-source/信息技术学测考点精讲.html
 *   2. 在 backend/ 下跑 `node scripts/extract-learn-content.js`
 *   3. 重启后端
 */
const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, 'learn-content');
const JSON_PATH = path.join(CONTENT_DIR, 'lecture.json');
const CSS_PATH = path.join(CONTENT_DIR, 'lecture.css');

let _cache = null;

function loadLecture() {
  if (_cache) return _cache;
  const raw = fs.readFileSync(JSON_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const byChapter = new Map();
  (parsed.chapters || []).forEach((c) => byChapter.set(c.cluster_id, c));
  _cache = {
    source: parsed.source,
    generatedAt: parsed.generatedAt,
    chapters: parsed.chapters || [],
    byChapter,
  };
  return _cache;
}

function getChapterLecture(chapterName) {
  const data = loadLecture();
  return data.byChapter.get(chapterName) || null;
}

function getLectureCss() {
  return fs.readFileSync(CSS_PATH, 'utf8');
}

/** 讲义元信息（不含正文，用于前端首屏判断） */
function getLectureMeta() {
  const data = loadLecture();
  return {
    source: data.source,
    generatedAt: data.generatedAt,
    count: data.chapters.length,
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
