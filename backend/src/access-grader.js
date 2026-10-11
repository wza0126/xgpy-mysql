/**
 * Access 操作题判分引擎（纯 Node；与 wps-grader.js 同构，管的是 .accdb 而不是 OOXML）
 * ============================================================
 * 判分模型完全复用 WPS 那套：spec.steps[].checks[]，每 check 有 kind + score，
 *   step 得分 = 通过 check 的分值之和；总分 = 各 step 之和。
 *
 * 底层读库用 `./vendor/mdb-reader.cjs`（mdb-reader 的 CJS 打包产物，见 vendor/README.md）。
 * ⛔ 上游 **不解析索引/主键**，主键要自己从表的 TDEF 页里解（学生最爱考的操作就是"设主键"）。
 *
 * 支持范围（一期 9 类 + 二期 4 类，共 13 类检查器）：
 *   一期：accdb_table · accdb_columns · accdb_column_type · accdb_primary_key ·
 *         accdb_rows · accdb_row_update · accdb_sort · accdb_filter · accdb_object
 *   二期：accdb_query（查询：存在/数据源/输出列/条件/分组/排序）
 *         accdb_relation（表间关系，过滤系统关系 grbit&0x1000）
 *         accdb_field_format（字段格式，LvProp 启发式识别，⛔ 实验性）
 *         accdb_export（导出附件：txt/csv/xlsx，判 extras 文件）
 * ⛔ 判分只认 .accdb 文件本身，不关心是谁产出的（真 Access / WPS / 未来在线编辑都走同一套）。
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');

let MDBReader = null;
let Database = null;
try {
  const m = require('./vendor/mdb-reader.cjs');
  MDBReader = m.default || m.MDBReader;
  Database = m.Database;
} catch (e) {
  /* 调用时再报错，便于脚本单独引入本模块做单测 */
}

// ============================================================
// 一、常量与工具
// ============================================================

/** 一行最多读这么多（防止畸形库把内存吃满） */
const MAX_ROWS = Number(process.env.ACCESS_MAX_ROWS || 20000);

/** Jet4/ACE 表定义页（TDEF）里"索引段"的固定布局（与 mdb-reader 的 TDEF buffer 对齐） */
const IDX = {
  colBlockSize: 52,        // ④ 索引列定义
  colSkipBefore: 4,
  colGroupSize: 3,         // (col_id u16 + order u8)
  maxIndexColumns: 10,
  infoBlockSize: 28,       // ⑤ 逻辑索引
  infoTypeOffset: 23,      // 索引类型：0x01=普通/主键，0x02=外键
  indexTypeNormal: 0x01,
};

function normText(s) {
  return String(s === null || s === undefined ? '' : s).replace(/\u3000/g, ' ').trim();
}
function normName(s) {
  return normText(s).toLowerCase();
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** 宽松相等：数字按数值比，其他按去空白/大小写不敏感比 */
function looseEq(a, b) {
  if (a === null || a === undefined) a = '';
  if (b === null || b === undefined) b = '';
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return toBool(a) === toBool(b);
  }
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null && String(a).trim() !== '' && String(b).trim() !== '') {
    return Math.abs(na - nb) < 1e-9;
  }
  if (a instanceof Date || b instanceof Date) {
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    if (!isNaN(da) && !isNaN(db)) return Math.abs(da.getTime() - db.getTime()) < 1000;
  }
  return normName(a) === normName(b);
}
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = normName(v);
  return s === 'true' || s === '1' || s === '是' || s === 'yes' || s === '-1';
}
/** 行（对象）是否包含期望的键值对（子集匹配） */
function rowMatches(row, expect) {
  if (!expect || typeof expect !== 'object') return false;
  for (const [k, v] of Object.entries(expect)) {
    let key = null;
    for (const c of Object.keys(row)) { if (normName(c) === normName(k)) { key = c; break; } }
    if (key === null) return false;
    if (!looseEq(row[key], v)) return false;
  }
  return true;
}
function describeRow(row, cols) {
  const keys = cols && cols.length ? cols : Object.keys(row).slice(0, 4);
  return keys.map((k) => `${k}=${row[k] === null || row[k] === undefined ? '' : row[k]}`).join('，');
}

/** MSysQueries.Order 是 4 字节小端 buffer → 序号 */
function orderOf(b) {
  if (Buffer.isBuffer(b) && b.length >= 4) return b.readUInt32LE(b.length - 4);
  return num(b) || 0;
}
/** 表达式归一化：去空白 / [] / .（用于"查询里是否含某列"这类宽松匹配） */
function normExprKey(s) {
  return normName(s).replace(/[\[\]\s.]/g, '');
}
/** 文本附件解码：BOM/UTF-8 优先，非法序列回退 GBK（学测机房默认 GBK 存 txt 很常见） */
function decodeTextBuffer(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let s = b.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (!/\ufffd/.test(s)) return s;
  try { return new TextDecoder('gbk').decode(b); } catch { return s; }
}

// ============================================================
// 二、Access 字段类型归一化
// ============================================================

/** mdb-reader 的 type → Access 界面上的类型名 */
const TYPE_LABEL = {
  boolean: '是/否',
  byte: '字节',
  integer: '整型',
  long: '长整型',
  currency: '货币',
  float: '单精度',
  double: '双精度',
  datetime: '日期/时间',
  binary: '二进制',
  text: '短文本',
  memo: '长文本',
  ole: 'OLE对象',
  numeric: '数字',
  bigint: '大数',
  repid: '复制ID',
  complex: '复杂类型',
};

/** 教师可写的 type 别名 → 归一化 token */
const TYPE_ALIAS = {
  text: 'text', 短文本: 'text', 文本: 'text', 字符串: 'text',
  memo: 'memo', 长文本: 'memo', 备注: 'memo',
  byte: 'byte', 字节: 'byte',
  integer: 'integer', 整型: 'integer', 短整型: 'integer',
  long: 'long', 长整型: 'long',
  autonumber: 'autonumber', 自动编号: 'autonumber',
  single: 'single', 单精度: 'single', float: 'single',
  double: 'double', 双精度: 'double',
  currency: 'currency', 货币: 'currency',
  date: 'date', datetime: 'date', 日期时间: 'date', 日期: 'date',
  boolean: 'boolean', 是否: 'boolean', 是或否: 'boolean', bool: 'boolean',
  number: 'number', numeric: 'number', 数字: 'number',
  bigint: 'bigint', 大数: 'bigint',
  ole: 'ole',
};

function normType(t) {
  const k = normName(t).replace(/[\s/\\-]/g, '');
  if (TYPE_ALIAS[k]) return TYPE_ALIAS[k];
  const k2 = normName(t);
  return TYPE_ALIAS[k2] || k2 || null;
}

/**
 * 把一个列定义映射成"归一化类型 token + 说明"。
 * ⚠️ 字段大小：短文本在库里 size 是**字节数**（2× 字符数）；整型 size=2、长整型 size=4。
 */
function columnKind(col) {
  const t = col.type;
  if (col.autonumber) return { token: 'autonumber', label: '自动编号', size: null };
  switch (t) {
    case 'text': return { token: 'text', label: '短文本', size: Math.floor(col.size / 2) };
    case 'memo': return { token: 'memo', label: '长文本', size: null };
    case 'byte': return { token: 'byte', label: '字节', size: 1 };
    case 'integer': return { token: 'integer', label: '整型', size: 2 };
    case 'long': return { token: 'long', label: '长整型', size: 4 };
    case 'float': return { token: 'single', label: '单精度', size: 4 };
    case 'double': return { token: 'double', label: '双精度', size: 8 };
    case 'currency': return { token: 'currency', label: '货币', size: 8 };
    case 'datetime': return { token: 'date', label: '日期/时间', size: 8 };
    case 'boolean': return { token: 'boolean', label: '是/否', size: 1 };
    case 'numeric': return { token: 'number', label: '数字', size: null };
    case 'bigint': return { token: 'bigint', label: '大数', size: 8 };
    case 'ole': return { token: 'ole', label: 'OLE对象', size: null };
    default: return { token: t || 'unknown', label: TYPE_LABEL[t] || t || '未知', size: col.size };
  }
}

// ============================================================
// 三、TDEF：解析索引 / 主键（mdb-reader 不管这块）
// ============================================================

/** 顺序读取 count 个 `u16 字节长度 + UCS-2` 字符串 */
function readNameList(buf, pos, count) {
  const names = [];
  let p = pos;
  for (let i = 0; i < count; i++) {
    if (p + 2 > buf.length) { names.push(''); continue; }
    const len = buf.readUInt16LE(p);
    p += 2;
    const end = Math.min(p + len, buf.length);
    let s = '';
    for (let k = p; k + 1 < end; k += 2) s += String.fromCharCode(buf.readUInt16LE(k));
    p += len;
    names.push(s);
  }
  return { names, end: p };
}

/** 拼接一张表的多页 TDEF（首页整页 + 后续页跳过 8 字节页头） */
function buildDefinitionBuffer(db, firstPage) {
  let next = firstPage;
  let buf = null;
  let guard = 0;
  while (next > 0 && guard++ < 1000) {
    const cur = db.getPage(next);
    buf = buf ? Buffer.concat([buf, cur.slice(8)]) : cur;
    next = cur.readUInt32LE(4);
  }
  return buf;
}

/**
 * 解析一张表的全部索引。
 * ⛔ 主键判定：indexType===1 且索引名 === 'PrimaryKey'（Access 建主键时的默认名）。
 *    绝不能用"全文件搜 PrimaryKey"，系统导入表也有同名索引，会误判。
 * @returns {{name:string,indexType:number,isPrimary:boolean,columns:{name:string,order:string}[]}[]}
 */
function parseIndexes(db, reader, tableName) {
  const fmt = db.format && db.format.tableDefinitionPage;
  if (!fmt) return [];
  const sys = reader.getTable('MSysObjects').getData({ columns: ['Id', 'Name', 'Type'] });
  const obj = sys.find((r) => String(r.Name) === tableName && (Number(r.Type) & 0x7f) === 1);
  if (!obj) return [];

  const firstPage = Number(obj.Id) & 0x00ffffff;
  const buf = buildDefinitionBuffer(db, firstPage);
  if (!buf) return [];

  const numCols = buf.readUInt16LE(fmt.columnCountOffset);
  const numRealIdx = buf.readInt32LE(fmt.realIndexCountOffset);
  const numIdx = buf.readInt32LE(fmt.logicalIndexCountOffset);
  if (numCols <= 0 || numCols > 1000 || numRealIdx < 0 || numIdx < 0) return [];

  // ② 列定义 → 列号
  const colDefStart = fmt.realIndexStartOffset + numRealIdx * fmt.realIndexEntrySize;
  const colEntrySize = fmt.columnsDefinition.entrySize;
  const colNumOffset = fmt.columnsDefinition.indexOffset;
  if (colDefStart + numCols * colEntrySize > buf.length) return [];
  const colNums = [];
  for (let i = 0; i < numCols; i++) colNums.push(buf.readUInt8(colDefStart + i * colEntrySize + colNumOffset));

  // ③ 列名
  const { names: colNames, end: namesEnd } = readNameList(buf, colDefStart + numCols * colEntrySize, numCols);
  const numToName = {};
  colNames.forEach((n, i) => { numToName[colNums[i]] = n; });

  // ④ 索引列定义（52B/条）
  let p = namesEnd;
  const idxColDefs = [];
  for (let i = 0; i < numRealIdx; i++) {
    const start = p;
    if (start + IDX.colBlockSize > buf.length) break;
    p += IDX.colSkipBefore;
    const cols = [];
    for (let k = 0; k < IDX.maxIndexColumns; k++) {
      const colId = buf.readUInt16LE(p);
      const orderFlag = buf.readUInt8(p + 2);
      p += IDX.colGroupSize;
      if (colId !== 0xffff) cols.push({ colNum: colId, order: orderFlag === 0x01 ? 'ASC' : 'DESC' });
    }
    p += 4;                                   // 跳过
    const firstDataPage = buf.readUInt32LE(p); p += 4;
    p += 4;                                   // 跳过
    const flags = buf.readUInt8(p); p += 1;
    p += 5;                                   // 跳过
    idxColDefs.push({ cols, flags, firstDataPage });
  }

  // ⑤ 逻辑索引（28B/条）
  const logical = [];
  for (let i = 0; i < numIdx; i++) {
    const start = p;
    if (start + IDX.infoBlockSize > buf.length) break;
    const indexColEntry = buf.readUInt32LE(start + 8);
    const indexType = buf.readUInt8(start + IDX.infoTypeOffset);
    logical.push({ indexColEntry, indexType });
    p = start + IDX.infoBlockSize;
  }

  // ⑥ 索引名
  const { names: idxNames } = readNameList(buf, p, numIdx);

  return logical.map((li, i) => {
    const def = idxColDefs[li.indexColEntry] || { cols: [], flags: 0 };
    const name = idxNames[i] || '';
    return {
      name,
      indexType: li.indexType,
      isPrimary: li.indexType === IDX.indexTypeNormal && name === 'PrimaryKey',
      flags: def.flags,
      columns: def.cols.map((c) => ({ name: numToName[c.colNum] !== undefined ? numToName[c.colNum] : `#${c.colNum}`, order: c.order })),
    };
  });
}

// ============================================================
// 四、LvProp：表属性流（排序 / 筛选 / 字段显示格式）
// ============================================================
/**
 * LvProp 是 MSysObjects 上的一个二进制属性流。结构：
 *   [ "MR2\0" ][ u32 名字表字节数 ][ u16 ? ][ 名字表: (u16 字节长 + UCS-2)* ][ 值区 ]
 * 名字表里能看到 OrderBy / OrderByOn / Filter / Format / InputMask / DefaultValue …
 * 值区的记录格式没有官方文档，且柱状属性（每列一个 Format 等）很绕。
 * 一期只取"表级"的排序列与筛选条件——用**字符串特征**识别，稳且够用：
 *   · OrderBy 值形如 `"[表].[字段] DESC"`（外层带引号，结尾必须是 ASC/DESC）
 *   · Filter  值形如 `[字段] = "值"` / `[字段] Like "*x*"`
 * ⚠️ 流内字符串**未必按 2 字节对齐** → 必须**双奇偶**各扫一遍（否则全体错位）。
 */
function extractUcs2Strings(buf, minLen) {
  const out = [];
  const min = minLen || 2;
  if (!Buffer.isBuffer(buf)) return out;
  for (let parity = 0; parity < 2; parity++) {
    let cur = '';
    let start = -1;
    for (let i = parity; i + 1 < buf.length; i += 2) {
      const c = buf.readUInt16LE(i);
      const printable = c >= 0x20 && c !== 0x7f;
      if (printable) {
        if (cur === '') start = i;
        cur += String.fromCharCode(c);
      } else {
        if (cur.length >= min) out.push({ off: start, text: cur });
        cur = '';
      }
    }
    if (cur.length >= min) out.push({ off: start, text: cur });
  }
  // 同 off 去重（奇偶扫描会互相看到对方）
  const seen = new Set();
  return out.filter((s) => {
    const k = s.off + '::' + s.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 从 LvProp 里解出表级排序列 / 筛选条件（解不出就返回 null，不报错） */
function parseLvProps(lvProp) {
  const res = { orderBy: null, orderByOn: false, filter: null, strings: [] };
  if (!Buffer.isBuffer(lvProp) || !lvProp.length) return res;
  let strs = [];
  try { strs = extractUcs2Strings(lvProp, 3); } catch { return res; }
  res.strings = strs.map((s) => s.text);

  // —— OrderBy：形如 "[表].[字段] DESC" 或 "[字段1] ASC, [字段2] DESC"
  for (const { text } of strs) {
    const t = text.trim().replace(/^["']|["']$/g, '');
    if (!/\b(ASC|DESC)\s*$/i.test(t)) continue;       // ⚠️ 必须以 ASC/DESC 结尾（Description 里的 "desc" 不误报）
    if (!/\[[^\]]+\]/.test(t)) continue;
    const cols = [];
    const re = /\[([^\]]+)\]\s*(?:\.\s*\[([^\]]+)\])?\s*(ASC|DESC)/gi;
    let m;
    while ((m = re.exec(t))) {
      cols.push({ column: (m[2] || m[1]).trim(), order: m[3].toUpperCase() });
    }
    if (cols.length) { res.orderBy = { raw: text, columns: cols }; res.orderByOn = true; break; }
  }

  // —— Filter：形如 "[字段] = \"值\"" / "[字段] Like \"*x*\""
  for (const { text } of strs) {
    const t = text.trim().replace(/^["']|["']$/g, '');
    if (!/\[[^\]]+\]/.test(t)) continue;
    if (!/(=|<>|>=|<=|>|<|\bLike\b|\bBetween\b)/i.test(t)) continue;
    if (/\b(ASC|DESC)\s*$/i.test(t)) continue;        // 别把 OrderBy 当 Filter
    const m = /\[([^\]]+)\]\s*(?:\.\s*\[([^\]]+)\])?\s*(=|<>|>=|<=|>|<|Like|Between)\s*(.+)$/i.exec(t);
    if (m) {
      res.filter = { raw: text, column: (m[2] || m[1]).trim(), op: m[3], value: m[4].replace(/^["']|["']$/g, '').trim() };
      break;
    }
  }
  return res;
}

// ============================================================
// 五、建模
// ============================================================

/** Access 对象类型（MSysObjects.Type & 0x7f） */
const OBJ_TYPE = { table: 1, query: 5, form: 0xfffffffc & 0x7f, report: 0xfffffffd & 0x7f, macro: 4, module: 2 };

/**
 * 把 .accdb 读成判分用的模型。
 * @param {Buffer} buffer
 */
function buildModel(buffer) {
  if (!MDBReader) throw new Error('缺少 mdb-reader 依赖（vendor/mdb-reader.cjs）');
  const reader = new MDBReader(buffer);
  const db = new Database(buffer, '');

  let sysRows = [];
  try {
    sysRows = reader.getTable('MSysObjects').getData({ columns: ['Id', 'Name', 'Type', 'Flags', 'LvProp'] });
  } catch (e) {
    sysRows = [];
  }

  // 可见表名单：mdb-reader 已经帮我们滤掉了系统表与**隐藏表**
  // （Access 导入 xlsx 会留下 `f_xxxx_Data` 之类的隐藏临时表，不能算学生的表）
  let visibleTables = new Set();
  try {
    visibleTables = new Set(reader.getTableNames().map((n) => normName(n)));
  } catch (e) {
    visibleTables = null; // 读不出来就不做隐藏过滤
  }

  const objects = [];
  const tables = [];
  for (const r of sysRows) {
    const name = normText(r.Name);
    if (!name) continue;
    const rawType = Number(r.Type);
    const type = rawType & 0x7f;
    objects.push({ name, type, type_raw: rawType, flags: Number(r.Flags) || 0 });
    if (type !== 1) continue;               // 只把"表"建成完整模型
    if (/^MSys/i.test(name)) continue;      // 系统表跳过
    if (visibleTables && !visibleTables.has(normName(name))) continue; // 隐藏表跳过

    const item = {
      name,
      columns: [],
      rows: [],
      rowCount: 0,
      indexes: [],
      primaryKey: null,
      props: { orderBy: null, orderByOn: false, filter: null, strings: [] },
      error: null,
    };
    try {
      const t = reader.getTable(name);
      item.columns = t.getColumns().map((c, i) => ({
        name: c.name,
        type: c.type,
        size: c.size,
        nullable: !!c.nullable,
        fixedLength: !!c.fixedLength,
        autonumber: !!c.autoLong,
        index: i,
      }));
      item.rowCount = t.rowCount;
      try { item.rows = t.getData({ rowLimit: MAX_ROWS }); } catch (e) { item.rowError = e.message; }
      try { item.indexes = parseIndexes(db, reader, name); } catch (e) { item.indexError = e.message; }
      item.primaryKey = item.indexes.find((ix) => ix.isPrimary) || null;
      item.props = parseLvProps(r.LvProp);
    } catch (e) {
      item.error = e.message;
    }
    tables.push(item);
  }

  // —— 查询（二期）：MSysObjects.Type&0x7f===5，定义行在 MSysQueries 里按 ObjectId 分组
  //     Attribute 语义（实测 + jackcess 口径）：5=FROM 表 · 6=输出列(Expression,别名 Name1) ·
  //     8=WHERE · 9=GROUP BY · 11=ORDER BY · 3=查询类型标记 · 255=远程库
  //     ⛔ `~sq_` 开头是向导/控件行来源生成的隐藏查询，不算学生创建的
  const queries = [];
  try {
    const qRows = reader.getTable('MSysQueries').getData({});
    const byId = new Map();
    for (const r of qRows) {
      const id = String(r.ObjectId);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(r);
    }
    for (const r of sysRows) {
      if ((Number(r.Type) & 0x7f) !== 5) continue;
      const name = normText(r.Name);
      if (!name || name.startsWith('~sq_')) continue;
      const rows = byId.get(String(r.Id)) || [];
      const pick = (attr) => rows
        .filter((x) => Number(x.Attribute) === attr)
        .sort((a, b) => orderOf(a.Order) - orderOf(b.Order));
      queries.push({
        name,
        tables: pick(5).map((x) => normText(x.Name1)).filter(Boolean),
        select: pick(6).map((x) => ({ alias: normText(x.Name1) || '', expr: normText(x.Expression) || '' })),
        where: pick(8).map((x) => normText(x.Expression) || ''),
        groupBy: pick(9).map((x) => normText(x.Expression) || ''),
        orderBy: pick(11).map((x) => normText(x.Expression) || ''),
        rawCount: rows.length,
      });
    }
  } catch (e) { /* 读不出查询就让检查器报"不存在"，不影响其他判分 */ }

  // —— 表间关系（二期）：MSysRelationships，多列关系按 szRelationship 分组合并
  //     ⛔ grbit&0x1000 是系统关系（导航窗格 / MSysAccessStorage），必须过滤
  const relations = [];
  try {
    const rRows = reader.getTable('MSysRelationships').getData({});
    const groups = new Map();
    for (const r of rRows) {
      const grbit = Number(r.grbit) || 0;
      if (grbit & 0x1000) continue;
      const key = normText(r.szRelationship);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { name: key, grbit, columns: [] });
      groups.get(key).columns.push({
        table: normText(r.szObject),
        column: normText(r.szColumn),
        refTable: normText(r.szReferencedObject),
        refColumn: normText(r.szReferencedColumn),
      });
    }
    relations.push(...groups.values());
  } catch (e) { /* 同上 */ }

  const byName = new Map();
  for (const t of tables) byName.set(normName(t.name), t);
  const objectByName = new Map();
  for (const o of objects) objectByName.set(normName(o.name), o);
  const queryByName = new Map();
  for (const q of queries) queryByName.set(normName(q.name), q);

  return {
    tables,
    tableNames: tables.map((t) => t.name),
    byName,
    objects,
    objectByName,
    objectNames: objects.map((o) => o.name),
    queries,
    queryNames: queries.map((q) => q.name),
    queryByName,
    relations,
    reader,
    db,
  };
}

function findTable(model, name) {
  if (!name) return null;
  return model.byName.get(normName(name)) || null;
}

// ============================================================
// 六、检查器
// ============================================================

const CHECKERS = {
  /** 表存在 / 不存在（删表题用 absent:true） */
  accdb_table({ model, check }) {
    const want = normText(check.table || check.name);
    const hit = findTable(model, want);
    const absent = !!check.absent;
    const pass = absent ? !hit : !!hit;
    return {
      pass,
      got: hit ? '存在' : '不存在',
      want: absent ? `表「${want}」不存在` : `表「${want}」存在`,
      note: model.tableNames.length ? `库中表：${model.tableNames.join('、')}` : '库中没有任何表',
    };
  },

  /** 字段（列）名与顺序 */
  accdb_columns({ model, check }) {
    const t = findTable(model, check.table);
    if (!t) return { pass: false, got: '表不存在', want: `表「${check.table}」` };
    const actual = t.columns.map((c) => c.name);
    const want = Array.isArray(check.columns) ? check.columns.map(normText) : null;
    const contains = Array.isArray(check.contains) ? check.contains.map(normText) : null;
    const absent = Array.isArray(check.absent) ? check.absent.map(normText) : null;

    const notes = [];
    let pass = true;
    if (want) {
      if (check.unordered) {
        const a = actual.map(normName).sort();
        const b = want.map(normName).sort();
        const same = a.length === b.length && a.every((x, i) => x === b[i]);
        if (!same) pass = false;
        notes.push('忽略顺序');
      } else {
        const same = actual.length === want.length && actual.every((x, i) => normName(x) === normName(want[i]));
        if (!same) pass = false;
      }
    }
    if (contains) {
      for (const w of contains) if (!actual.some((a) => normName(a) === normName(w))) { pass = false; notes.push(`缺字段「${w}」`); }
    }
    if (absent) {
      for (const w of absent) if (actual.some((a) => normName(a) === normName(w))) { pass = false; notes.push(`多出字段「${w}」`); }
    }
    return {
      pass,
      got: actual.join('、') || '(无字段)',
      want: [want ? want.join('、') : null, contains ? `包含 ${contains.join('、')}` : null, absent ? `不含 ${absent.join('、')}` : null].filter(Boolean).join(' / '),
      note: notes.join('；'),
    };
  },

  /** 字段类型 / 字段大小 */
  accdb_column_type({ model, check }) {
    const t = findTable(model, check.table);
    if (!t) return { pass: false, got: '表不存在', want: `表「${check.table}」` };
    const col = t.columns.find((c) => normName(c.name) === normName(check.column));
    if (!col) return { pass: false, got: `无字段「${check.column}」`, want: `表「${check.table}」的字段「${check.column}」` };
    const kind = columnKind(col);
    const wantToken = normType(check.type);
    let pass = true;
    const notes = [];
    if (wantToken) {
      // 允许 "数字" 族互通：integer/long/byte/single/double/currency/number 都算"数字"
      const numericFamily = ['integer', 'long', 'byte', 'single', 'double', 'currency', 'number', 'bigint'];
      const isNumericWant = numericFamily.includes(wantToken);
      const isNumericGot = numericFamily.includes(kind.token);
      if (isNumericWant && check.type_exact !== true) {
        // 只写"数字/数值"时，任意数值型都算过；写具体的（整型/长整型/货币…）必须精确匹配
        const generic = ['number', '数字'].includes(normName(check.type));
        if (!generic && kind.token !== wantToken) pass = false;
      } else if (kind.token !== wantToken) {
        pass = false;
      }
      void isNumericGot;
    }
    if (check.size !== undefined && check.size !== null && check.size !== '') {
      const wantSize = num(check.size);
      if (kind.size === null || wantSize === null || kind.size !== wantSize) pass = false;
      notes.push(`字段大小：期望 ${check.size}，实为 ${kind.size === null ? '—' : kind.size}`);
    }
    return {
      pass,
      got: `${kind.label}${kind.size !== null ? `(${kind.size})` : ''}`,
      want: `${TYPE_LABEL[wantToken] || check.type || ''}${check.size ? `(${check.size})` : ''}`,
      note: notes.join('；'),
    };
  },

  /** 主键（absent:true 表示"不要主键"） */
  accdb_primary_key({ model, check }) {
    const t = findTable(model, check.table);
    if (!t) return { pass: false, got: '表不存在', want: `表「${check.table}」` };
    const pk = t.primaryKey;
    const absent = !!check.absent;
    if (absent) {
      return { pass: !pk, got: pk ? `主键 ${pk.columns.map((c) => c.name).join('+')}` : '无主键', want: `表「${t.name}」不应有主键` };
    }
    if (!pk) return { pass: false, got: '无主键', want: `主键 ${(check.columns || []).join('+') || '（任意）'}` };
    const gotCols = pk.columns.map((c) => c.name);
    let pass = true;
    if (Array.isArray(check.columns) && check.columns.length) {
      pass = gotCols.length === check.columns.length && gotCols.every((x, i) => normName(x) === normName(check.columns[i]));
    }
    if (pass && check.order) {
      pass = pk.columns.every((c) => c.order === String(check.order).toUpperCase());
    }
    return {
      pass,
      got: `主键(${gotCols.join('、')})${pk.columns.map((c) => c.order).join('/')}`,
      want: `主键(${(check.columns || []).join('、')})${check.order ? ' ' + check.order : ''}`,
      note: t.indexes.length > 1 ? `另有索引：${t.indexes.filter((i) => !i.isPrimary).map((i) => i.name).join('、')}` : '',
    };
  },

  /** 记录（行）：数量 / 包含 / 不含 */
  accdb_rows({ model, check }) {
    const t = findTable(model, check.table);
    if (!t) return { pass: false, got: '表不存在', want: `表「${check.table}」` };
    if (t.rowError) return { pass: false, got: '记录读取失败', want: `表「${t.name}」记录`, note: t.rowError };
    const rows = t.rows || [];
    const notes = [];
    let pass = true;

    if (check.count !== undefined && check.count !== null && check.count !== '') {
      const wantCount = num(check.count);
      // ⚠️ 行数口径：优先用实际可读行（排除已删除记录）；rowCount 含"墓碑"记录
      const gotCount = rows.length;
      if (gotCount !== wantCount) pass = false;
      notes.push(`记录数：期望 ${wantCount}，实为 ${gotCount}`);
    }
    if (typeof check.min === 'number' && rows.length < check.min) { pass = false; notes.push(`少于 ${check.min} 条`); }
    if (typeof check.max === 'number' && rows.length > check.max) { pass = false; notes.push(`多于 ${check.max} 条`); }

    if (Array.isArray(check.contains)) {
      for (const exp of check.contains) {
        if (!rows.some((r) => rowMatches(r, exp))) { pass = false; notes.push(`缺记录：${describeRow(exp)}`); }
      }
    }
    if (Array.isArray(check.absent)) {
      for (const exp of check.absent) {
        if (rows.some((r) => rowMatches(r, exp))) { pass = false; notes.push(`多余记录：${describeRow(exp)}`); }
      }
    }
    const cols = t.columns.slice(0, 6).map((c) => c.name);
    return {
      pass,
      got: `${rows.length} 条记录${rows.length ? '：' + rows.slice(0, 2).map((r) => describeRow(r, cols)).join(' | ') : ''}`,
      want: check.count !== undefined ? `${check.count} 条记录` : '记录符合要求',
      note: notes.join('；'),
    };
  },

  /** 指定记录（按 match 定位）的字段值 */
  accdb_row_update({ model, check }) {
    const t = findTable(model, check.table);
    if (!t) return { pass: false, got: '表不存在', want: `表「${check.table}」` };
    const rows = t.rows || [];
    const match = check.match || {};
    const hit = rows.filter((r) => rowMatches(r, match));
    if (!hit.length) {
      return { pass: false, got: '未找到匹配记录', want: `存在 ${describeRow(match)} 的记录`, note: `定位条件：${describeRow(match)}` };
    }
    const exp = check.expect || {};
    const bad = [];
    for (const r of hit) {
      for (const [k, v] of Object.entries(exp)) {
        let key = null;
        for (const c of Object.keys(r)) { if (normName(c) === normName(k)) { key = c; break; } }
        if (key === null || !looseEq(r[key], v)) bad.push(`${k} 应为 ${v}，实为 ${key === null ? '(无此字段)' : r[key]}`);
      }
    }
    const pass = bad.length === 0;
    return {
      pass,
      got: `匹配 ${hit.length} 条，${bad.length ? '不符：' + bad.slice(0, 3).join('；') : '字段值正确'}`,
      want: `${describeRow(match)} → ${describeRow(exp)}`,
      note: pass ? '' : '可能是记录没找到，或改错了值',
    };
  },

  /**
   * 排序。
   * 两种"排好了"的形态，默认 mode:'auto' 任一满足即可：
   *   · property：表的 OrderBy 属性（学生在数据表视图点"排序"后保存）——mode:'property' 只认这个
   *   · rows    ：物理行序本身有序（常见于"把排好序的 xlsx 导入进来"）——mode:'rows' 只认这个
   * ⚠️ 实测：学生交上来的正确答案往往**只有行序、没有 OrderBy 属性**（导入前已排好），
   *    所以默认不能死盯属性，否则会把满分卷判成 0 分。
   */
  accdb_sort({ model, check }) {
    const t = findTable(model, check.table);
    if (!t) return { pass: false, got: '表不存在', want: `表「${check.table}」` };
    const wantCols = [];
    if (Array.isArray(check.columns) && check.columns.length) wantCols.push(...check.columns.map(normText));
    else if (check.column) wantCols.push(normText(check.column));
    const wantOrder = check.order ? String(check.order).toUpperCase() : null;
    const mode = check.mode === 'rows' || check.mode === 'property' ? check.mode : 'auto';

    // —— 按物理行序判定
    const rowsPass = (() => {
      if (!t.rows || t.rows.length < 2) return { pass: false, why: '无记录可判' };
      const keyCol = wantCols[0];
      const key = Object.keys(t.rows[0]).find((c) => normName(c) === normName(keyCol));
      if (!key) return { pass: false, why: `无字段「${keyCol}」` };
      const desc = wantOrder === 'DESC';
      for (let i = 1; i < t.rows.length; i++) {
        const a = t.rows[i - 1][key];
        const b = t.rows[i][key];
        if (a === null || b === null) continue;
        const cmp = (num(a) !== null && num(b) !== null) ? (num(a) - num(b)) : String(a).localeCompare(String(b));
        if (desc ? cmp < 0 : cmp > 0) return { pass: false, why: `第 ${i + 1} 行起行序不符` };
      }
      return { pass: true, why: '行序正确' };
    })();

    // —— 按 OrderBy 属性判定
    const ob = t.props && t.props.orderBy;
    const propPass = (() => {
      if (!ob) return { pass: false, why: '表没有排序设置' };
      const gotCols = ob.columns || [];
      let p = true;
      if (wantCols.length) p = gotCols.length >= wantCols.length && wantCols.every((w, i) => gotCols[i] && normName(gotCols[i].column) === normName(w));
      if (p && wantOrder) p = gotCols.every((c) => c.order === wantOrder);
      return { pass: p, why: p ? '属性正确' : '属性与要求不符' };
    })();

    const pass = mode === 'rows' ? rowsPass.pass : mode === 'property' ? propPass.pass : (rowsPass.pass || propPass.pass);
    const wantDesc = `${wantCols.join('、')} ${wantOrder || ' ASC/DESC'}`;
    return {
      pass,
      got: [
        `OrderBy：${ob ? (ob.columns || []).map((c) => `${c.column} ${c.order}`).join('、') : '(未设置)'}`,
        `行序：${rowsPass.why}`,
      ].join('；'),
      want: mode === 'rows' ? `按行序 ${wantDesc}` : mode === 'property' ? `OrderBy ${wantDesc}` : `按 ${wantDesc} 排序（属性或行序任一满足即可）`,
      note: mode === 'auto' && pass ? (rowsPass.pass ? '按行序判定通过' : '按 OrderBy 属性判定通过') : '',
    };
  },

  /** 筛选：看表的 Filter 属性 */
  accdb_filter({ model, check }) {
    const t = findTable(model, check.table);
    if (!t) return { pass: false, got: '表不存在', want: `表「${check.table}」` };
    const f = t.props && t.props.filter;
    if (!f) return { pass: false, got: '表没有筛选设置', want: `按「${check.column}」筛选`, note: 'Access 里对表筛选后会保存 Filter 属性' };
    let pass = true;
    if (check.column) pass = normName(f.column) === normName(check.column);
    if (pass && check.value !== undefined && check.value !== null && check.value !== '') {
      pass = normName(f.value).includes(normName(check.value)) || normName(check.value).includes(normName(f.value));
    }
    if (pass && check.op) {
      const norm = (o) => String(o).toLowerCase().replace(/\s/g, '');
      pass = norm(f.op) === norm(check.op);
    }
    return {
      pass,
      got: `Filter：${f.column} ${f.op} ${f.value}`,
      want: `Filter：${check.column || '?'} ${check.op || ''} ${check.value || ''}`,
      note: f.raw ? `原始值 ${f.raw}` : '',
    };
  },

  /** 对象存在（表 / 查询 / 窗体 / 报表 / 宏 / 模块）；absent:true 表示应不存在 */
  accdb_object({ model, check }) {
    const name = normText(check.name || check.object);
    const typeName = normText(check.object_type || check.type || '').toLowerCase();
    const absent = !!check.absent;
    const wanted = model.objects.filter((o) => normName(o.name) === normName(name));
    let hit = wanted.length > 0;
    if (hit && typeName && OBJ_TYPE[typeName] !== undefined) {
      hit = wanted.some((o) => o.type === OBJ_TYPE[typeName]);
    }
    const pass = absent ? !hit : hit;
    return {
      pass,
      got: wanted.length ? wanted.map((o) => `${o.name}(type=${o.type})`).join('、') : '不存在',
      want: absent ? `对象「${name}」不存在` : `存在对象「${name}」${typeName ? `（${typeName}）` : ''}`,
      note: '',
    };
  },

  // ============================================================
  // 二期检查器（查询 / 关系 / 字段格式 / 导出附件）
  // ============================================================

  /**
   * 查询（二期）。支持项：
   *   name（查询名，必填）· absent · from（数据源表）· select[]（应输出的列，
   *   宽松匹配：表达式或别名命中即可）· where_contains[] / group_by_contains[] /
   *   order_by_contains[]（表达式片段，去空白与括号后包含匹配）
   */
  accdb_query({ model, check }) {
    const name = normText(check.name || check.object);
    const absent = !!check.absent;
    const q = model.queryByName.get(normName(name));
    if (absent) {
      return {
        pass: !q,
        got: q ? '存在' : '不存在',
        want: `查询「${name}」不存在`,
        note: model.queryNames.length ? `现有查询：${model.queryNames.join('、')}` : '库中没有用户查询',
      };
    }
    if (!q) {
      return {
        pass: false,
        got: '不存在',
        want: `查询「${name}」`,
        note: model.queryNames.length ? `现有查询：${model.queryNames.join('、')}` : '库中没有用户查询（注意：~sq_ 开头的是向导隐藏查询，不算）',
      };
    }
    let pass = true;
    const notes = [];
    if (check.from) {
      if (!q.tables.some((x) => normName(x) === normName(check.from))) { pass = false; notes.push(`数据源应为「${check.from}」，实为 ${q.tables.join('、') || '(无)'}`); }
    }
    if (Array.isArray(check.select) && check.select.length) {
      for (const w of check.select) {
        const key = normExprKey(w);
        const hit = q.select.some((s) => normExprKey(s.expr).includes(key) || normName(s.alias) === normName(w));
        if (!hit) { pass = false; notes.push(`查询应输出「${w}」`); }
      }
    }
    const segMatch = (list, want, label) => {
      for (const w of [].concat(want)) {
        const key = normExprKey(w);
        if (!list.some((e) => normExprKey(e).includes(key))) { pass = false; notes.push(`${label}应包含「${w}」`); }
      }
    };
    if (check.where_contains) segMatch(q.where, check.where_contains, '条件');
    if (check.group_by_contains) segMatch(q.groupBy, check.group_by_contains, '分组');
    if (check.order_by_contains) segMatch(q.orderBy, check.order_by_contains, '排序');
    return {
      pass,
      got: `数据源 ${q.tables.join('、') || '(无)'}；输出 ${q.select.map((s) => (s.alias ? `${s.alias}=${s.expr}` : s.expr)).join('、') || '(无)'}`
        + `${q.where.length ? `；条件 ${q.where.join(' 且 ')}` : ''}${q.groupBy.length ? `；分组 ${q.groupBy.join('、')}` : ''}${q.orderBy.length ? `；排序 ${q.orderBy.join('、')}` : ''}`,
      want: `查询「${name}」符合题目要求`,
      note: notes.join('；'),
    };
  },

  /**
   * 表间关系（二期）。table→ref_table（默认不写 strict_direction 时方向可反），
   * column / ref_column 可选；absent:true 表示不应存在该关系。
   * ⛔ 系统关系（grbit&0x1000）已在建模阶段过滤。
   */
  accdb_relation({ model, check }) {
    const t1 = normText(check.table);
    const t2 = normText(check.ref_table);
    if (!t1 || !t2) return { pass: false, got: '(参数缺失)', want: '需要 table 与 ref_table', note: '' };
    const strict = !!check.strict_direction;
    const hitRels = model.relations.filter((rel) => rel.columns.some((c) => {
      const fwd = normName(c.table) === normName(t1) && normName(c.refTable) === normName(t2);
      const rev = normName(c.table) === normName(t2) && normName(c.refTable) === normName(t1);
      return strict ? fwd : (fwd || rev);
    }));
    const absent = !!check.absent;
    if (absent) {
      const got = hitRels.length ? hitRels.map((rel) => rel.columns.map((c) => `${c.table}.${c.column}→${c.refTable}.${c.refColumn}`).join('；')).join('；') : '无';
      return { pass: hitRels.length === 0, got, want: `${t1} 与 ${t2} 之间不应有关系`, note: '' };
    }
    if (!hitRels.length) {
      return {
        pass: false,
        got: model.relations.length ? model.relations.map((rel) => rel.columns.map((c) => `${c.table}.${c.column}→${c.refTable}.${c.refColumn}`).join('；')).join('；') : '库中没有用户关系',
        want: `${t1}.${check.column || '*'} 关联 ${t2}.${check.ref_column || '*'}`,
        note: '',
      };
    }
    let pass = true;
    const notes = [];
    if (check.column || check.ref_column) {
      const colOk = hitRels.some((rel) => rel.columns.some((c) => {
        const pair = [c, { ...c, table: c.refTable, refTable: c.table, column: c.refColumn, refColumn: c.column }];
        return pair.some((p) => (!check.column || normName(p.column) === normName(check.column)) && (!check.ref_column || normName(p.refColumn) === normName(check.ref_column)));
      }));
      if (!colOk) { pass = false; notes.push('关联字段与要求不符'); }
    }
    return {
      pass,
      got: hitRels.map((rel) => rel.columns.map((c) => `${c.table}.${c.column}→${c.refTable}.${c.refColumn}`).join('；')).join('；'),
      want: `${t1}.${check.column || '*'} → ${t2}.${check.ref_column || '*'}`,
      note: notes.join('；'),
    };
  },

  /**
   * 字段格式（二期 · ⛔ 实验性）。
   * Access 把字段格式属性存在 LvProp 属性流里，值区编码未公开，目前只能靠
   * "属性流中是否出现已知格式 token" 做表级识别（一个表内通常只有一个字段带特殊格式）。
   * 未识别到 → 判失败，并注明实验性。建议教师录题时把该项分值调低，或等样本校准后再用。
   */
  accdb_field_format({ model, check }) {
    const t = findTable(model, check.table);
    if (!t) return { pass: false, got: '表不存在', want: `表「${check.table}」` };
    if (check.absent) {
      return { pass: true, got: '(实验性检查忽略 absent)', want: '', note: '' };
    }
    const fmt = normText(check.format);
    if (!fmt) return { pass: false, got: '(参数缺失)', want: '需要 format', note: '' };
    const TOKENS = {
      currency: ['currency', '货币', '¥', '￥'],
      fixed: ['fixed', '固定'],
      percent: ['percent', '百分比', '%'],
      standard: ['standard', '标准'],
      scientific: ['scientific', '科学'],
      general_date: ['general date', '常规日期'],
      short_date: ['short date', '短日期', 'yyyy-mm-dd', 'yyyy/m/d', 'yyyy/mm/dd'],
      long_date: ['long date', '长日期'],
      medium_date: ['medium date', '中日期'],
      short_time: ['short time', '短时间'],
      long_time: ['long time', '长时间'],
      yes_no: ['yes/no', '是/否'],
      true_false: ['true/false', 'true;false'],
      on_off: ['on/off'],
    };
    const tokens = TOKENS[normName(fmt)] || [fmt.toLowerCase()];
    // ⛔ 精确匹配（属性流里混着 CurrencyLCID 这类属性名，includes 会误命中）
    const strings = (t.props && t.props.strings) || [];
    const hit = strings.find((s) => { const ls = s.trim().toLowerCase().replace(/["']/g, ''); return tokens.some((tk) => ls === tk); });
    return {
      pass: !!hit,
      got: hit ? `属性流中检测到「${hit}」` : '属性流中未检测到该格式',
      want: `「${t.name}」中存在格式为 ${fmt} 的字段`,
      note: hit ? '实验性判定（LvProp 特征识别）' : '实验性判定未命中：若学生确实设置了该格式，可能是属性流编码未覆盖，请人工复核',
    };
  },

  /**
   * 导出附件（二期）。判学生另交的 extras 文件（access-op 提交接口的字段名 extras[]）。
   *   type: 'txt' | 'csv' | 'xlsx'（按附件类型过滤）
   *   match: 文件名需包含的关键字（可选）
   *   line_count / min_lines / max_lines: 行数（xlsx 按非空单元格数）
   *   contains[] / absent[]: 内容片段（按行/单元格宽松匹配）
   * ⚠️ extras 由 gradeFile 预解析：每项 {name, kind, buffer, lines[], error}（xlsx 拆成单元格文本行）。
   * 多个候选附件时按"任一候选通过"判（导出多文件题可重复配多个检查点，用 match 区分）。
   */
  accdb_export({ check, extras }) {
    const list = (Array.isArray(extras) ? extras : []).filter((x) => !x.error);
    const type = normText(check.type).toLowerCase();
    const wantKind = type === 'xlsx' ? 'xlsx' : (type === 'csv' || type === 'txt') ? 'text' : null;
    let cand = wantKind ? list.filter((x) => x.kind === wantKind) : list.slice();
    const match = normText(check.match);
    if (match) {
      const named = cand.filter((x) => normName(x.name).includes(normName(match)));
      if (!named.length) {
        return {
          pass: false,
          got: `附件：${list.map((x) => x.name).join('、') || '(无)'}`,
          want: `文件名含「${match}」的导出文件`,
          note: '学生传了附件但没有文件名匹配的，可能导出了别的内容',
        };
      }
      cand = named;
    }
    if (!cand.length) {
      const shown = list.length ? `附件：${list.map((x) => x.name).join('、') || '(全部无法读取)'}` : '没有另交附件';
      return {
        pass: false,
        got: shown,
        want: `${type || '文件'}${match ? ` 文件名含「${match}」` : ''} 的导出文件`,
        note: '导出题需要学生在提交页「另交附件」里上传导出的文件',
      };
    }
    const notes = [];
    let anyPass = false;
    let bestGot = '';
    for (const f of cand) {
      const r = matchLines(f.lines || [], check, `${f.name}：${f.lines ? f.lines.length + ' 行' : '(空)'}`);
      if (r.pass) { anyPass = true; bestGot = r.got; break; }
      notes.push(`${f.name}：${r.note || '内容不符'}`);
    }
    return {
      pass: anyPass,
      got: bestGot || notes[0] || '（无法判读附件）',
      want: checkOneExportWant(check),
      note: anyPass ? '' : notes.join('；'),
    };
  },
};

/** accdb_export 的 want 描述 */
function checkOneExportWant(check) {
  const parts = [];
  if (check.line_count !== undefined && check.line_count !== null) parts.push(`行数 = ${check.line_count}`);
  if (check.min_lines) parts.push(`≥ ${check.min_lines} 行`);
  if (check.max_lines) parts.push(`≤ ${check.max_lines} 行`);
  if (Array.isArray(check.contains) && check.contains.length) parts.push(`包含 ${check.contains.join('、')}`);
  if (Array.isArray(check.absent) && check.absent.length) parts.push(`不含 ${check.absent.join('、')}`);
  return parts.join(' / ') || '导出内容符合要求';
}

/** 通用行匹配：行数 + contains/absent（单元格级宽松匹配） */
function matchLines(lines, check, gotDesc) {
  // ⛔ 空条件防护：什么判定条件都没配时不能"交了附件就给分"
  const hasCriteria = (check.line_count !== undefined && check.line_count !== null && check.line_count !== '')
    || check.min_lines || check.max_lines
    || (Array.isArray(check.contains) && check.contains.length)
    || (Array.isArray(check.absent) && check.absent.length);
  if (!hasCriteria) {
    return { pass: false, got: gotDesc, note: '未配置判定条件（行数/包含/不含至少配一项）' };
  }
  let pass = true;
  const notes = [];
  if (check.line_count !== undefined && check.line_count !== null && check.line_count !== '') {
    const want = num(check.line_count);
    if (lines.length !== want) { pass = false; notes.push(`行数应为 ${want}，实为 ${lines.length}`); }
  }
  if (check.min_lines && lines.length < Number(check.min_lines)) { pass = false; notes.push(`行数少于 ${check.min_lines}`); }
  if (check.max_lines && lines.length > Number(check.max_lines)) { pass = false; notes.push(`行数多于 ${check.max_lines}`); }

  /** 一行是否"包含"期望片段：按行内拆分（制表符/逗号/分号）后，期望片段逐项命中 */
  const lineHas = (line, w) => {
    const lw = normName(w);
    if (!lw) return true;
    const whole = normName(line);
    if (whole.includes(lw)) return true;
    const cells = String(line).split(/[\t,;，；|]/).map((c) => normName(c));
    return cells.some((c) => c === lw || (lw.length >= 2 && c.includes(lw)));
  };
  if (Array.isArray(check.contains)) {
    for (const w of check.contains) {
      if (!lines.some((l) => lineHas(l, w))) { pass = false; notes.push(`内容缺「${w}」`); }
    }
  }
  if (Array.isArray(check.absent)) {
    for (const w of check.absent) {
      if (lines.some((l) => lineHas(l, w))) { pass = false; notes.push(`内容多出「${w}」`); }
    }
  }
  const preview = lines.slice(0, 3).join(' | ');
  return { pass, got: `${gotDesc}${preview ? '：' + preview.slice(0, 80) : ''}`, note: notes.join('；') };
}

function runCheck(check, model, extras) {
  const fn = CHECKERS[check.kind];
  if (!fn) return { pass: false, got: '(未知检查类型)', want: check.kind, note: `不支持的检查类型：${check.kind}` };
  try {
    return fn({ model, check, extras });
  } catch (e) {
    return { pass: false, got: '(判分异常)', want: check.kind, note: e.message };
  }
}

/**
 * 预解析导出附件：txt/csv 解码分行；xlsx 用 wps-grader 的解析器拆成"单元格文本行"。
 * 失败不抛错，记 error（accdb_export 会把带 error 的附件排除，判"没有可判的附件"）。
 */
async function prepareExtras(extrasRaw) {
  const out = [];
  for (const f of Array.isArray(extrasRaw) ? extrasRaw : []) {
    if (!f) continue;
    const item = {
      name: normText(f.name) || '(未命名)',
      kind: f.kind === 'xlsx' ? 'xlsx' : 'text',
      buffer: Buffer.isBuffer(f.buffer) ? f.buffer : null,
      lines: null,
      error: null,
    };
    try {
      if (!item.buffer) throw new Error('附件内容为空');
      if (item.kind === 'xlsx') {
        const wg = require('./wps-grader');
        const { model } = await wg.loadModel(item.buffer);
        // ⚠️ wps-grader 的 sheet.cells 是 Map（键 "A1"，值 {ref,type,value,raw}）
        const cellLines = [];
        for (const sh of (model.sheets || [])) {
          const cells = sh.cells instanceof Map ? [...sh.cells.values()] : Object.values(sh.cells || {});
          for (const c of cells) {
            const v = c && (c.value !== null && c.value !== undefined && c.value !== '' ? c.value : c.raw);
            if (v === null || v === undefined || v === '') continue;
            cellLines.push(String(v));
          }
        }
        item.lines = cellLines;
      } else {
        item.lines = decodeTextBuffer(item.buffer).replace(/\r\n?/g, '\n').split('\n')
          .filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
      }
    } catch (e) {
      item.error = e.message;
    }
    out.push(item);
  }
  return out;
}

// ============================================================
// 七、主入口
// ============================================================

/**
 * 判分
 * @param {Buffer|string} input  .accdb Buffer 或文件路径
 * @param {object} spec          评分点规格（questions.access_spec 解析后的对象）
 * @param {Array}  extrasRaw     导出题另交的附件 [{name, kind:'text'|'xlsx', buffer}]
 */
async function gradeFile(input, spec, extrasRaw) {
  if (!MDBReader) throw new Error('缺少 mdb-reader 依赖，无法读取 .accdb');
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const specObj = typeof spec === 'string' ? JSON.parse(spec || '{}') : (spec || {});
  const model = buildModel(buffer);
  const extras = await prepareExtras(extrasRaw);

  const result = {
    ok: true,
    tables: model.tableNames,
    objects: model.objects.map((o) => o.name),
    queries: model.queryNames,
    relations: model.relations.map((r) => r.columns.map((c) => `${c.table}.${c.column}→${c.refTable}.${c.refColumn}`).join('；')),
    extras: extras.map((x) => ({ name: x.name, kind: x.kind, lines: x.lines ? x.lines.length : 0, error: x.error })),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    file_size: buffer.length,
    full_score: 0,
    score: 0,
    percent: 0,
    passed: false,
    steps: [],
  };

  const stepsIn = Array.isArray(specObj.steps) ? specObj.steps : [];
  let total = 0;
  let earned = 0;
  for (const st of stepsIn) {
    const checksIn = Array.isArray(st.checks) ? st.checks : [];
    const stepScore = num(st.score) !== null ? num(st.score) : checksIn.reduce((a, c) => a + (num(c.score) || 0), 0);
    const perCheck = checksIn.length ? stepScore / checksIn.length : 0;
    let stepEarned = 0;
    const checks = [];
    for (const c of checksIn) {
      const r = runCheck(c, model, extras);
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

    const stepVideos = (() => {
      const out = [];
      const push = (u) => { const v = String(u || '').trim(); if (v && !out.includes(v)) out.push(v); };
      if (Array.isArray(st.video_urls)) st.video_urls.forEach(push);
      push(st.video_url);
      return out;
    })();
    result.steps.push({
      id: st.id || '',
      title: st.title || '',
      desc: st.desc || '',
      video_url: stepVideos[0] || '',
      video_urls: stepVideos,
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
  if (!MDBReader) throw new Error('缺少 mdb-reader 依赖');
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const model = buildModel(buffer);
  return {
    ok: true,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    file_size: buffer.length,
    tables: model.tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => {
        const k = columnKind(c);
        return { name: c.name, type: c.type, type_label: k.label, size: c.size, field_size: k.size, autonumber: c.autonumber };
      }),
      row_count: (t.rows || []).length,
      rows_preview: (t.rows || []).slice(0, 5),
      primary_key: t.primaryKey ? { name: t.primaryKey.name, columns: t.primaryKey.columns } : null,
      indexes: t.indexes.map((ix) => ({ name: ix.name, is_primary: ix.isPrimary, columns: ix.columns })),
      order_by: t.props.orderBy ? t.props.orderBy.columns : null,
      filter: t.props.filter || null,
      error: t.error || null,
    })),
    objects: model.objects.map((o) => ({ name: o.name, type: o.type })),
    queries: model.queries.map((q) => ({
      name: q.name,
      tables: q.tables,
      select: q.select.map((s) => (s.alias ? `${s.alias} = ${s.expr}` : s.expr)),
      where: q.where,
      group_by: q.groupBy,
      order_by: q.orderBy,
    })),
    relations: model.relations.map((r) => ({
      name: r.name,
      columns: r.columns.map((c) => `${c.table}.${c.column} → ${c.refTable}.${c.refColumn}`),
    })),
  };
}

// ============================================================
// 八、从"标准答案库"自动生成评分点骨架
// ============================================================

function suggestSpecFromModel(model, opts = {}) {
  const fullScore = Number(opts.full_score) || 100;
  const steps = [];

  for (const t of model.tables) {
    // 建表 + 字段
    const cols = t.columns.map((c) => c.name);
    steps.push({
      id: 'tbl_' + t.name,
      title: `建立表「${t.name}」并设置字段`,
      desc: `字段依次为：${cols.join('、')}`,
      video_urls: [],
      checks: [
        { kind: 'accdb_table', table: t.name, label: '表存在', score: 0 },
        { kind: 'accdb_columns', table: t.name, columns: cols, label: '字段名与顺序', score: 0 },
      ],
    });

    // 字段类型（只对有"非默认"意义的列列出）
    const typeChecks = t.columns
      .filter((c) => ['integer', 'long', 'currency', 'double', 'single', 'date', 'boolean', 'autonumber'].includes(columnKind(c).token))
      .map((c) => {
        const k = columnKind(c);
        const chk = { kind: 'accdb_column_type', table: t.name, column: c.name, type: k.token, label: `字段「${c.name}」类型`, score: 0 };
        if (k.token === 'text' && k.size !== null) chk.size = k.size;
        return chk;
      });
    if (typeChecks.length) {
      steps.push({ id: 'type_' + t.name, title: '设置字段类型与大小', desc: '按题面要求设置各字段的数据类型', video_urls: [], checks: typeChecks });
    }

    // 主键
    if (t.primaryKey) {
      steps.push({
        id: 'pk_' + t.name,
        title: '设置主键',
        desc: `将 ${t.primaryKey.columns.map((c) => c.name).join('、')} 设为主键`,
        video_urls: [],
        checks: [{ kind: 'accdb_primary_key', table: t.name, columns: t.primaryKey.columns.map((c) => c.name), label: '主键正确', score: 0 }],
      });
    }

    // 记录
    const rowCount = (t.rows || []).length;
    if (rowCount > 0) {
      steps.push({
        id: 'rows_' + t.name,
        title: '录入/核对学生记录',
        desc: `表中应有 ${rowCount} 条记录`,
        video_urls: [],
        checks: [{ kind: 'accdb_rows', table: t.name, count: rowCount, label: `记录数 = ${rowCount}`, score: 0 }],
      });
    }

    // 排序 / 筛选
    if (t.props.orderBy) {
      steps.push({
        id: 'sort_' + t.name,
        title: '排序',
        desc: t.props.orderBy.raw,
        video_urls: [],
        checks: [{ kind: 'accdb_sort', table: t.name, column: t.props.orderBy.columns[0] && t.props.orderBy.columns[0].column, order: t.props.orderBy.columns[0] && t.props.orderBy.columns[0].order, label: '排序正确', score: 0 }],
      });
    }
    if (t.props.filter) {
      steps.push({
        id: 'filter_' + t.name,
        title: '筛选',
        desc: t.props.filter.raw,
        video_urls: [],
        checks: [{ kind: 'accdb_filter', table: t.name, column: t.props.filter.column, op: t.props.filter.op, value: t.props.filter.value, label: '筛选条件正确', score: 0 }],
      });
    }
  }

  // —— 查询（二期）：每个用户查询生成一个步骤
  for (const q of model.queries) {
    const checks = [
      { kind: 'accdb_query', name: q.name, label: `查询「${q.name}」存在`, score: 0 },
    ];
    if (q.tables.length === 1) checks.push({ kind: 'accdb_query', name: q.name, from: q.tables[0], label: '数据源正确', score: 0 });
    if (q.select.length) checks.push({ kind: 'accdb_query', name: q.name, select: q.select.map((s) => (s.alias ? s.alias : s.expr)), label: '输出列正确', score: 0 });
    if (q.where.length) checks.push({ kind: 'accdb_query', name: q.name, where_contains: q.where, label: '条件正确', score: 0 });
    if (q.orderBy.length) checks.push({ kind: 'accdb_query', name: q.name, order_by_contains: q.orderBy, label: '排序正确', score: 0 });
    steps.push({ id: 'query_' + q.name, title: `创建查询「${q.name}」`, desc: `数据源：${q.tables.join('、')}`, video_urls: [], checks });
  }

  // —— 关系（二期）
  for (const rel of model.relations) {
    const c = rel.columns[0];
    if (!c) continue;
    steps.push({
      id: 'rel_' + rel.name,
      title: `建立表间关系（${c.table} → ${c.refTable}）`,
      desc: rel.columns.map((x) => `${x.table}.${x.column} → ${x.refTable}.${x.refColumn}`).join('；'),
      video_urls: [],
      checks: rel.columns.map((x) => ({
        kind: 'accdb_relation', table: x.table, column: x.column, ref_table: x.refTable, ref_column: x.refColumn, label: '关系正确', score: 0,
      })),
    });
  }

  // 把满分平均分给各步骤与各检查点
  if (steps.length) {
    const perStep = round2(fullScore / steps.length);
    steps.forEach((st, i) => {
      const s = i === steps.length - 1 ? round2(fullScore - perStep * (steps.length - 1)) : perStep;
      st.score = s;
      const per = round2(s / st.checks.length);
      st.checks.forEach((c, j) => {
        c.score = j === st.checks.length - 1 ? round2(s - per * (st.checks.length - 1)) : per;
      });
    });
  }

  return { version: 1, full_score: fullScore, steps };
}

async function suggestSpec(input, opts = {}) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  return suggestSpecFromModel(buildModel(buffer), opts);
}

/** 校验评分点规格（总分是否等于满分、有没有不支持的检查类型） */
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
      if (c.kind === 'accdb_field_format') {
        warnings.push(`步骤 ${i + 1}「${st.title || ''}」用了 accdb_field_format（实验性判定，LvProp 值区编码未完全覆盖，可能漏判；建议调低该项分值或人工复核）`);
      }
      inner += num(c.score) || 0;
    });
    const stepScore = num(st.score);
    if (stepScore !== null && checks.length && Math.abs(inner - stepScore) > 1e-9) {
      warnings.push(`步骤 ${i + 1}「${st.title || ''}」评分点分数合计 ${inner} 与步骤分 ${stepScore} 不一致（将按评分点分数计分）`);
    }
    sum += checks.reduce((a, c) => a + (num(c.score) || 0), 0);
  });
  const full = expectFull !== undefined ? num(expectFull) : num(s.full_score);
  if (full !== null && Math.abs(sum - full) > 1e-9) warnings.push(`评分点总分 ${round2(sum)} 与题目满分 ${full} 不一致`);
  return { ok: errors.length === 0, errors, warnings, total: round2(sum), full_score: full };
}

/** 读取 .accdb → { model }（脚本/接口想直接拿模型做分析时用） */
async function loadModel(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  return { model: buildModel(buffer) };
}

module.exports = {
  gradeFile,
  inspectFile,
  suggestSpec,
  suggestSpecFromModel,
  validateSpec,
  loadModel,
  buildModel,
  parseIndexes,
  parseLvProps,
  extractUcs2Strings,
  columnKind,
  normType,
  CHECKERS,
  CHECK_KINDS: Object.keys(CHECKERS),
};
