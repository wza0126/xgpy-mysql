/**
 * WPS 操作题判分引擎（纯 Node，零新增依赖）
 * ============================================================
 * 为什么不用 exceljs / SheetJS：
 *   1) 交付物是 pkg 打单文件 exe，新增依赖要能被 pkg 追踪并打包，越少越好（yauzl 已在 deps）。
 *   2) 操作题的评分点是 OOXML **原始结构**（合并区、公式串、字体索引、数字格式、图表 XML），
 *      exceljs 会做归一化且**完全没有图表 API**（读/写都没有），拿不到图表 XML。
 *   3) 学生交上来的文件往往比规范文档脏（WPS 专有命名空间、损坏的条件格式 `<formula>#REF!</formula>`），
 *      自己解析才能全程容错、不因一处脏数据整体抛错。
 *
 * 判分模型：spec.steps[].checks[]，每个 check 有 kind + score，
 *   step 得分 = 其 checks 中通过者得分之和；总分 = 各 step 得分之和。
 *
 * ⛔ 判分只认 OOXML，不关心是谁产出的（真 WPS 做题 / 未来在线编辑都走同一套）。
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');

let yauzl = null;
try { yauzl = require('yauzl'); } catch (e) { /* 调用时再报错，便于脚本单独引入本模块做单测 */ }

// ============================================================
// 一、轻量 XML 解析（只覆盖 OOXML 子集，够用且容错）
// ============================================================

function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function localName(tag) {
  const p = tag.indexOf(':');
  return p >= 0 ? tag.slice(p + 1) : tag;
}

/**
 * 把 XML 解析成节点树。节点：{ name, local, attrs, children, text }
 * 解析失败不抛错（返回已解析部分），保证脏文件也能判。
 */
function parseXml(xml) {
  const root = { name: '#root', local: '#root', attrs: {}, children: [], text: '' };
  if (!xml) return root;
  const stack = [root];
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const parent = stack[stack.length - 1];
      parent.text += decodeEntities(xml.slice(i, lt));
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      const parent = stack[stack.length - 1];
      parent.text += xml.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (xml.startsWith('</', lt)) {
      const end = xml.indexOf('>', lt);
      if (stack.length > 1) stack.pop();
      i = end < 0 ? n : end + 1;
      continue;
    }
    const end = xml.indexOf('>', lt);
    if (end < 0) break;
    let tag = xml.slice(lt + 1, end);
    let selfClose = false;
    if (tag.endsWith('/')) { selfClose = true; tag = tag.slice(0, -1); }
    const sp = tag.search(/[\s]/);
    const name = sp < 0 ? tag : tag.slice(0, sp);
    if (!name) { i = end + 1; continue; }
    const attrStr = sp < 0 ? '' : tag.slice(sp + 1);
    const attrs = {};
    const attrRe = /([\w:.\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = attrRe.exec(attrStr))) {
      attrs[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
    }
    const node = { name, local: localName(name), attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
    i = end + 1;
  }
  return root;
}

function findAll(node, local) {
  const out = [];
  if (!node) return out;
  const walk = (n) => {
    for (const c of n.children) {
      if (c.local === local) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

function findFirst(node, local) {
  if (!node) return null;
  for (const c of node.children) {
    if (c.local === local) return c;
    const deep = findFirst(c, local);
    if (deep) return deep;
  }
  return null;
}

function childNode(node, local) {
  if (!node) return null;
  for (const c of node.children) if (c.local === local) return c;
  return null;
}

/** 取节点及其所有后代的文本（用于图表标题这类富文本） */
function deepText(node) {
  if (!node) return '';
  let s = node.text || '';
  for (const c of node.children) s += deepText(c);
  return s;
}

/** 取属性，忽略命名空间前缀（r:id 与 id 都能取到） */
function attr(node, name) {
  if (!node) return undefined;
  if (node.attrs[name] !== undefined) return node.attrs[name];
  for (const k of Object.keys(node.attrs)) {
    if (localName(k) === name) return node.attrs[k];
  }
  return undefined;
}

// ============================================================
// 二、zip 读取（yauzl）
// ============================================================

function readZip(buffer) {
  return new Promise((resolve, reject) => {
    if (!fs) return reject(new Error('no fs'));
    let zip;
    try {
      zip = yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, z) => {
        if (err) return reject(new Error('不是有效的 xlsx（zip 解析失败）：' + err.message));
        zip = z;
        const files = {};
        let pending = 0;
        let ended = false;
        const maybeFinish = () => {
          if (ended && pending === 0) resolve(files);
        };
        zip.on('entry', (entry) => {
          if (/\/$/.test(entry.fileName)) { zip.readEntry(); return; }
          pending++;
          zip.openReadStream(entry, (e, rs) => {
            if (e) { pending--; maybeFinish(); return; }
            const chunks = [];
            rs.on('data', (c) => chunks.push(c));
            rs.on('end', () => {
              files[entry.fileName] = Buffer.concat(chunks);
              pending--;
              maybeFinish();
              zip.readEntry();
            });
            rs.on('error', () => { pending--; maybeFinish(); zip.readEntry(); });
          });
        });
        zip.on('end', () => { ended = true; maybeFinish(); });
        zip.on('error', reject);
        zip.readEntry();
      });
    } catch (e) {
      reject(new Error('不是有效的 xlsx：' + e.message));
    }
  });
}

// ============================================================
// 三、单元格引用工具
// ============================================================

function normRef(ref) {
  return String(ref || '').replace(/\$/g, '').replace(/\s/g, '').toUpperCase();
}

function colToNum(s) {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function numToCol(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(normRef(ref));
  if (!m) return null;
  return { col: colToNum(m[1]), row: parseInt(m[2], 10), colName: m[1] };
}

/** 'A1:D1' → ['A1','B1','C1','D1']；单格返回自身 */
function rangeCells(range) {
  const parts = String(range || '').split(':');
  const a = parseRef(parts[0]);
  if (!a) return [];
  if (parts.length < 2) return [normRef(parts[0])];
  const b = parseRef(parts[1]);
  if (!b) return [normRef(parts[0])];
  const out = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
      out.push(numToCol(c) + r);
    }
  }
  return out;
}

/** 归一化区域字符串：Sheet1!$A$2:$A$13 → A2:A13 */
function normRange(range) {
  return String(range || '')
    .split('!').pop()
    .replace(/\$/g, '')
    .replace(/\s/g, '')
    .toUpperCase();
}

/** 路径拼接（OOXML 内部相对路径） */
function joinPath(base, rel) {
  if (/^\/?xl\//i.test(rel) && !rel.startsWith('..')) {
    return rel.replace(/^\//, '');
  }
  const parts = (base ? base.split('/') : []).concat(String(rel).split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function dirname(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** xl/worksheets/sheet1.xml → xl/worksheets/_rels/sheet1.xml.rels */
function relsPathFor(partPath) {
  return joinPath(dirname(partPath), '_rels/' + partPath.split('/').pop() + '.rels');
}

function parseRels(xml) {
  const map = {};
  if (!xml) return map;
  const root = parseXml(xml);
  for (const r of findAll(root, 'Relationship')) {
    if (r.attrs.Id) map[r.attrs.Id] = r.attrs.Target;
  }
  return map;
}

// ============================================================
// 四、样式解析
// ============================================================

// OOXML 内置数字格式（子集：与"数值型/小数位"相关）
const BUILTIN_NUMFMT = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0',
  48: '##0.0E+0', 49: '@',
};

/** 从数字格式串推断显示小数位；返回 null 表示"不定/非数值" */
function decimalsFromFormat(code) {
  if (code === undefined || code === null) return null;
  let s = String(code);
  if (/^general$/i.test(s.trim())) return null;
  // 去掉引号内容、_x 占位、*x 填充、[颜色/条件]、转义字符
  s = s
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .replace(/_.?/g, '')
    .replace(/\*.?/g, '');
  const sec = s.split(';')[0];
  const m = /\.(0+)/.exec(sec);
  if (m) return m[1].length;
  if (/(^|[^0#])0([^0#]|$)/.test(sec) || /#/.test(sec)) return 0;
  return null;
}

function parseStyles(xml) {
  const styles = { fonts: [], cellXfs: [], numFmts: Object.assign({}, BUILTIN_NUMFMT), dxfs: [] };
  if (!xml) return styles;
  const root = parseXml(xml);

  const numFmtsNode = findFirst(root, 'numFmts');
  if (numFmtsNode) {
    for (const nf of numFmtsNode.children) {
      if (nf.local !== 'numFmt') continue;
      const id = parseInt(nf.attrs.numFmtId, 10);
      if (!isNaN(id)) styles.numFmts[id] = nf.attrs.formatCode || '';
    }
  }

  const fontsNode = childNode(root, 'fonts') || findFirst(root, 'fonts');
  if (fontsNode) {
    for (const f of fontsNode.children) {
      if (f.local !== 'font') continue;
      const nameNode = childNode(f, 'name');
      const szNode = childNode(f, 'sz');
      const bNode = childNode(f, 'b');
      const iNode = childNode(f, 'i');
      const uNode = childNode(f, 'u');
      const bold = !!bNode && !/^(0|false)$/i.test(String(bNode.attrs.val || '1'));
      const italic = !!iNode && !/^(0|false)$/i.test(String(iNode.attrs.val || '1'));
      const underline = !!uNode && !/^(none|0|false)$/i.test(String(uNode.attrs.val || 'single'));
      const colorNode = childNode(f, 'color');
      styles.fonts.push({
        name: nameNode ? nameNode.attrs.val : null,
        size: szNode ? Number(szNode.attrs.val) : null,
        bold, italic, underline,
        color: colorNode ? (colorNode.attrs.rgb || (colorNode.attrs.theme !== undefined ? ('theme:' + colorNode.attrs.theme) : null)) : null,
      });
    }
  }

  const xfsNode = findFirst(root, 'cellXfs');
  if (xfsNode) {
    for (const xf of xfsNode.children) {
      if (xf.local !== 'xf') continue;
      const al = childNode(xf, 'alignment');
      styles.cellXfs.push({
        numFmtId: xf.attrs.numFmtId !== undefined ? parseInt(xf.attrs.numFmtId, 10) : 0,
        fontId: xf.attrs.fontId !== undefined ? parseInt(xf.attrs.fontId, 10) : 0,
        applyNumberFormat: xf.attrs.applyNumberFormat,
        alignment: al ? {
          horizontal: al.attrs.horizontal || null,
          vertical: al.attrs.vertical || null,
          wrapText: /^(1|true)$/i.test(String(al.attrs.wrapText || '')),
        } : null,
      });
    }
  }

  // 条件格式引用的差异样式（dxf）：评分点主要靠它取「填充色 / 字体色 / 加粗」。
  // 实测样本：<dxfs count="1"><dxf><fill><patternFill><bgColor rgb="FFFF0000"/>
  const dxfsNode = findFirst(root, 'dxfs');
  if (dxfsNode) {
    for (const d of dxfsNode.children) {
      if (d.local !== 'dxf') continue;
      const fill = childNode(d, 'fill') || findFirst(d, 'fill');
      let fillColor = null;
      let patternType = null;
      if (fill) {
        const pf = childNode(fill, 'patternFill') || findFirst(fill, 'patternFill');
        if (pf) {
          patternType = pf.attrs.patternType || null;
          const bg = childNode(pf, 'bgColor') || findFirst(pf, 'bgColor');
          const fg = childNode(pf, 'fgColor') || findFirst(pf, 'fgColor');
          fillColor = (bg && bg.attrs.rgb) || (fg && fg.attrs.rgb) || null;
        }
      }
      const fnt = childNode(d, 'font') || findFirst(d, 'font');
      let fontColor = null;
      let fontBold = false;
      if (fnt) {
        const c = childNode(fnt, 'color') || findFirst(fnt, 'color');
        fontColor = c ? (c.attrs.rgb || null) : null;
        fontBold = !!(childNode(fnt, 'b') || findFirst(fnt, 'b'));
      }
      styles.dxfs.push({ fillColor, patternType, fontColor, fontBold });
    }
  }
  return styles;
}

// ============================================================
// 五、工作表 + 图表解析
// ============================================================

function parseChart(xml) {
  const chart = { chartType: null, barDir: null, title: '', titleRef: null, series: [] };
  if (!xml) return chart;
  const root = parseXml(xml);
  const plotArea = findFirst(root, 'plotArea') || root;

  const TYPE_MAP = [
    ['barChart', 'bar'], ['bar3DChart', 'bar'],
    ['lineChart', 'line'], ['line3DChart', 'line'],
    ['pieChart', 'pie'], ['pie3DChart', 'pie'], ['doughnutChart', 'doughnut'],
    ['areaChart', 'area'], ['scatterChart', 'scatter'], ['radarChart', 'radar'],
    ['bubbleChart', 'bubble'], ['stockChart', 'stock'], ['surfaceChart', 'surface'],
  ];
  let host = null;
  for (const [nodeName, kind] of TYPE_MAP) {
    const node = childNode(plotArea, nodeName) || findFirst(plotArea, nodeName);
    if (node) { chart.chartType = kind; host = node; break; }
  }
  if (host && chart.chartType === 'bar') {
    const d = findFirst(host, 'barDir');
    if (d) chart.barDir = d.attrs.val; // col=柱形图, bar=条形图
  }

  const titleNode = childNode(root, 'title') || findFirst(root, 'title');
  if (titleNode) {
    const strRefF = findFirst(titleNode, 'strRef');
    if (strRefF) {
      const f = findFirst(strRefF, 'f');
      if (f) chart.titleRef = normRange(f.text);
    }
    chart.title = deepText(titleNode).replace(/\s+/g, ' ').trim();
  }

  if (host) {
    for (const ser of findAll(host, 'ser')) {
      const txNode = childNode(ser, 'tx');
      const catNode = childNode(ser, 'cat') || findFirst(ser, 'cat');
      const valNode = childNode(ser, 'val') || findFirst(ser, 'val');
      const refOf = (node) => {
        if (!node) return null;
        const f = findFirst(node, 'f');
        return f ? normRange(f.text) : null;
      };
      chart.series.push({
        name: txNode ? deepText(txNode).trim() : '',
        cat: refOf(catNode),
        val: refOf(valNode),
      });
    }
  }
  return chart;
}

function parseDrawing(files, drawingPath) {
  const charts = [];
  const buf = files[drawingPath];
  if (!buf) return charts;
  const root = parseXml(buf.toString('utf8'));
  const rels = parseRels(files[relsPathFor(drawingPath)] ? files[relsPathFor(drawingPath)].toString('utf8') : '');
  const base = dirname(drawingPath);
  for (const cf of findAll(root, 'chart')) {
    const rid = attr(cf, 'id');
    const target = rid ? rels[rid] : null;
    if (!target) continue;
    const chartPath = joinPath(base, target);
    charts.push(parseChart(files[chartPath] ? files[chartPath].toString('utf8') : ''));
  }
  return charts;
}

function parseSheet(files, sheetPath, ctx) {
  const buf = files[sheetPath];
  const xml = buf ? buf.toString('utf8') : '';
  const root = parseXml(xml);
  // ⛔ styles / sharedStrings 必须挂到工作表上：font / align / number_format 等评分点
  //    通过 styleOf(sheet, cell) 取样式，漏挂会让这些检查全部静默判错（曾实测为"字体=默认"）。
  const sheet = {
    path: sheetPath,
    cells: new Map(),
    merges: [],
    charts: [],
    drawings: 0,
    styles: ctx.styles,
    sharedStrings: ctx.sharedStrings,
    rowMeta: new Map(),      // 行号 → { hidden, outlineLevel }（筛选隐藏行 / 分类汇总分组）
    autoFilter: null,        // { ref, columns }
    condFormats: [],         // [{ sqref, rules }]
    sortState: null,         // { ref, conditions }
    filterMode: false,
    outlineLevelRow: 0,
  };

  const sd = childNode(root, 'sheetData') || findFirst(root, 'sheetData');
  if (sd) {
    for (const row of findAll(sd, 'row')) {
      // 行属性：筛选会写 hidden="1"；分类汇总会写 outlineLevel（数据行 2 / 汇总行 1）
      const rNum = parseInt(row.attrs.r, 10);
      if (!isNaN(rNum)) {
        const hidden = /^(1|true)$/i.test(String(row.attrs.hidden || ''));
        const ol = row.attrs.outlineLevel !== undefined ? parseInt(row.attrs.outlineLevel, 10) : 0;
        if (hidden || (ol && ol > 0)) sheet.rowMeta.set(rNum, { hidden, outlineLevel: ol || 0 });
      }
      for (const c of row.children) {
        if (c.local !== 'c') continue;
        const ref = normRef(c.attrs.r);
        if (!ref) continue;
        const t = c.attrs.t || null;
        const fNode = childNode(c, 'f');
        const vNode = childNode(c, 'v');
        const raw = vNode ? (vNode.text || '') : '';
        let value;
        if (t === 's') {
          const idx = parseInt(raw, 10);
          value = ctx.sharedStrings[idx] !== undefined ? ctx.sharedStrings[idx] : '';
        } else if (t === 'str') {
          value = raw;
        } else if (t === 'inlineStr') {
          const is = childNode(c, 'is') || findFirst(c, 'is');
          value = is ? deepText(is) : '';
        } else if (t === 'b') {
          value = raw === '1';
        } else if (t === 'e') {
          value = raw;
        } else {
          value = raw === '' ? null : Number(raw);
        }
        sheet.cells.set(ref, {
          ref,
          styleIndex: c.attrs.s !== undefined ? parseInt(c.attrs.s, 10) : 0,
          type: t || 'n',
          formula: fNode ? String(fNode.text || '').replace(/^\s*=\s*/, '') : null,
          formulaAttrs: fNode ? fNode.attrs : {},
          value,
          raw,
        });
      }
    }
  }

  const mc = findFirst(root, 'mergeCells');
  if (mc) for (const m of findAll(mc, 'mergeCell')) {
    const r = normRef(m.attrs.ref);
    if (r && r.includes(':')) sheet.merges.push(r);
  }

  // ---- 自动筛选 ----
  // 实测（Excel 2016 产物）：
  //   <sheetPr filterMode="1"/><autoFilter ref="A1:D7">
  //     <filterColumn colId="3"><customFilters><customFilter operator="greaterThan" val="45000"/></customFilters></filterColumn>
  //     <filterColumn colId="0"><filters><filter val="城东区"/></filters></filterColumn>
  const afNode = findFirst(root, 'autoFilter');
  if (afNode) {
    const columns = [];
    for (const fc of findAll(afNode, 'filterColumn')) {
      const colId = parseInt(fc.attrs.colId, 10);
      const custom = [];
      const cfs = findFirst(fc, 'customFilters');
      if (cfs) for (const cf of findAll(cfs, 'customFilter')) {
        custom.push({
          operator: cf.attrs.operator || 'equal',
          val: cf.attrs.val !== undefined ? String(cf.attrs.val) : '',
        });
      }
      const values = [];
      const fts = findFirst(fc, 'filters');
      if (fts) for (const f of findAll(fts, 'filter')) {
        if (f.attrs.val !== undefined) values.push(String(f.attrs.val));
      }
      const top10 = findFirst(fc, 'top10');
      const dyn = findFirst(fc, 'dynamicFilter');
      columns.push({
        colId: isNaN(colId) ? null : colId,
        custom,
        values,
        top10: top10 ? { val: top10.attrs.val, top: top10.attrs.top, percent: top10.attrs.percent } : null,
        dynamic: dyn ? { type: dyn.attrs.type, val: dyn.attrs.val } : null,
      });
    }
    sheet.autoFilter = { ref: normRange(afNode.attrs.ref), columns };
  }

  // ---- 条件格式 ----
  // <conditionalFormatting sqref="D2:D7"><cfRule type="cellIs" dxfId="0" operator="greaterThan"><formula>4000</formula></cfRule>
  for (const cfn of findAll(root, 'conditionalFormatting')) {
    const rules = [];
    for (const r of findAll(cfn, 'cfRule')) {
      // 数据条 / 色阶 / 图标集 没有 formula 与 operator，用 cfvo 描述阈值
      const cfvo = findAll(r, 'cfvo').map((v) => ({
        type: v.attrs.type, val: v.attrs.val, gte: v.attrs.gte,
      }));
      rules.push({
        type: r.attrs.type || '',
        operator: r.attrs.operator || '',
        dxfId: r.attrs.dxfId !== undefined ? parseInt(r.attrs.dxfId, 10) : null,
        priority: r.attrs.priority,
        text: r.attrs.text,
        formulas: findAll(r, 'formula').map((x) => String(x.text || '')),
        cfvo,
      });
    }
    if (rules.length) sheet.condFormats.push({ sqref: normRange(cfn.attrs.sqref), rules });
  }

  // ---- 工作表属性 / 排序状态 ----
  const prNode = childNode(root, 'sheetPr') || findFirst(root, 'sheetPr');
  sheet.filterMode = !!(prNode && /^(1|true)$/i.test(String(prNode.attrs.filterMode || '')));

  const fmtPr = childNode(root, 'sheetFormatPr') || findFirst(root, 'sheetFormatPr');
  sheet.outlineLevelRow = fmtPr && fmtPr.attrs.outlineLevelRow !== undefined
    ? parseInt(fmtPr.attrs.outlineLevelRow, 10) : 0;

  const ssNode = findFirst(root, 'sortState');
  if (ssNode) {
    sheet.sortState = {
      ref: normRange(ssNode.attrs.ref),
      conditions: findAll(ssNode, 'sortCondition').map((c) => ({
        ref: normRange(c.attrs.ref),
        descending: /^(1|true)$/i.test(String(c.attrs.descending || '')),
        sortBy: c.attrs.sortBy || 'value',
      })),
    };
  }

  const dNode = childNode(root, 'drawing') || findFirst(root, 'drawing');
  if (dNode) {
    const rid = attr(dNode, 'id');
    const rels = parseRels(files[relsPathFor(sheetPath)] ? files[relsPathFor(sheetPath)].toString('utf8') : '');
    const target = rid ? rels[rid] : null;
    if (target) {
      const drawingPath = joinPath(dirname(sheetPath), target);
      sheet.drawings = 1;
      sheet.charts = parseDrawing(files, drawingPath);
    }
  }
  return sheet;
}

/** 解析整个工作簿 → 可判分模型 */
function buildModel(files) {
  const get = (p) => (files[p] ? files[p].toString('utf8') : null);
  const sharedStrings = (() => {
    const x = get('xl/sharedStrings.xml');
    if (!x) return [];
    const root = parseXml(x);
    const sst = findFirst(root, 'sst');
    if (!sst) return [];
    return findAll(sst, 'si').map((si) => deepText(si));
  })();

  const styles = parseStyles(get('xl/styles.xml'));
  const ctx = { sharedStrings, styles };

  const wbRoot = parseXml(get('xl/workbook.xml') || '');
  const wbRels = parseRels(get('xl/_rels/workbook.xml.rels'));
  const sheetsNode = findFirst(wbRoot, 'sheets');
  const sheets = [];
  if (sheetsNode) {
    for (const s of sheetsNode.children) {
      if (s.local !== 'sheet') continue;
      const relId = attr(s, 'id');
      const target = relId ? wbRels[relId] : null;
      const path = target ? joinPath('xl', target) : null;
      if (!path) continue;
      const parsed = parseSheet(files, path, ctx);
      parsed.name = s.attrs.name || '';
      parsed.sheetId = s.attrs.sheetId;
      sheets.push(parsed);
    }
  }

  return { sharedStrings, styles, sheets, fileList: Object.keys(files) };
}

/** 单元格取值：若该格落在合并区内部（非左上角），返回左上角那格 */
function locateCell(sheet, ref) {
  const r = normRef(ref);
  let cell = sheet.cells.get(r) || null;
  if (cell) return { cell, anchor: r };
  for (const m of sheet.merges) {
    const cells = rangeCells(m);
    if (cells.length > 1 && cells.includes(r)) {
      const anchor = cells[0];
      return { cell: sheet.cells.get(anchor) || null, anchor };
    }
  }
  return { cell, anchor: r };
}

function styleOf(sheet, cell) {
  if (!cell) return null;
  const idx = cell.styleIndex || 0;
  return sheet.styles ? sheet.styles.cellXfs[idx] : null;
}

// ============================================================
// 六、检查器（每类评分点一个）
// ============================================================

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? null : n;
}

function normFormula(f) {
  return String(f || '')
    .replace(/^\s*=\s*/, '')
    .replace(/\$/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function normText(s) {
  return String(s === null || s === undefined ? '' : s).replace(/\s+/g, '').trim();
}

/** 每个检查器：(ctx) → { pass, got, want, note } */
const CHECKERS = {
  // 工作表存在
  sheet_exists({ model, check }) {
    const want = normText(check.sheet || check.name);
    const names = model.sheets.map((s) => s.name);
    const pass = names.some((n) => normText(n) === want);
    return { pass, got: names.join('/'), want };
  },

  // 合并单元格
  merged({ sheet, check }) {
    const want = normRef(check.range);
    const pass = sheet.merges.includes(want);
    return { pass, got: sheet.merges.join(', ') || '(无合并)', want };
  },

  // 单元格文本
  cell_text({ sheet, check }) {
    const { cell } = locateCell(sheet, check.ref);
    const got = cell ? (cell.value === null || cell.value === undefined ? '' : String(cell.value)) : '';
    const a = normText(got);
    const want = normText(check.text);
    const pass = check.ci === false ? a === want : a.toLowerCase() === want.toLowerCase();
    return { pass, got, want: check.text };
  },

  // 单元格数值（容差）
  cell_value({ sheet, check }) {
    const { cell } = locateCell(sheet, check.ref);
    const got = cell ? num(cell.value) : null;
    const want = num(check.value);
    const tol = check.tol === undefined ? 0.5 : Number(check.tol);
    const pass = got !== null && want !== null && Math.abs(got - want) <= tol + 1e-9;
    return { pass, got, want: check.value, note: `容差 ±${tol}` };
  },

  // 区域内每一格都必须有公式（防止只对首尾格用公式、中间手填数字）
  range_formula({ sheet, check }) {
    const cells = rangeCells(check.range);
    const missing = [];
    for (const ref of cells) {
      const { cell } = locateCell(sheet, ref);
      if (!cell || !cell.formula) missing.push(ref + (cell && cell.value !== null && cell.value !== undefined ? `(纯值${cell.value})` : '(空)'));
    }
    return {
      pass: missing.length === 0,
      got: missing.length ? `未用公式 ${missing.length} 处：${missing.slice(0, 4).join('、')}${missing.length > 4 ? ' 等' : ''}` : `${cells.length} 格全部使用公式`,
      want: `${check.range} 全部使用公式`,
    };
  },

  // 区域内每一格的数值都正确（按行优先顺序对 values 列表）
  range_values({ sheet, check }) {
    const cells = rangeCells(check.range);
    const wantVals = check.values || [];
    const tol = check.tol === undefined ? 0.5 : Number(check.tol);
    const bad = [];
    cells.forEach((ref, i) => {
      const { cell } = locateCell(sheet, ref);
      const got = cell ? num(cell.value) : null;
      const want = num(wantVals[i]);
      if (got === null || want === null || Math.abs(got - want) > tol + 1e-9) {
        bad.push(`${ref}（应为 ${wantVals[i]}，实为 ${got === null ? '空' : got}）`);
      }
    });
    return {
      pass: bad.length === 0,
      got: bad.length ? `${bad.length} 处不符：${bad.slice(0, 4).join('；')}${bad.length > 4 ? ' 等' : ''}` : `${cells.length} 格结果全部正确`,
      want: `${check.range} 结果正确`,
      note: `容差 ±${tol}`,
    };
  },

  // 区域内每一格"不保留小数"（格式 0 位，或值本身是整数）
  range_integer_display({ sheet, check }) {
    const cells = rangeCells(check.range);
    const bad = [];
    for (const ref of cells) {
      const { cell } = locateCell(sheet, ref);
      if (!cell) { bad.push(ref + '(空)'); continue; }
      const xf = styleOf(sheet, cell);
      const dec = decimalsFromFormat(xf ? sheet.styles.numFmts[xf.numFmtId] : undefined);
      const v = num(cell.value);
      const okInt = v !== null && Math.abs(v - Math.round(v)) < 1e-9;
      if (!(dec === 0 || okInt)) bad.push(`${ref}(${dec === null ? '未设 0 位格式' : dec + ' 位小数'})`);
    }
    return {
      pass: bad.length === 0,
      got: bad.length ? `${bad.length} 处不符：${bad.slice(0, 4).join('、')}${bad.length > 4 ? ' 等' : ''}` : `${cells.length} 格均不保留小数`,
      want: `${check.range} 不保留小数`,
    };
  },

  // 是公式（不是手填的数字）
  cell_has_formula({ sheet, check }) {
    const { cell, anchor } = locateCell(sheet, check.ref);
    const pass = !!(cell && cell.formula);
    return { pass, got: cell ? (cell.formula ? '=' + cell.formula : '（纯值 ' + cell.value + '）') : '(空)', want: '公式', note: anchor !== normRef(check.ref) ? `实际取 ${anchor}` : '' };
  },

  // 公式串完全一致（归一化后）
  cell_formula({ sheet, check }) {
    const { cell } = locateCell(sheet, check.ref);
    const got = cell && cell.formula ? cell.formula : null;
    const want = check.formula;
    const pass = !!got && normFormula(got) === normFormula(want);
    return { pass, got: got ? '=' + got : '(无公式)', want: '=' + want };
  },

  // 公式引用了指定单元格（宽松：不要求顺序与写法）
  formula_tokens({ sheet, check }) {
    const { cell } = locateCell(sheet, check.ref);
    const f = cell && cell.formula ? normFormula(cell.formula) : '';
    const tokens = (check.tokens || []).map(normFormula);
    const missing = tokens.filter((t) => !f.includes(t));
    const pass = !!f && missing.length === 0;
    return { pass, got: f ? '=' + f : '(无公式)', want: '包含 ' + tokens.join(' + '), note: missing.length ? '缺少 ' + missing.join(', ') : '' };
  },

  // SUM 求和：公式以 SUM 且覆盖指定区域
  sum_range({ sheet, check }) {
    const { cell } = locateCell(sheet, check.ref);
    const f = cell && cell.formula ? normFormula(cell.formula) : '';
    if (!f) return { pass: false, got: '(无公式)', want: `SUM(${check.range})` };
    const hasSum = f.includes('SUM(');
    const wantRange = normRange(check.range);
    const cells = rangeCells(wantRange);
    // 公式里必须出现区间端点，且整段引用
    const covers = f.includes(wantRange) || (cells.length > 0 && f.includes(cells[0]) && f.includes(cells[cells.length - 1]));
    const pass = hasSum && covers;
    return { pass, got: '=' + f, want: `SUM(${wantRange})`, note: hasSum ? (covers ? '' : '求和区间不符') : '未使用 SUM 函数' };
  },

  // 字体（名称/加粗/字号）
  font({ sheet, check }) {
    const { cell } = locateCell(sheet, check.ref);
    const xf = styleOf(sheet, cell);
    const font = xf ? (sheet.styles.fonts[xf.fontId] || {}) : {};
    const problems = [];
    if (check.name !== undefined) {
      const got = font.name || '';
      if (normText(got).toLowerCase() !== normText(check.name).toLowerCase()) problems.push(`字体应为${check.name}（实为${got || '默认'}）`);
    }
    if (check.bold !== undefined) {
      if (!!font.bold !== !!check.bold) problems.push(`${check.bold ? '需加粗' : '不应加粗'}`);
    }
    if (check.size !== undefined) {
      if (Number(font.size) !== Number(check.size)) problems.push(`字号应为${check.size}（实为${font.size}）`);
    }
    const want = [];
    if (check.name !== undefined) want.push(check.name);
    if (check.bold) want.push('加粗');
    if (check.size !== undefined) want.push(check.size + '磅');
    return {
      pass: problems.length === 0,
      got: `${font.name || '默认'}${font.bold ? ' 加粗' : ''} ${font.size !== null && font.size !== undefined ? font.size + '磅' : ''}`.trim(),
      want: want.join(' '),
      note: problems.join('；'),
    };
  },

  // 水平居中
  align({ sheet, check }) {
    const { cell } = locateCell(sheet, check.ref);
    const xf = styleOf(sheet, cell);
    const got = xf && xf.alignment ? (xf.alignment.horizontal || '') : '';
    const want = check.horizontal || 'center';
    const aliases = { center: ['center', 'centerContinuous'], left: ['left'], right: ['right'] };
    const pass = (aliases[want] || [want]).includes(got);
    return { pass, got: got || '(默认)', want };
  },

  // 数字格式小数位
  number_format({ sheet, check }) {
    const { cell } = locateCell(sheet, check.ref);
    const xf = styleOf(sheet, cell);
    const code = xf ? sheet.styles.numFmts[xf.numFmtId] : undefined;
    const dec = decimalsFromFormat(code);
    const want = check.decimals === undefined ? 0 : Number(check.decimals);
    const mode = check.mode || 'exact';
    let pass = false;
    if (dec !== null) pass = mode === 'atMost' ? dec <= want : dec === want;
    return { pass, got: dec === null ? `不定（${code || 'General'}）` : `${dec} 位小数（${code}）`, want: `${mode === 'atMost' ? '最多' : ''}${want} 位小数` };
  },

  /**
   * 显示为整数（"不保留小数"的真实语义）：
   *   - 数字格式显示 0 位小数  → 通过（如 =C3*10000/B3 + 格式 0）
   *   - 或 值本身是整数        → 通过（如 =ROUND(C3*10000/B3,0) + General）
   * 两条任一成立即算对，避免只认 ROUND 而误杀"设格式"的写法。
   */
  integer_display({ sheet, check }) {
    const { cell } = locateCell(sheet, check.ref);
    if (!cell) return { pass: false, got: '(空)', want: '整数（不保留小数）' };
    const xf = styleOf(sheet, cell);
    const code = xf ? sheet.styles.numFmts[xf.numFmtId] : undefined;
    const dec = decimalsFromFormat(code);
    const v = num(cell.value);
    const byFormat = dec === 0 || dec === null; // General 时若值本身是整数也算
    const byValue = v !== null && Math.abs(v - Math.round(v)) < 1e-9;
    const pass = (dec === 0) || (byValue && byFormat) || (byValue && check.allowGeneral !== false);
    return {
      pass,
      got: `值=${cell.value}，格式 ${dec === null ? (code || 'General') : dec + ' 位小数'}`,
      want: '不保留小数',
    };
  },

  // 图表
  chart({ sheet, check }) {
    const wantIdx = check.index === undefined ? 0 : Number(check.index);
    const chart = sheet.charts[wantIdx];
    if (!chart) {
      return { pass: false, got: `未在「${sheet.name}」中发现图表（共 ${sheet.charts.length} 个）`, want: '插入图表' };
    }
    const problems = [];
    if (check.chartType) {
      const t = chart.chartType || 'unknown';
      const ok = check.chartType === t;
      if (!ok) problems.push(`图表类型应为${check.chartType}（实为${t}）`);
    }
    if (check.barDir && chart.chartType === 'bar') {
      const want = check.barDir; // col / bar
      if (chart.barDir && chart.barDir !== want) problems.push(`${want === 'col' ? '柱形图' : '条形图'}`);
    }
    if (check.title !== undefined) {
      const got = normText(chart.title).toLowerCase();
      const want = normText(check.title).toLowerCase();
      if (got !== want) problems.push(`标题应为「${check.title}」（实为「${chart.title || '无'}」）`);
    }
    const series0 = chart.series[0] || {};
    if (check.catRange !== undefined) {
      const wantR = normRange(check.catRange);
      if (normRange(series0.cat) !== wantR) problems.push(`分类轴应为${wantR}（实为${series0.cat || '无'}）`);
    }
    if (check.valRange !== undefined) {
      const wantR = normRange(check.valRange);
      const vals = chart.series.map((s) => normRange(s.val));
      if (!vals.includes(wantR)) problems.push(`数值轴应为${wantR}（实为${vals.join(',') || '无'}）`);
    }
    if (check.seriesCount !== undefined && chart.series.length !== Number(check.seriesCount)) {
      problems.push(`数据系列应为 ${check.seriesCount} 组（实为 ${chart.series.length} 组）`);
    }
    return {
      pass: problems.length === 0,
      got: `${chart.chartType || '?'}${chart.barDir ? '/' + chart.barDir : ''} 标题「${chart.title || '无'}」 分类 ${series0.cat || '无'} 数值 ${(chart.series.map((s) => s.val).filter(Boolean).join(',') || '无')}`,
      want: [check.chartType, check.title, check.catRange, check.valRange].filter(Boolean).join(' '),
      note: problems.join('；'),
    };
  },

  // ==========================================================
  // 以下四类由「真实 Excel 2016 产物」实测校准（见
  // backend/scripts/debug/make_wps_feature_samples.ps1 + dump_xlsx_xml.cjs）
  // ==========================================================

  /**
   * 自动筛选。OML 实测结构：
   *   <sheetPr filterMode="1"/><autoFilter ref="A1:D7">
   *     <filterColumn colId="3"><customFilters><customFilter operator="greaterThan" val="45000"/></customFilters></filterColumn>
   *     <filterColumn colId="0"><filters><filter val="城东区"/></filters></filterColumn>
   * ⚠️ colId 是 0-based；配置里用 1-based 的 col（A=1）更好懂。
   * ⚠️ 只判「筛选条件」，不强制校验隐藏行：COM/部分 WPS 版本只写条件不写 hidden。
   */
  auto_filter({ sheet, check }) {
    const af = sheet.autoFilter;
    if (!af) return { pass: false, got: '未设置自动筛选', want: '设置自动筛选' };
    const problems = [];
    if (check.range) {
      const wantR = normRange(check.range);
      if (af.ref !== wantR) problems.push(`筛选区域应为 ${wantR}（实为 ${af.ref || '无'}）`);
    }
    if (check.minColumns !== undefined && af.columns.length < Number(check.minColumns)) {
      problems.push(`至少需要 ${check.minColumns} 列筛选条件（实为 ${af.columns.length} 列）`);
    }
    for (const want of (check.columns || [])) {
      const colId = Number(want.col) - 1;
      const col = af.columns.find((c) => c.colId === colId);
      if (!col) { problems.push(`第 ${want.col} 列未设置筛选条件`); continue; }
      if (want.op) {
        const hit = col.custom.some((c) => normFilterOp(c.operator) === normFilterOp(want.op)
          && (want.value === undefined || String(c.val) === String(want.value)));
        if (!hit) {
          problems.push(`第 ${want.col} 列条件应为「${want.op}${want.value === undefined ? '' : ' ' + want.value}」，实为 ${describeCol(col)}`);
        }
      }
      if (want.values && want.values.length) {
        const missing = want.values.filter((v) => !col.values.includes(String(v)));
        if (missing.length) problems.push(`第 ${want.col} 列应筛出「${missing.join('、')}」，实为 ${col.values.join('、') || '无'}`);
      }
    }
    return {
      pass: problems.length === 0,
      got: describeFilter(af),
      want: check.range
        ? `${normRange(check.range)}${check.columns && check.columns.length ? ` 共 ${check.columns.length} 列条件` : ''}`
        : '已设置自动筛选',
      note: problems.join('；'),
    };
  },

  /**
   * 区域按某列有序。以「实际值顺序」为准，手动重排也能判对。
   * check: { range:'D2:D13', col:4, order:'desc' }
   */
  sorted_range({ sheet, check }) {
    const range = normRange(check.range);
    const cells = rangeCells(range);
    if (!cells.length) return { pass: false, got: '(区域为空)', want: check.range };
    const col = check.col !== undefined ? Number(check.col) : parseRef(cells[0]).col;
    const ordered = cells
      .map((ref) => ({ ref, p: parseRef(ref) }))
      .filter((x) => x.p.col === col)
      .sort((a, b) => a.p.r - b.p.r);
    const vals = ordered.map(({ ref }) => {
      const { cell } = locateCell(sheet, ref);
      if (!cell) return null;
      if (typeof cell.value === 'number') return cell.value;
      const n = num(cell.value);
      return n !== null ? n : cell.value;
    });
    const dir = (check.order === 'desc' || check.desc === true) ? 'desc' : 'asc';
    // 边界：区域里根本不包含该列时，空数组会"假通过"，必须显式判错
    if (ordered.length < 2) {
      return {
        pass: false,
        got: `区域内第 ${col} 列只有 ${ordered.length} 行`,
        want: `第 ${col} 列${dir === 'asc' ? '升序' : '降序'}`,
        note: '区域与列不匹配',
      };
    }
    let badAt = -1;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] === null || vals[i - 1] === null) continue;
      const cmp = compareVals(vals[i - 1], vals[i]);
      if (dir === 'asc' ? cmp > 0 : cmp < 0) { badAt = i; break; }
    }
    return {
      pass: badAt < 0,
      got: vals.map((v) => (v === null ? '空' : v)).slice(0, 10).join(', ') + (vals.length > 10 ? ' …' : ''),
      want: `第 ${col} 列${dir === 'asc' ? '升序' : '降序'}`,
      note: badAt >= 0 ? `第 ${ordered[badAt].ref} 处顺序不符` : '',
    };
  },

  /**
   * 分类汇总。实测结构：汇总格 =SUBTOTAL(9,B2:B3)，数据行 outlineLevel="2"、汇总行 outlineLevel="1"。
   * check: { range:'A1:D11', fn:'sum', minCount:3 }
   */
  subtotal({ sheet, check }) {
    const fnKey = String(check.fn || 'sum').toLowerCase();
    const fnCode = SUBTOTAL_FN[fnKey] !== undefined ? SUBTOTAL_FN[fnKey] : 9;
    const pool = check.range ? rangeCells(normRange(check.range)) : Array.from(sheet.cells.keys());
    const hits = [];
    for (const ref of pool) {
      const cell = sheet.cells.get(ref);
      if (!cell || !cell.formula) continue;
      const m = /^SUBTOTAL\((\d+),/.exec(normFormula(cell.formula));
      if (!m) continue;
      if (Number(m[1]) % 100 === fnCode) hits.push(ref);
    }
    const outlined = Array.from(sheet.rowMeta.values()).filter((r) => r.outlineLevel > 0).length;
    const problems = [];
    const min = check.minCount !== undefined ? Number(check.minCount) : 1;
    if (hits.length < min) problems.push(`汇总公式至少 ${min} 个（实为 ${hits.length} 个）`);
    if (check.requireOutline !== false && outlined === 0) problems.push('未发现分组大纲（分类汇总应产生行分组）');
    return {
      pass: problems.length === 0,
      got: `${hits.length} 个 SUBTOTAL(${fnCode})${outlined ? `，${outlined} 行带大纲` : '，无行大纲'}`,
      want: `${check.fn || '求和'}方式分类汇总`,
      note: problems.join('；'),
    };
  },

  /**
   * 条件格式。实测结构：
   *   <conditionalFormatting sqref="D2:D7"><cfRule type="cellIs" dxfId="0" operator="greaterThan"><formula>4000</formula>
   *   填充色在 styles.xml 的 <dxfs><dxf><fill><patternFill><bgColor rgb="FFFF0000"/>
   * check: { range:'D2:D13', type:'cellIs', operator:'greaterThan', value:4000, fillColor:'red' }
   */
  cond_format({ sheet, check }) {
    const list = sheet.condFormats || [];
    if (!list.length) return { pass: false, got: '未设置条件格式', want: '设置条件格式' };
    const wantRange = check.range ? normRange(check.range) : null;
    const wantCells = wantRange ? rangeCells(wantRange) : null;
    const cands = [];
    for (const cf of list) {
      const cfCells = rangeCells(cf.sqref);
      const covered = wantCells ? wantCells.every((c) => cfCells.includes(c)) : true;
      if (!covered) continue;
      for (const r of cf.rules) cands.push({ sqref: cf.sqref, rule: r });
    }
    if (!cands.length) {
      return {
        pass: false,
        got: `已设条件格式，但未覆盖 ${wantRange}（现有 ${list.map((x) => x.sqref).join('、')}）`,
        want: `${wantRange} 上设置条件格式`,
      };
    }
    const tried = [];
    for (const c of cands) {
      const r = c.rule;
      const ps = [];
      if (check.type && r.type !== check.type) ps.push(`类型应为 ${check.type}（实为 ${r.type}）`);
      if (check.operator && normCondOp(r.operator) !== normCondOp(check.operator)) {
        ps.push(`条件应为 ${check.operator}（实为 ${r.operator || '无'}）`);
      }
      if (check.value !== undefined) {
        const f0 = r.formulas[0];
        if (normText(f0) !== normText(check.value)) ps.push(`阈值应为 ${check.value}（实为 ${f0 || '无'}）`);
      }
      if (check.fillColor) {
        const dxf = r.dxfId !== null && r.dxfId !== undefined ? (sheet.styles.dxfs || [])[r.dxfId] : null;
        const gotColor = dxf ? dxf.fillColor : null;
        if (!colorMatches(gotColor, check.fillColor)) {
          ps.push(`填充色应为 ${check.fillColor}（实为 ${gotColor || '无'}）`);
        }
      }
      if (!ps.length) {
        return {
          pass: true,
          got: `${c.sqref} ${r.type}${r.operator ? ' ' + r.operator : ''}${r.formulas[0] ? ' ' + r.formulas[0] : ''}`,
          want: [check.type, check.operator, check.value].filter((x) => x !== undefined && x !== '').join(' '),
        };
      }
      tried.push(ps.join('、'));
    }
    const best = cands[cands.length - 1].rule;
    return {
      pass: false,
      got: `${cands[0].sqref} ${best.type}${best.operator ? ' ' + best.operator : ''}${best.formulas[0] ? ' ' + best.formulas[0] : ''}`,
      want: [check.type, check.operator, check.value, check.fillColor].filter((x) => x !== undefined && x !== '').join(' '),
      note: tried[tried.length - 1],
    };
  },
};

// ============================================================
// 六·B、新增检查器的辅助（排序 / 筛选 / 分类汇总 / 条件格式）
// ============================================================

// SUBTOTAL 函数代码（109 = 9 + 100，表示"忽略手动隐藏行"，两者等价）
const SUBTOTAL_FN = {
  average: 1, count: 2, counta: 3, max: 4, min: 5, product: 6,
  stdev: 7, stdevp: 8, sum: 9, var: 10, varp: 11,
};

const FILTER_OP_ALIAS = {
  greaterthan: 'greaterThan', '>': 'greaterThan',
  greaterthanorequal: 'greaterThanOrEqual', '>=': 'greaterThanOrEqual',
  lessthan: 'lessThan', '<': 'lessThan',
  lessthanorequal: 'lessThanOrEqual', '<=': 'lessThanOrEqual',
  equal: 'equal', '=': 'equal', '==': 'equal',
  notequal: 'notEqual', '<>': 'notEqual',
  contains: 'contains', notcontains: 'notContains',
  beginswith: 'beginsWith', endswith: 'endsWith',
};

function normFilterOp(op) {
  const k = String(op === undefined || op === null ? '' : op).toLowerCase().replace(/[\s_]/g, '');
  return FILTER_OP_ALIAS[k] || String(op || '');
}

const COND_OP_ALIAS = {
  greaterthan: 'greaterThan', '>': 'greaterThan',
  greaterthanorequal: 'greaterThanOrEqual', '>=': 'greaterThanOrEqual',
  lessthan: 'lessThan', '<': 'lessThan',
  lessthanorequal: 'lessThanOrEqual', '<=': 'lessThanOrEqual',
  equal: 'equal', '=': 'equal',
  notequal: 'notEqual', '<>': 'notEqual',
  between: 'between', notbetween: 'notBetween',
  containstext: 'containsText', notcontainstext: 'notContainsText',
  beginswith: 'beginsWith', endswith: 'endsWith',
  duplicatevalues: 'duplicateValues', uniquevalues: 'uniqueValues',
  aboveaverage: 'aboveAverage', belowaverage: 'belowAverage',
};

function normCondOp(op) {
  const k = String(op === undefined || op === null ? '' : op).toLowerCase().replace(/[\s_]/g, '');
  return COND_OP_ALIAS[k] || String(op || '');
}

// 常用颜色 → ARGB（OOXML 里 rgb="FFFF0000" 是 ARGB，AI 通道在前）
const COLOR_ALIAS = {
  red: 'FFFF0000', '红': 'FFFF0000', '红色': 'FFFF0000',
  orange: 'FFFFC000', '橙': 'FFFFC000', '橙色': 'FFFFC000',
  yellow: 'FFFFFF00', '黄': 'FFFFFF00', '黄色': 'FFFFFF00',
  green: 'FF00FF00', '绿': 'FF00FF00', '绿色': 'FF00FF00',
  blue: 'FF0000FF', '蓝': 'FF0000FF', '蓝色': 'FF0000FF',
  purple: 'FF800080', '紫': 'FF800080', '紫色': 'FF800080',
  black: 'FF000000', '黑': 'FF000000', '黑色': 'FF000000',
  white: 'FFFFFFFF', '白': 'FFFFFFFF', '白色': 'FFFFFFFF',
  gray: 'FF808080', grey: 'FF808080', '灰': 'FF808080', '灰色': 'FF808080',
  lightred: 'FFFFC7CE', '浅红': 'FFFFC7CE', '浅红色': 'FFFFC7CE',
  lightyellow: 'FFFFEB9C', '浅黄': 'FFFFEB9C', '浅黄色': 'FFFFEB9C',
  lightgreen: 'FFC6EFCE', '浅绿': 'FFC6EFCE', '浅绿色': 'FFC6EFCE',
};

function normColor(c) {
  if (c === undefined || c === null || c === '') return '';
  const raw = String(c).trim();
  const alias = COLOR_ALIAS[raw.toLowerCase()] || COLOR_ALIAS[raw];
  let s = String(alias || raw).toUpperCase().replace(/^#/, '');
  if (/^[0-9A-F]{6}$/.test(s)) s = 'FF' + s;
  return s;
}

function colorMatches(got, want) {
  const a = normColor(got);
  const b = normColor(want);
  return !!a && !!b && a === b;
}

function describeCol(col) {
  const parts = [];
  if (col.custom && col.custom.length) parts.push(col.custom.map((c) => `${c.operator} ${c.val}`).join(' 且 '));
  if (col.values && col.values.length) parts.push('∈{' + col.values.join(',') + '}');
  if (col.top10) parts.push('前 ' + col.top10.val + ' 项');
  if (col.dynamic) parts.push('动态筛选 ' + col.dynamic.type);
  return parts.join(' ') || '(无条件)';
}

function describeFilter(af) {
  const cols = (af.columns || []).map((c) => `第${(c.colId || 0) + 1}列 ${describeCol(c)}`);
  return `${af.ref || ''}${cols.length ? ' — ' + cols.join('；') : '（仅开启筛选，未设条件）'}`;
}

function compareVals(a, b) {
  const na = typeof a === 'number' ? a : num(a);
  const nb = typeof b === 'number' ? b : num(b);
  if (na !== null && nb !== null) return na === nb ? 0 : (na < nb ? -1 : 1);
  const sa = String(a === null || a === undefined ? '' : a);
  const sb = String(b === null || b === undefined ? '' : b);
  return sa.localeCompare(sb, 'zh-CN');
}

function runCheck(check, model, sheet) {
  const fn = CHECKERS[check.kind];
  if (!fn) return { pass: false, got: '(未知检查类型)', want: check.kind, note: `不支持的检查类型：${check.kind}` };
  try {
    return fn({ model, sheet, check });
  } catch (e) {
    return { pass: false, got: '(判分异常)', want: check.kind, note: e.message };
  }
}

// ============================================================
// 七、主入口
// ============================================================

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * 判分
 * @param {Buffer|string} input   xlsx Buffer 或文件路径
 * @param {object} spec           评分点规格（questions.wps_spec 解析后的对象）
 * @returns {Promise<object>}     判分结果
 */
async function gradeFile(input, spec) {
  if (!yauzl) throw new Error('缺少 yauzl 依赖，无法解压 xlsx');
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const specObj = typeof spec === 'string' ? JSON.parse(spec || '{}') : (spec || {});
  const files = await readZip(buffer);
  const model = buildModel(files);

  const g = specObj.grader || {};
  const wantSheetName = g.sheet || specObj.sheet || 'Sheet1';
  let sheet = model.sheets.find((s) => normText(s.name).toLowerCase() === normText(wantSheetName).toLowerCase());
  if (!sheet) sheet = model.sheets[0];
  if (!sheet) throw new Error('工作簿里没有任何工作表');

  const stepsIn = Array.isArray(specObj.steps) ? specObj.steps : [];
  const result = {
    ok: true,
    sheet: sheet.name,
    sheets: model.sheets.map((s) => s.name),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    file_size: buffer.length,
    full_score: 0,
    score: 0,
    percent: 0,
    passed: false,
    steps: [],
  };

  let total = 0;
  let earned = 0;
  for (const st of stepsIn) {
    const checksIn = Array.isArray(st.checks) ? st.checks : [];
    const stepScore = num(st.score) !== null ? num(st.score) : checksIn.reduce((a, c) => a + (num(c.score) || 0), 0);
    const perCheck = checksIn.length ? stepScore / checksIn.length : 0;
    let stepEarned = 0;
    const checks = [];
    for (const c of checksIn) {
      const r = runCheck(c, model, sheet);
      const cs = num(c.score) !== null ? num(c.score) : perCheck;
      const gotScore = r.pass ? cs : 0;
      stepEarned += gotScore;
      checks.push({
        kind: c.kind,
        label: c.label || c.kind,
        pass: !!r.pass,
        score: round2(cs),
        earned: round2(gotScore),
        got: r.got,
        want: r.want,
        note: r.note || '',
      });
    }
    stepEarned = round2(stepEarned);
    total += stepScore;
    earned += stepEarned;
    result.steps.push({
      id: st.id || '',
      title: st.title || '',
      desc: st.desc || '',
      video_url: st.video_url || '',
      score: round2(stepScore),
      obtained: stepEarned,
      pass: checksIn.length ? stepEarned >= round2(stepScore) - 1e-9 : false,
      checks,
    });
  }

  result.full_score = round2(total);
  result.score = round2(earned);
  result.percent = total > 0 ? Math.round((earned / total) * 100) : 0;
  result.passed = total > 0 && Math.abs(earned - total) < 1e-9;
  return result;
}

/** 只做结构摘要（供教师录题时查看，不判分） */
async function inspectFile(input) {
  if (!yauzl) throw new Error('缺少 yauzl 依赖');
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const files = await readZip(buffer);
  const model = buildModel(files);
  const sheets = model.sheets.map((s) => {
    const cells = [];
    for (const c of s.cells.values()) {
      if (c.formula || c.value !== null) {
        const xf = model.styles.cellXfs[c.styleIndex] || {};
        const font = model.styles.fonts[xf.fontId] || {};
        const code = model.styles.numFmts[xf.numFmtId];
        cells.push({
          ref: c.ref,
          value: c.value,
          formula: c.formula ? '=' + c.formula : null,
          font: { name: font.name, size: font.size, bold: !!font.bold },
          align: xf.alignment ? xf.alignment.horizontal : null,
          numFmt: code,
          decimals: decimalsFromFormat(code),
        });
      }
    }
    return { name: s.name, merges: s.merges, charts: s.charts, cells };
  });
  return {
    ok: true,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    file_size: buffer.length,
    parts: model.fileList.length,
    sheets,
  };
}

// ============================================================
// 八、从"标准答案文件"自动生成评分点骨架（录题提效）
// ============================================================

function suggestSpecFromModel(model, opts = {}) {
  const sheetName = opts.sheet || (model.sheets[0] ? model.sheets[0].name : 'Sheet1');
  const sheet = model.sheets.find((s) => s.name === sheetName) || model.sheets[0];
  if (!sheet) return { version: 1, full_score: Number(opts.full_score) || 100, grader: { sheet: sheetName }, steps: [] };

  const steps = [];
  const mergesMulti = sheet.merges.filter((m) => rangeCells(m).length > 1);

  // 步骤一：合并与标题排版
  if (mergesMulti.length) {
    const checks = [];
    for (const m of mergesMulti) {
      checks.push({ kind: 'merged', range: m, score: 1, label: `合并 ${m}` });
      const anchor = rangeCells(m)[0];
      const cell = sheet.cells.get(anchor);
      if (cell) {
        if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') {
          checks.push({ kind: 'cell_text', ref: anchor, text: String(cell.value), score: 1, label: '标题文字' });
        }
        const xf = model.styles.cellXfs[cell.styleIndex] || {};
        const font = model.styles.fonts[xf.fontId] || {};
        if (font.name || font.bold || font.size) {
          checks.push({ kind: 'font', ref: anchor, name: font.name || undefined, bold: !!font.bold, size: font.size || undefined, score: 1, label: '字体设置' });
        }
        if (xf.alignment && xf.alignment.horizontal) {
          checks.push({ kind: 'align', ref: anchor, horizontal: xf.alignment.horizontal, score: 1, label: '对齐方式' });
        }
      }
    }
    steps.push({ id: 's1', title: '合并单元格并设置标题格式', desc: '', video_url: '', score: checks.reduce((a, c) => a + c.score, 0), checks });
  }

  // 步骤二：公式计算
  const formulaCells = [];
  for (const c of sheet.cells.values()) if (c.formula && c.type === 'n') formulaCells.push(c);
  if (formulaCells.length) {
    const checks = [];
    for (const c of formulaCells) {
      const isSum = /^SUM\s*\(/i.test(c.formula);
      if (isSum) {
        const rng = /SUM\s*\(\s*([^)]+)\)/i.exec(c.formula);
        checks.push({ kind: 'sum_range', ref: c.ref, range: rng ? normRange(rng[1]) : '', score: 1, label: `${c.ref} 求和` });
      } else {
        checks.push({ kind: 'cell_has_formula', ref: c.ref, score: 1, label: `${c.ref} 使用公式` });
        checks.push({ kind: 'formula_tokens', ref: c.ref, tokens: (c.formula.match(/[A-Z]+\d+/g) || []), score: 1, label: `${c.ref} 公式引用正确` });
      }
      if (typeof c.value === 'number') {
        checks.push({ kind: 'cell_value', ref: c.ref, value: Math.round(c.value * 100) / 100, tol: 0.5, score: 1, label: `${c.ref} 结果正确` });
        const xf = model.styles.cellXfs[c.styleIndex] || {};
        const dec = decimalsFromFormat(model.styles.numFmts[xf.numFmtId]);
        if (dec === 0 || Math.abs(c.value - Math.round(c.value)) < 1e-9) {
          checks.push({ kind: 'integer_display', ref: c.ref, score: 1, label: `${c.ref} 不保留小数` });
        }
      }
    }
    steps.push({ id: 's2', title: '利用公式完成计算', desc: '', video_url: '', score: checks.reduce((a, c) => a + c.score, 0), checks });
  }

  // 步骤三：图表
  for (const chart of sheet.charts) {
    const s0 = chart.series[0] || {};
    steps.push({
      id: 's' + (steps.length + 1),
      title: '插入图表',
      desc: '',
      video_url: '',
      score: 15,
      checks: [{
        kind: 'chart', index: 0, score: 15, label: '图表',
        chartType: chart.chartType || undefined,
        barDir: chart.chartType === 'bar' ? (chart.barDir || undefined) : undefined,
        title: chart.title || undefined,
        catRange: s0.cat || undefined,
        valRange: s0.val || undefined,
      }],
    });
  }

  // 步骤四：排序（优先信 sortState；没有就启发式找"严格有序的数值列"）
  const sortChecks = [];
  if (sheet.sortState && sheet.sortState.conditions.length) {
    const refRange = sheet.sortState.ref ? normRange(sheet.sortState.ref) : null;
    for (const c0 of sheet.sortState.conditions) {
      const col = parseRef(c0.ref).col;
      let colRange = null;
      if (refRange) {
        const cs = rangeCells(refRange).filter((r) => parseRef(r).col === col);
        if (cs.length > 1) colRange = `${cs[0]}:${cs[cs.length - 1]}`;
      }
      if (!colRange) continue;
      sortChecks.push({
        kind: 'sorted_range', score: 10, colRange,
        label: `按第 ${col} 列${c0.descending ? '降' : '升'}序排序`,
        range: colRange, col, order: c0.descending ? 'desc' : 'asc',
      });
    }
  } else {
    // 启发式：找 ≥4 行、严格有序的数值列（跳过第 1 列，避免误判序号/文本列）
    const used = new Set();
    for (const c of sheet.cells.values()) {
      if (c.type !== 'n' || c.formula) continue;
      const p = parseRef(c.ref);
      if (p.col === 1 || used.has(p.col)) continue;
      const colCells = Array.from(sheet.cells.values())
        .filter((x) => parseRef(x.ref).col === p.col && x.type === 'n')
        .sort((a, b) => parseRef(a.ref).r - parseRef(b.ref).r);
      if (colCells.length < 4) continue;
      const vs = colCells.map((x) => Number(x.value));
      const asc = vs.every((v, i) => i === 0 || v > vs[i - 1]);
      const desc = vs.every((v, i) => i === 0 || v < vs[i - 1]);
      if (!asc && !desc) continue;
      used.add(p.col);
      const colRange = `${colCells[0].ref}:${colCells[colCells.length - 1].ref}`;
      sortChecks.push({
        kind: 'sorted_range', score: 10,
        label: `第 ${p.col} 列${desc ? '降' : '升'}序（疑似排序，请确认）`,
        range: colRange, col: p.col, order: desc ? 'desc' : 'asc',
      });
    }
  }
  if (sortChecks.length) {
    steps.push({
      id: 's' + (steps.length + 1),
      title: '数据排序',
      desc: '',
      video_url: '',
      score: sortChecks.reduce((a, c) => a + c.score, 0),
      checks: sortChecks.map((c) => ({ ...c, colRange: undefined })),
    });
  }

  // 步骤五：自动筛选
  if (sheet.autoFilter) {
    const af = sheet.autoFilter;
    const cols = (af.columns || []).map((c) => {
      const o = { col: (c.colId || 0) + 1 };
      if (c.custom && c.custom.length) { o.op = c.custom[0].operator; o.value = c.custom[0].val; }
      if (c.values && c.values.length) o.values = c.values;
      return o;
    });
    const hasCond = cols.length > 0;
    steps.push({
      id: 's' + (steps.length + 1),
      title: '自动筛选',
      desc: '',
      video_url: '',
      score: hasCond ? 10 : 5,
      checks: [{
        kind: 'auto_filter',
        score: hasCond ? 10 : 5,
        label: hasCond ? '按条件筛选' : '开启自动筛选',
        range: af.ref || undefined,
        columns: hasCond ? cols : undefined,
      }],
    });
  }

  // 步骤六：分类汇总
  const subCells = [];
  for (const c of sheet.cells.values()) {
    if (c.formula && /^SUBTOTAL\((\d+),/i.test(normFormula(c.formula))) subCells.push(c);
  }
  if (subCells.length) {
    const code = Number(/^SUBTOTAL\((\d+),/i.exec(normFormula(subCells[0].formula))[1]) % 100;
    const fnName = Object.keys(SUBTOTAL_FN).find((k) => SUBTOTAL_FN[k] === code) || 'sum';
    steps.push({
      id: 's' + (steps.length + 1),
      title: '分类汇总',
      desc: '',
      video_url: '',
      score: 10,
      checks: [{
        kind: 'subtotal', score: 10,
        label: `${fnName === 'sum' ? '求和' : fnName}分类汇总`,
        fn: fnName,
        minCount: Math.max(1, subCells.length - 1),
        requireOutline: true,
      }],
    });
  }

  // 步骤七：条件格式（每条规则一个评分点）
  for (const cf of (sheet.condFormats || [])) {
    for (const r of cf.rules) {
      const dxf = (r.dxfId !== null && r.dxfId !== undefined) ? (model.styles.dxfs || [])[r.dxfId] : null;
      const chk = {
        kind: 'cond_format', score: 10,
        label: `条件格式 ${cf.sqref}${r.operator ? ' ' + r.operator : ''}`,
        range: cf.sqref,
      };
      if (r.type) chk.type = r.type;
      if (r.operator) chk.operator = r.operator;
      if (r.formulas && r.formulas[0] !== undefined) chk.value = r.formulas[0];
      if (dxf && dxf.fillColor) chk.fillColor = dxf.fillColor;
      steps.push({
        id: 's' + (steps.length + 1),
        title: '条件格式',
        desc: '',
        video_url: '',
        score: 10,
        checks: [chk],
      });
    }
  }

  // 按 100 分制输出：先给每类一个基础分，再整体等比缩放到目标满分
  const FULL = Number(opts.full_score) || 100;
  const sum = steps.reduce((a, s) => a + s.checks.reduce((x, c) => x + (Number(c.score) || 0), 0), 0);
  if (sum > 0 && Math.abs(sum - FULL) > 0.01) {
    const k = FULL / sum;
    const all = steps.flatMap((s) => s.checks);
    let acc = 0;
    all.forEach((c, i) => {
      if (i === all.length - 1) {
        c.score = round2(FULL - acc);
      } else {
        c.score = round2((Number(c.score) || 0) * k);
        acc += c.score;
      }
    });
    for (const s of steps) s.score = round2(s.checks.reduce((a, c) => a + c.score, 0));
  }

  return {
    version: 1,
    full_score: FULL,
    grader: { sheet: sheetName },
    template: opts.template || undefined,
    steps,
  };
}

async function suggestSpec(input, opts = {}) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const files = await readZip(buffer);
  const model = buildModel(files);
  return suggestSpecFromModel(model, opts);
}

/** 校验评分点总分为满分一致（录题时提示用） */
function validateSpec(spec, expectFull) {
  const s = typeof spec === 'string' ? JSON.parse(spec || '{}') : (spec || {});
  const warnings = [];
  const errors = [];
  if (!Array.isArray(s.steps) || s.steps.length === 0) errors.push('未配置任何步骤');
  let sum = 0;
  (s.steps || []).forEach((st, i) => {
    const checks = Array.isArray(st.checks) ? st.checks : [];
    if (!checks.length) warnings.push(`步骤 ${i + 1}「${st.title || ''}」没有评分点，该步骤不会得分`);
    let inner = 0;
    checks.forEach((c, j) => {
      if (!CHECKERS[c.kind]) errors.push(`步骤 ${i + 1} 第 ${j + 1} 个评分点的类型「${c.kind}」不受支持`);
      inner += num(c.score) || 0;
    });
    const stepScore = num(st.score);
    if (stepScore !== null && checks.length && Math.abs(inner - stepScore) > 1e-9) {
      warnings.push(`步骤 ${i + 1}「${st.title || ''}」评分点分数合计 ${inner} 与步骤分 ${stepScore} 不一致（将按评分点分数计分）`);
    }
    sum += checks.reduce((a, c) => a + (num(c.score) || 0), 0);
  });
  const full = expectFull !== undefined ? num(expectFull) : num(s.full_score);
  if (full !== null && Math.abs(sum - full) > 1e-9) {
    warnings.push(`评分点总分 ${round2(sum)} 与题目满分 ${full} 不一致`);
  }
  return { ok: errors.length === 0, errors, warnings, total: round2(sum), full_score: full };
}

/**
 * 读取 xlsx → { files, model }。
 * 脚本/接口想直接拿模型做分析（而不是走完整判分）时用。
 */
async function loadModel(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const files = await readZip(buffer);
  return { files, model: buildModel(files) };
}

module.exports = {
  gradeFile,
  inspectFile,
  suggestSpec,
  suggestSpecFromModel,
  validateSpec,
  loadModel,
  parseXml,
  buildModel,
  parseStyles,
  decimalsFromFormat,
  rangeCells,
  normRange,
  normFormula,
  CHECKERS,
  CHECK_KINDS: Object.keys(CHECKERS),
};
