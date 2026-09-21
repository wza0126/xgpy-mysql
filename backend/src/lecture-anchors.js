/**
 * 讲义小节锚点映射表（学练结合的地基）
 *
 * 背景
 * ────
 * 学习模块右侧讲义（learn-content/lecture.json）是教师维护的 HTML 正文，**一个 id 都没有**。
 * 而词表 chapter-taxonomy.js 的小节名与讲义里的标题文字**并不一一对应**：
 *   - 编号前缀不同：词表「数据获取」 ↔ 讲义「（一）数据获取」
 *   - 词表 1 节 ↔ 讲义 2 个标题：「数字化与进制转换」= 「（一）数字化」+「1. 进制与数制转换」
 *   - 词表 1 节 ↔ 讲义多个标题：「物联网」= 「1.物联网的概念」等 4 个 h5
 *   - 讲义压根没这节：「数据、信息与知识的概念」在讲义里被拆成「1.数据 / 2.信息 / 3.知识」
 * 所以**不能用标题文本自动匹配**（实测会错 5~18 处），必须在这张表里显式写死。
 *
 * 这张表是「小节 → 讲义锚点」的唯一真相，改讲义后如果跳转不对，只需要改这里。
 *
 * 数据结构
 * ────────
 *   LECTURE_ANCHOR_HINTS[章名][词表小节名] = 锚点规则
 *   锚点规则支持三种形态：
 *     1. 字符串  '（一）数据获取'
 *        → 精确匹配讲义里**文本等于**该串的标题（规范化后比较，忽略空格/大小写）
 *     2. 字符串  且以 '^' 开头，如 '^（三）循环结构 · 1. 列表'
 *        → 同上，只是显式声明「这是精确匹配」，与 contains 区分（可读性用）
 *     3. 数组    ['（一）数字化', '1. 进制与数制转换']
 *        → 该小节在讲义里对应**多个标题**，第一个元素所在标题挂锚点（跳转落点），
 *          其余元素用于**校验它们确实存在**（讲义改版时能立刻发现）
 *   缺省（表里没写）→ 走通用兜底：把词表小节名去编号后与讲义标题文本做精确比较，
 *                     命中即用；命中多个取第一个并记 warning；一个都没命中则视为
 *                     「该小节讲义无对应标题」，不注入锚点（不报错）。
 *
 * 【重要】新增/改名小节时
 *   1. 改 chapter-taxonomy.js 的 SECTIONS_BY_CHAPTER
 *   2. 在这里补一条映射（对不齐的那几节）
 *   3. 跑 node scripts/debug/verify_lecture_anchors.cjs 复验
 */

/** 锚点 id 前缀：注入到讲义标题上的 id 形如 sec-a1b2c3… */
const ANCHOR_PREFIX = 'sec-';

/**
 * 把任意文本规范化，用于标题比对：
 * 去 HTML 标签、去所有空白、去全角/半角标点、转小写。
 */
function normalizeTitle(text) {
  if (text == null) return '';
  return String(text)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '')
    .replace(/[、，。：；！？·\-—_/\\（）()【】\[\]「」“”"'’`~]/g, '')
    .toLowerCase();
}

/**
 * 去编号：把「（一）数据获取」「1. 文本数据的编码」「3. break 与 continue」里的
 * 中文/阿拉伯数字序号前缀剥掉，得到「数据获取」「文本数据的编码」「break与continue」。
 */
function stripNumbering(text) {
  let s = normalizeTitle(text);
  // 形如「一）」「(三)」「2.」「1、」等前缀
  s = s.replace(/^[（(【[]?[0-9一二三四五六七八九十百]+[）)】\].、]?/, '');
  return s;
}

/**
 * 映射表：只登记「靠通用规则对不上」的小节。
 * 通用规则能命中的（大多数，如「数据获取」↔「（一）数据获取」）不必写在这里。
 */
const LECTURE_ANCHOR_HINTS = {
  '数据与信息': {
    // 词表一节的三个概念，在讲义里是三个平级 h4 标题
    '数据、信息与知识的概念': ['1. 数据', '2. 信息', '3. 知识'],
    // 讲义写的是「和」而词表写「与」
    '数据、信息、知识与智慧的关系': '（二）数据、信息、知识和智慧的关系',
  },
  '数据编码': {
    // 词表一节 = 讲义两个 h4
    '数字化与进制转换': ['（一）数字化', '1. 进制与数制转换'],
    '条形码与二维码': '4. 其他编码：条形码与二维码',
  },
  '算法的程序实现': {
    // 讲义把「循环结构 · 1. 列表」写在一个 h4 里，列表内容在该标题之后
    '列表': '（三）循环结构 · 1. 列表',
  },
  '函数及其应用': {
    '函数与模块': ['（一）函数', '（二）模块'],
  },
  '信息系统的支撑技术': {
    // 词表一节「网络协议与 IP 地址」，讲义拆成「网络协议」（在 h5『3. 计算机网络原理 ·（1）网络协议』里）
    // 与「IP 地址（重点）」两个标题 → 跳到协议那段
    '网络协议与 IP 地址': ['3. 计算机网络原理 ·（1）网络协议', 'IP 地址（重点）'],
    '网络拓扑结构': '（2）拓扑结构',
    '网络组建与调试命令': '（3）网络的组建与调试命令',
    // 词表一节「物联网」在讲义里跨 4 个 h5，跳第一个
    '物联网': ['1. 物联网的概念', '2. 物联网的三个技术特征', '3. 物联网的三层结构', '4. 物联网应用的相关技术'],
  },
  '信息系统的安全': {
    '安全风险防范的技术与方法': '（二）信息系统安全风险防范的技术与方法',
  },
  '信息社会及其特征': {
    // 讲义标题多了「（四个方面）」后缀，规范化后仍不等（中文括号被剥但「四个方面」留着）
    '信息社会的特征': '（二）信息社会的特征（四个方面）',
  },
  '信息社会伦理道德与法律法规': {
    // 词表一节「知识产权」在讲义里散落在三个 h5（2. 依法保护知识产权 / 其他与知识产权相关 / 网络与计算机环境中的知识产权）
    '知识产权': ['2. 依法保护知识产权', '其他与知识产权相关', '网络与计算机环境中的知识产权'],
  },
};

/**
 * 在讲义 HTML 里定位所有标题（h1~h6），返回 [{ index, level, text, start, end, innerEnd }]
 * start/end 指向整个 <hN ...>...</hN> 标签；innerEnd 指向开标签 '>' 之后，用于插入 id。
 */
function findHeadings(html) {
  const out = [];
  const re = /<h([1-6])\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const level = Number(m[1]);
    const attrs = m[2] || '';
    const tagName = `h${level}`;
    const closeIdx = html.toLowerCase().indexOf(`</${tagName}>`, re.lastIndex);
    if (closeIdx < 0) continue;
    const inner = html.slice(re.lastIndex, closeIdx);
    out.push({
      index: out.length,
      level,
      attrs,
      raw: html.slice(m.index, closeIdx + tagName.length + 3),
      openStart: m.index,
      openEnd: re.lastIndex,   // 开标签 '>' 之后
      closeStart: closeIdx,
      text: String(inner).replace(/<[^>]*>/g, '').trim(),
      inner,
    });
  }
  return out;
}

/**
 * 解析一节小节的锚点规则，返回命中的标题下标数组（至少 1 个才算命中）。
 * @param {Array} headings  findHeadings 的结果
 * @param {string} section  词表小节名
 * @param {*} rule          映射表里的规则（字符串 / 数组 / undefined）
 * @returns {{ indexes:number[], missing:string[], mode:string }}
 */
function resolveRule(headings, section, rule) {
  const missing = [];
  const byNormalized = (target) => {
    const key = normalizeTitle(target);
    return headings.filter((h) => normalizeTitle(h.text) === key).map((h) => h.index);
  };

  // 显式规则优先
  if (rule != null) {
    const list = Array.isArray(rule) ? rule : [rule];
    const found = [];
    for (const item of list) {
      const target = String(item).replace(/^\^/, '');
      const hits = byNormalized(target);
      if (hits.length) found.push(hits[0]);
      else missing.push(target);
    }
    if (found.length) return { indexes: [found[0]], missing, mode: 'hint' };
    // 显式规则一个都没命中 → 退回通用兜底，但仍报告 missing 供校验脚本报警
    const fallback = resolveGeneric(headings, section);
    return { indexes: fallback, missing, mode: fallback.length ? 'hint-fallback' : 'hint-miss' };
  }

  return { indexes: resolveGeneric(headings, section), missing, mode: 'generic' };
}

/** 通用兜底：去编号后精确比较；再退一步「去编号后包含」 */
function resolveGeneric(headings, section) {
  const key = stripNumbering(section);
  if (!key) return [];
  const exact = headings.filter((h) => stripNumbering(h.text) === key).map((h) => h.index);
  if (exact.length) return [exact[0]];
  const loose = headings
    .filter((h) => {
      const t = stripNumbering(h.text);
      return t.length >= 3 && (t.includes(key) || key.includes(t));
    })
    .map((h) => h.index);
  return loose.length ? [loose[0]] : [];
}

/**
 * 计算某章的「小节 → 标题下标」映射。
 * @param {string} chapterName 章名（词表 cluster_id 一级）
 * @param {string} html        讲义 HTML
 * @param {string[]} sections  该章词表小节名列表（SECTIONS_BY_CHAPTER[chapterName]）
 * @returns {{ chapter:string, headings:Array, map:Object, issues:Array }}
 *   map[小节名] = { index, text, level, matched:'hint'|'generic'|'none', missing:string[] }
 */
function computeChapterAnchors(chapterName, html, sections) {
  const headings = findHeadings(html || '');
  const hints = LECTURE_ANCHOR_HINTS[chapterName] || {};
  const map = {};
  const issues = [];

  for (const sec of sections || []) {
    const isHinted = Object.prototype.hasOwnProperty.call(hints, sec);
    const r = resolveRule(headings, sec, isHinted ? hints[sec] : undefined);
    const idx = r.indexes.length ? r.indexes[0] : -1;
    const head = idx >= 0 ? headings[idx] : null;
    map[sec] = {
      index: idx,
      text: head ? head.text : '',
      level: head ? head.level : 0,
      matched: idx >= 0 ? (isHinted ? 'hint' : r.mode) : 'none',
      missing: r.missing,
    };
    if (idx < 0) {
      issues.push({ section: sec, kind: 'no-heading', message: `讲义中找不到「${sec}」对应的标题` });
    } else if (r.missing.length) {
      issues.push({
        section: sec,
        kind: 'partial',
        message: `「${sec}」部分映射未命中：${r.missing.join(' / ')}`,
      });
    }
  }
  return { chapter: chapterName, headings, map, issues };
}

/**
 * 生成注入用的锚点 id。
 * id 里只放安全字符，避免选择器要转义；前缀固定 sec-。
 */
function anchorId(section) {
  const safe = String(section)
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ANCHOR_PREFIX + safe;
}

const ANCHOR_ID_PREFIX = ANCHOR_PREFIX;

module.exports = {
  LECTURE_ANCHOR_HINTS,
  ANCHOR_ID_PREFIX,
  anchorId,
  normalizeTitle,
  stripNumbering,
  findHeadings,
  resolveRule,
  resolveGeneric,
  computeChapterAnchors,
};
