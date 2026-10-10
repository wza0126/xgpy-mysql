import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { API_CONFIG } from '../../api/config';
import { getAuthToken } from '../../utils/authToken';
import { CHAPTER_TAXONOMY } from '../../data/chapterTaxonomy';
import { WpsOpAnalytics } from './WpsOpAnalytics';

/**
 * 教师端 · 操作题（WPS / ACCESS 共用一套界面）
 * ============================================================
 * 一个菜单承载两类操作题，一级分段切换：
 *   ┌ WPS 操作题  ── 判 OOXML（wps-grader.js）
 *   └ Access 操作题 ── 判 .accdb（access-grader.js）
 *
 * 两端**产品链路完全一致**，所以这里只做"参数化"，不复制一套代码：
 *   · base 路径      /api/teacher/wps-op  ⇄  /api/teacher/access-op
 *   · 题型           wps_op               ⇄  access_op
 *   · 规格字段       wps_spec             ⇄  access_spec
 *   · 检查器字典     KIND_META_BY_OP[opKind]
 *   · 模板/答案文件后缀   xlsx ⇄ accdb
 *
 * 目标是「题库录入方便」：
 *   1) 上传做好的「标准答案」（WPS 表 / Access 库）→ 自动解析生成评分点骨架
 *      （WPS：合并区/公式/数值/图表/排序/筛选/分类汇总/条件格式
 *        Access：表/字段/类型/主键/记录/排序/筛选/对象）
 *   2) 骨架可在可视化面板里改分值、改标签；也可以直接编辑 JSON
 *   3) 模板支持多文件：空白表 + txt/csv 数据源（Access 还要带上待导入的 xlsx）
 *   4) 每一步可挂演示视频：本地上传 或 外链抓取到本地（机房断网也能播），**一步可多条**
 *   5) 默认满分 100（评分点很细，10 分不够用）
 */

type OpKind = 'wps' | 'access';

interface CheckDef {
  kind: string;
  label?: string;
  score?: number;
  [k: string]: any;
}

interface StepDef {
  id?: string;
  title: string;
  desc?: string;
  score: number;
  /** 兼容一期单视频字段（后端/前端都会合并进 video_urls） */
  video_url?: string;
  /** 一个步骤可挂多条演示视频（同一操作可能有多个视角/版本） */
  video_urls?: string[];
  checks: CheckDef[];
}

interface TemplateDef {
  name: string;
  path: string;
  size?: number | null;
  kind?: string;
}

interface SpecDef {
  version: number;
  full_score: number;
  grader?: { sheet?: string };
  templates?: TemplateDef[];
  /** 一期单模板字段：继续保留（后端 normalizeTemplates 会合并） */
  template?: { name?: string; path?: string; size?: number | null };
  steps: StepDef[];
}

interface Row {
  id: string;
  content: string;
  cluster_id: string | null;
  practice_enabled: number;
  /** WPS 操作题的评分点规格 */
  wps_spec?: any;
  /** Access 操作题的评分点规格 */
  access_spec?: any;
}

type FieldType = 'text' | 'number' | 'bool' | 'csv' | 'json';

interface KindMeta {
  label: string;
  fields: { key: string; label: string; type: FieldType }[];
}

// ------------------------------------------------------------------
// 评分点类型字典 —— 与后端判分引擎的 CHECKERS 一一对应
//   · wps-grader.js    → 25 种（OOXML）
//   · access-grader.js →  9 种（.accdb）
// 改后端检查器必须同步这里，否则教师端下拉里选不到。
// ------------------------------------------------------------------

const WPS_KIND_META: Record<string, KindMeta> = {
  merged: { label: '合并单元格', fields: [{ key: 'range', label: '区域', type: 'text' }] },
  cell_text: { label: '单元格文本', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'text', label: '应填文字', type: 'text' }] },
  cell_value: { label: '单元格数值', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'value', label: '期望值', type: 'number' }, { key: 'tol', label: '容差', type: 'number' }] },
  cell_has_formula: { label: '必须使用公式', fields: [{ key: 'ref', label: '单元格', type: 'text' }] },
  cell_formula: { label: '公式内容一致', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'formula', label: '公式（不带=）', type: 'text' }] },
  formula_tokens: { label: '公式引用单元格', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'tokens', label: '须引用的单元格（逗号分隔）', type: 'csv' }] },
  sum_range: { label: 'SUM 求和且区间正确', fields: [{ key: 'ref', label: '结果单元格', type: 'text' }, { key: 'range', label: '求和区域', type: 'text' }] },
  func_range: {
    label: '函数计算（SUM/AVERAGE/MAX/MIN…）',
    fields: [
      { key: 'ref', label: '结果单元格', type: 'text' },
      { key: 'fn', label: '函数名(SUM/AVERAGE/MAX/MIN/COUNT)', type: 'text' },
      { key: 'range', label: '引用区域', type: 'text' },
    ],
  },
  range_formula: { label: '区域内全部使用公式', fields: [{ key: 'range', label: '区域', type: 'text' }] },
  range_values: { label: '区域内数值全部正确', fields: [{ key: 'range', label: '区域', type: 'text' }, { key: 'values', label: '期望值（逗号分隔，从左到右/从上到下）', type: 'csv' }, { key: 'tol', label: '容差', type: 'number' }] },
  range_integer_display: { label: '区域内不保留小数', fields: [{ key: 'range', label: '区域', type: 'text' }] },
  integer_display: { label: '单元格不保留小数', fields: [{ key: 'ref', label: '单元格', type: 'text' }] },
  font: {
    label: '字体（名称/加粗/倾斜/下划线/字号/颜色）',
    fields: [
      { key: 'ref', label: '单元格', type: 'text' },
      { key: 'name', label: '字体名', type: 'text' },
      { key: 'bold', label: '加粗', type: 'bool' },
      { key: 'italic', label: '倾斜', type: 'bool' },
      { key: 'underline', label: '下划线', type: 'bool' },
      { key: 'size', label: '字号', type: 'number' },
      { key: 'color', label: '颜色(红/蓝/FF0000)', type: 'text' },
    ],
  },
  fill: { label: '底纹填充色', fields: [{ key: 'ref', label: '单元格', type: 'text' }, { key: 'color', label: '底纹色(浅绿/黄/蓝…)', type: 'text' }] },
  border: {
    label: '区域边框',
    fields: [
      { key: 'range', label: '区域', type: 'text' },
      { key: 'style', label: '线型(thin单实/double双实/dashed虚/any不限)', type: 'text' },
      { key: 'color', label: '边框色', type: 'text' },
      { key: 'edges', label: '范围(all/outline仅外/inner仅内)', type: 'text' },
    ],
  },
  col_width: {
    label: '列宽',
    fields: [
      { key: 'col', label: '列(A / A:C)', type: 'text' },
      { key: 'width', label: '列宽值', type: 'number' },
      { key: 'mode', label: '判定(exact/atLeast/autoFit)', type: 'text' },
    ],
  },
  row_height: {
    label: '行高',
    fields: [
      { key: 'rows', label: '行(1 / 1:3)', type: 'text' },
      { key: 'height', label: '行高值', type: 'number' },
      { key: 'mode', label: '判定(exact/atLeast/autoFit)', type: 'text' },
    ],
  },
  align: {
    label: '对齐（水平/垂直）',
    fields: [
      { key: 'ref', label: '单元格', type: 'text' },
      { key: 'horizontal', label: '水平(center/left/right)', type: 'text' },
      { key: 'vertical', label: '垂直(center/top/bottom)', type: 'text' },
    ],
  },
  number_format: {
    label: '数字格式（类型/小数位）',
    fields: [
      { key: 'ref', label: '单元格', type: 'text' },
      { key: 'type', label: '类型(percent百分比/currency货币/number/text)', type: 'text' },
      { key: 'decimals', label: '小数位', type: 'number' },
      { key: 'mode', label: '小数判定(exact/atMost/atLeast)', type: 'text' },
    ],
  },
  chart: {
    label: '图表',
    fields: [
      { key: 'chartType', label: '类型(bar/line/pie...)', type: 'text' },
      { key: 'barDir', label: '柱形方向(col/bar)', type: 'text' },
      { key: 'title', label: '标题', type: 'text' },
      { key: 'catRange', label: '分类轴区域', type: 'text' },
      { key: 'valRange', label: '数值轴区域', type: 'text' },
      { key: 'legend', label: '显示图例', type: 'bool' },
      { key: 'legendPos', label: '图例位置(r右/b下/l左/t上)', type: 'text' },
      { key: 'dataLabels', label: '显示数据标签', type: 'bool' },
      { key: 'dataLabelPos', label: '标签位置(outEnd/inEnd/ctr)', type: 'text' },
      { key: 'catTitle', label: 'X(分类)轴标题', type: 'text' },
      { key: 'valTitle', label: 'Y(数值)轴标题', type: 'text' },
      { key: 'seriesByRow', label: '系列产生在行(true行/false列)', type: 'bool' },
    ],
  },
  sheet_exists: { label: '工作表存在', fields: [{ key: 'sheet', label: '工作表名', type: 'text' }] },
  // ---- 与真实 Excel 2016 产物实测校准的四类（2026-10-10）----
  sorted_range: {
    label: '排序（区域按某列有序）',
    fields: [
      { key: 'range', label: '区域', type: 'text' },
      { key: 'col', label: '排序依据列（1=A）', type: 'number' },
      { key: 'order', label: '方向(asc/desc)', type: 'text' },
    ],
  },
  auto_filter: {
    label: '自动筛选',
    fields: [
      { key: 'range', label: '筛选区域', type: 'text' },
      { key: 'minColumns', label: '至少几列条件', type: 'number' },
      { key: 'columns', label: '列条件（JSON，如 [{"col":4,"op":"greaterThan","value":45000}]）', type: 'json' },
    ],
  },
  subtotal: {
    label: '分类汇总',
    fields: [
      { key: 'range', label: '区域', type: 'text' },
      { key: 'fn', label: '汇总方式(sum/count/average/max/min)', type: 'text' },
      { key: 'minCount', label: '至少几个汇总', type: 'number' },
      { key: 'requireOutline', label: '要求分级显示', type: 'bool' },
    ],
  },
  cond_format: {
    label: '条件格式',
    fields: [
      { key: 'range', label: '区域', type: 'text' },
      { key: 'type', label: '类型(cellIs/expression/dataBar)', type: 'text' },
      { key: 'operator', label: '条件(greaterThan/lessThan/between...)', type: 'text' },
      { key: 'value', label: '阈值', type: 'number' },
      { key: 'fillColor', label: '填充色(红 / FF0000)', type: 'text' },
      { key: 'fontColor', label: '字体色(红色文本用)', type: 'text' },
      { key: 'barColor', label: '数据条颜色(绿/FF63BE7B)', type: 'text' },
      { key: 'gradient', label: '数据条为渐变', type: 'bool' },
    ],
  },
};

const ACCESS_KIND_META: Record<string, KindMeta> = {
  accdb_table: {
    label: '表存在 / 不存在',
    fields: [
      { key: 'table', label: '表名', type: 'text' },
      { key: 'absent', label: '要求不存在（删表题）', type: 'bool' },
    ],
  },
  accdb_columns: {
    label: '字段名与顺序',
    fields: [
      { key: 'table', label: '表名', type: 'text' },
      { key: 'columns', label: '字段（逗号分隔，按顺序）', type: 'csv' },
      { key: 'contains', label: '须包含（逗号分隔）', type: 'csv' },
      { key: 'absent', label: '不得包含（逗号分隔）', type: 'csv' },
      { key: 'unordered', label: '忽略顺序', type: 'bool' },
    ],
  },
  accdb_column_type: {
    label: '字段类型 / 字段大小',
    fields: [
      { key: 'table', label: '表名', type: 'text' },
      { key: 'column', label: '字段名', type: 'text' },
      { key: 'type', label: '类型(文本/整型/长整型/日期/货币/是或否…)', type: 'text' },
      { key: 'size', label: '字段大小（短文本填字符数）', type: 'number' },
    ],
  },
  accdb_primary_key: {
    label: '主键',
    fields: [
      { key: 'table', label: '表名', type: 'text' },
      { key: 'columns', label: '主键字段（逗号分隔）', type: 'csv' },
      { key: 'order', label: '升/降序(asc/desc)', type: 'text' },
      { key: 'absent', label: '要求无主键', type: 'bool' },
    ],
  },
  accdb_rows: {
    label: '记录（数量 / 包含 / 不含）',
    fields: [
      { key: 'table', label: '表名', type: 'text' },
      { key: 'count', label: '记录数', type: 'number' },
      { key: 'contains', label: '须包含的记录（JSON，如 [{"学号":"1001"}]）', type: 'json' },
      { key: 'absent', label: '不得包含的记录（JSON）', type: 'json' },
    ],
  },
  accdb_row_update: {
    label: '记录字段值（改记录）',
    fields: [
      { key: 'table', label: '表名', type: 'text' },
      { key: 'match', label: '定位条件（JSON，如 {"学号":"1001"}）', type: 'json' },
      { key: 'expect', label: '期望值（JSON，如 {"总分":95}）', type: 'json' },
    ],
  },
  accdb_sort: {
    label: '排序',
    fields: [
      { key: 'table', label: '表名', type: 'text' },
      { key: 'column', label: '排序字段', type: 'text' },
      { key: 'columns', label: '多字段排序（逗号分隔，可留空）', type: 'csv' },
      { key: 'order', label: '方向(asc/desc)', type: 'text' },
      { key: 'mode', label: '判定(auto/rows/property)', type: 'text' },
    ],
  },
  accdb_filter: {
    label: '筛选',
    fields: [
      { key: 'table', label: '表名', type: 'text' },
      { key: 'column', label: '字段名', type: 'text' },
      { key: 'op', label: '运算符(= / <> / > / < / contains …)', type: 'text' },
      { key: 'value', label: '条件值', type: 'text' },
    ],
  },
  accdb_object: {
    label: '对象存在（查询 / 窗体 / 报表…）',
    fields: [
      { key: 'name', label: '对象名', type: 'text' },
      { key: 'object_type', label: '类型(table/query/form/report/macro/module)', type: 'text' },
      { key: 'absent', label: '要求不存在', type: 'bool' },
    ],
  },
};

const KIND_META_BY_OP: Record<OpKind, Record<string, KindMeta>> = {
  wps: WPS_KIND_META,
  access: ACCESS_KIND_META,
};

/** 两类操作题在接口 / 数据模型上的差异，全部收敛在这里 */
const OP_CONF: Record<OpKind, {
  label: string;
  icon: string;
  base: string;
  rowType: string;
  specField: 'wps_spec' | 'access_spec';
  answerExt: string;
  templateExt: string;
  inspectExt: string;
  defaultCheck: string;
  sheet: string;
}> = {
  wps: {
    label: 'WPS',
    icon: 'fa-file-excel',
    base: '/api/teacher/wps-op',
    rowType: 'wps_op',
    specField: 'wps_spec',
    answerExt: '.xlsx,.xlsm',
    templateExt: '.xlsx,.xlsm,.txt,.csv',
    inspectExt: '.xlsx,.xlsm',
    defaultCheck: 'merged',
    sheet: 'Sheet1',
  },
  access: {
    label: 'Access',
    icon: 'fa-database',
    base: '/api/teacher/access-op',
    rowType: 'access_op',
    specField: 'access_spec',
    answerExt: '.accdb,.mdb',
    templateExt: '.accdb,.mdb,.xlsx,.xlsm,.txt,.csv',
    inspectExt: '.accdb,.mdb',
    defaultCheck: 'accdb_table',
    sheet: '',
  },
};

const DEFAULT_FULL_SCORE = 100;

const specOfRow = (r: Row | null | undefined, op: OpKind): any => {
  if (!r) return null;
  return op === 'wps' ? r.wps_spec : r.access_spec;
};

const emptyCheck = (kind: string, km: Record<string, KindMeta>): CheckDef => ({ kind, label: km[kind]?.label || kind, score: 1 });

const emptyStep = (i: number, op: OpKind): StepDef => ({
  id: 's' + (i + 1),
  title: '',
  desc: '',
  score: 1,
  video_url: '',
  checks: [emptyCheck(OP_CONF[op].defaultCheck, KIND_META_BY_OP[op])],
});

const defaultSpec = (op: OpKind): SpecDef => ({
  version: 1,
  full_score: DEFAULT_FULL_SCORE,
  ...(op === 'wps' ? { grader: { sheet: 'Sheet1' } } : {}),
  templates: [],
  steps: [emptyStep(0, op)],
});

/** 统一模板清单（新格式 templates[] + 一期单模板 template，按 path 去重） */
const mergeTemplates = (v: any): TemplateDef[] => {
  const out: TemplateDef[] = [];
  const seen = new Set<string>();
  const inferKind = (t: any, p: string) => {
    const nm = t.name || p;
    if (/\.(txt|csv)$/i.test(nm)) return 'text';
    if (/\.(accdb|mdb)$/i.test(nm)) return 'accdb';
    return 'xlsx';
  };
  const push = (t: any) => {
    if (!t || !t.path) return;
    const p = String(t.path);
    if (seen.has(p)) return;
    seen.add(p);
    out.push({ name: t.name || p.split('/').pop() || '模板', path: p, size: t.size ?? null, kind: t.kind || inferKind(t, p) });
  };
  if (Array.isArray(v?.templates)) v.templates.forEach(push);
  push(v?.template);
  return out;
};

/** 统一步骤视频字段：合并 video_urls[] 与旧的 video_url（去重、去空） */
const normalizeVideos = (s: any): string[] => {
  const out: string[] = [];
  const push = (u: any) => {
    const v = String(u || '').trim();
    if (v && !out.includes(v)) out.push(v);
  };
  if (Array.isArray(s?.video_urls)) s.video_urls.forEach(push);
  push(s?.video_url);
  return out;
};

const parseSpec = (raw: any, op: OpKind): SpecDef => {
  if (!raw) return defaultSpec(op);
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return defaultSpec(op); } }
  if (!v || !Array.isArray(v.steps)) return defaultSpec(op);
  const templates = mergeTemplates(v);
  return {
    version: v.version || 1,
    full_score: Number(v.full_score) || DEFAULT_FULL_SCORE,
    ...(op === 'wps' ? { grader: v.grader || { sheet: 'Sheet1' } } : {}),
    templates,
    template: templates[0],
    steps: v.steps.map((s: any, i: number) => {
      const videos = normalizeVideos(s);
      return {
        id: s.id || 's' + (i + 1),
        title: s.title || '',
        desc: s.desc || '',
        score: Number(s.score) || 0,
        video_url: videos[0] || '',
        video_urls: videos,
        checks: Array.isArray(s.checks) ? s.checks.map((c: any) => ({ ...c })) : [],
      };
    }),
  };
};

const stripHtml = (html: string) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

/** 本地上传/抓取到本地的视频（相对路径或本机地址）→ 可以内嵌播放；其余视为外链 */
const isLocalVideo = (u: string) => /^\/uploads\//.test(u) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(u);

const fmtSize = (n?: number | null) => {
  if (!n || n <= 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
};

/** 模板文件的图标 / 标签（按类型区分：数据库 / 表格 / 数据源） */
const tplIcon = (kind?: string) => (kind === 'text' ? 'fa-file-lines text-amber-600' : kind === 'accdb' ? 'fa-database text-indigo-600' : 'fa-file-excel text-emerald-600');
const tplTag = (kind?: string) => (kind === 'text' ? '数据源' : kind === 'accdb' ? '数据库' : '表格');
const tplTagCls = (kind?: string) => (kind === 'text' ? 'bg-amber-100 text-amber-700' : kind === 'accdb' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700');

export const WpsOpManager: React.FC = () => {
  const [opKind, setOpKind] = useState<OpKind>('wps');
  const [subTab, setSubTab] = useState<'bank' | 'analytics'>('bank');
  const conf = OP_CONF[opKind];
  const kindMeta = KIND_META_BY_OP[opKind];

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [content, setContent] = useState('');
  const [cluster, setCluster] = useState('');
  const [practiceEnabled, setPracticeEnabled] = useState(true);
  const [spec, setSpec] = useState<SpecDef>(() => defaultSpec('wps'));
  const [specJson, setSpecJson] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [validation, setValidation] = useState<{ errors: string[]; warnings: string[]; total: number } | null>(null);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [inspectNote, setInspectNote] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoTarget, setVideoTarget] = useState<number | null>(null);
  const inspectRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await backendClient
        .from('questions')
        .select('*')
        .eq('type', conf.rowType)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.error || error.message || '加载失败');
      setRows((data as any[]) || []);
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '加载题库失败' });
    } finally {
      setLoading(false);
    }
  }, [conf.rowType]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setSpecJson(JSON.stringify(spec, null, 2)); }, [spec]);

  const clusterOptions = useMemo(() => {
    const out: { primary: string; secondary: string; value: string }[] = [];
    CHAPTER_TAXONOMY.forEach((part) => {
      part.chapters.forEach((ch) => {
        if (ch.allowChapter) out.push({ primary: ch.name, secondary: '', value: ch.name });
        ch.sections.forEach((s) => out.push({ primary: ch.name, secondary: s, value: `${ch.name}/${s}` }));
      });
    });
    return out;
  }, []);

  const switchKind = (k: OpKind) => {
    if (k === opKind) return;
    setOpKind(k);
    setEditing(null);
    setMsg(null);
    setValidation(null);
    setInspectNote('');
    setRows([]);
  };

  const startNew = () => {
    setEditing({ id: '', content: '', cluster_id: null, practice_enabled: 1 });
    setContent('');
    setCluster('');
    setPracticeEnabled(true);
    setSpec(defaultSpec(opKind));
    setValidation(null);
    setInspectNote('');
    setMsg(null);
  };

  const startEdit = (r: Row) => {
    setEditing(r);
    setContent(r.content || '');
    setCluster(r.cluster_id || '');
    setPracticeEnabled(Number(r.practice_enabled) === 1);
    setSpec(parseSpec(specOfRow(r, opKind), opKind));
    setValidation(null);
    setInspectNote('');
    setMsg(null);
  };

  // ---------- 评分点结构编辑 ----------
  const patchStep = (si: number, patch: Partial<StepDef>) => {
    setSpec((s) => ({ ...s, steps: s.steps.map((st, i) => (i === si ? { ...st, ...patch } : st)) }));
  };
  const addStep = () => setSpec((s) => ({ ...s, steps: [...s.steps, emptyStep(s.steps.length, opKind)] }));
  const delStep = (si: number) => setSpec((s) => ({ ...s, steps: s.steps.filter((_, i) => i !== si) }));

  const patchCheck = (si: number, ci: number, patch: Partial<CheckDef>) => {
    setSpec((s) => ({
      ...s,
      steps: s.steps.map((st, i) => (i === si
        ? { ...st, checks: st.checks.map((c, j) => (j === ci ? { ...c, ...patch } : c)) }
        : st)),
    }));
  };
  const addCheck = (si: number) => setSpec((s) => ({
    ...s, steps: s.steps.map((st, i) => (i === si ? { ...st, checks: [...st.checks, emptyCheck(conf.defaultCheck, kindMeta)] } : st)),
  }));
  const delCheck = (si: number, ci: number) => setSpec((s) => ({
    ...s, steps: s.steps.map((st, i) => (i === si ? { ...st, checks: st.checks.filter((_, j) => j !== ci) } : st)),
  }));

  /** 把每个步骤的分值重算为"其评分点分值之和" */
  const recalcScores = () => {
    setSpec((s) => ({
      ...s,
      steps: s.steps.map((st) => ({ ...st, score: st.checks.reduce((a, c) => a + (Number(c.score) || 0), 0) })),
    }));
    setMsg({ type: 'ok', text: '已按评分点重算各步骤分值' });
  };

  /** 把总分等比缩放到满分（老师不用自己算） */
  const scaleToFull = () => {
    setSpec((s) => {
      const total = s.steps.reduce((a, st) => a + st.checks.reduce((b, c) => b + (Number(c.score) || 0), 0), 0);
      const full = Number(s.full_score) || DEFAULT_FULL_SCORE;
      if (!total || Math.abs(total - full) < 1e-9) return s;
      let acc = 0;
      const steps = s.steps.map((st, si) => {
        const checks = st.checks.map((c, ci) => {
          const isLast = si === s.steps.length - 1 && ci === st.checks.length - 1;
          // 最后一个评分点用余数兜住浮点误差，保证合计恰好等于满分
          const v = isLast ? Math.round((full - acc) * 100) / 100 : Math.round((Number(c.score) || 0) * (full / total) * 100) / 100;
          acc += v;
          return { ...c, score: v };
        });
        return { ...st, checks, score: Math.round(checks.reduce((a, c) => a + c.score, 0) * 100) / 100 };
      });
      return { ...s, steps };
    });
    setMsg({ type: 'ok', text: '已把评分点分值等比缩放到满分' });
  };

  // ---------- 文件上传 ----------
  const uploadFile = async (url: string, file: File) => {
    const token = getAuthToken();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_CONFIG.apiUrl}${url}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (res.status === 401) { const e: any = new Error('登录已失效，请重新登录'); e.isAuthError = true; throw e; }
    if (!res.ok) throw new Error(json?.error || `上传失败（${res.status}）`);
    return json?.data;
  };

  /** 多模板上传：一次可选空白表 + 数据源；返回 items 数组 */
  const onTemplatesPicked = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setTemplateBusy(true);
    setMsg(null);
    try {
      const token = getAuthToken();
      const fd = new FormData();
      for (let i = 0; i < files.length; i++) fd.append('file', files[i]);
      const res = await fetch(`${API_CONFIG.apiUrl}${conf.base}/template`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      let json: any = null;
      try { json = await res.json(); } catch { /* ignore */ }
      if (res.status === 401) { const e: any = new Error('登录已失效，请重新登录'); e.isAuthError = true; throw e; }
      if (!res.ok) throw new Error(json?.error || `上传失败（${res.status}）`);
      const items = json?.data?.files || (json?.data?.path ? [json.data] : []);
      if (!items.length) throw new Error('没有解析到已上传的文件');
      setSpec((s) => {
        const cur = s.templates || [];
        const seen = new Set(cur.map((t) => t.path));
        const next = cur.slice();
        for (const it of items) {
          if (!it?.path || seen.has(it.path)) continue;
          seen.add(it.path);
          next.push({ name: it.name, path: it.path, size: it.size, kind: it.kind });
        }
        return { ...s, templates: next, template: next[0] };
      });
      setMsg({ type: 'ok', text: `已上传 ${items.length} 个模板文件` });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.isAuthError ? '登录已失效，请重新登录' : (e?.message || '模板上传失败') });
    } finally {
      setTemplateBusy(false);
      if (templateRef.current) templateRef.current.value = '';
    }
  };

  const removeTemplate = (p: string) => {
    setSpec((s) => {
      const next = (s.templates || []).filter((t) => t.path !== p);
      return { ...s, templates: next, template: next[0] };
    });
  };

  /** 往指定步骤追加一条演示视频（保留原有，支持一个步骤多条） */
  const appendVideo = (si: number, url: string) => {
    const v = String(url || '').trim();
    if (!v) return;
    setSpec((s) => ({
      ...s,
      steps: s.steps.map((st, i) => {
        if (i !== si) return st;
        const list = normalizeVideos(st);
        if (list.includes(v)) return { ...st, video_urls: list, video_url: list[0] || '' };
        const next = [...list, v];
        return { ...st, video_urls: next, video_url: next[0] || '' };
      }),
    }));
  };

  const removeVideo = (si: number, url: string) => {
    setSpec((s) => ({
      ...s,
      steps: s.steps.map((st, i) => {
        if (i !== si) return st;
        const next = normalizeVideos(st).filter((u) => u !== url);
        return { ...st, video_urls: next, video_url: next[0] || '' };
      }),
    }));
  };

  /** 上传本地演示视频 → 追加到指定步骤 */
  const pickVideo = (si: number) => {
    setVideoTarget(si);
    videoRef.current?.click();
  };

  const onVideoPicked = async (f: File | null) => {
    const si = videoTarget;
    if (!f || si === null) return;
    setVideoBusy(true);
    setMsg(null);
    try {
      const d = await uploadFile(`${conf.base}/video`, f);
      appendVideo(si, d.url);
      setMsg({ type: 'ok', text: `视频已上传并追加到第 ${si + 1} 步（${fmtSize(d.size)}），机房断网也能播` });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.isAuthError ? '登录已失效，请重新登录' : (e?.message || '视频上传失败') });
    } finally {
      setVideoBusy(false);
      setVideoTarget(null);
      if (videoRef.current) videoRef.current.value = '';
    }
  };

  /** 外链抓取到本地（抓不到就提示改用本地上传），抓到的追加到步骤 */
  const fetchVideo = async (si: number) => {
    const url = window.prompt('粘贴视频直链（http/https，需服务端能直接下载）：', '');
    if (!url) return;
    setVideoBusy(true);
    setMsg(null);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_CONFIG.apiUrl}${conf.base}/video/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ url }),
      });
      let json: any = null;
      try { json = await res.json(); } catch { /* ignore */ }
      if (res.status === 401) { const e: any = new Error('登录已失效，请重新登录'); e.isAuthError = true; throw e; }
      if (!res.ok) throw new Error(json?.error || `抓取失败（${res.status}）`);
      const d = json?.data || {};
      appendVideo(si, d.url);
      setMsg({ type: 'ok', text: `外链视频已抓到本地并追加到第 ${si + 1} 步（${fmtSize(d.size)}）` });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.isAuthError ? '登录已失效，请重新登录' : (e?.message || '抓取失败') });
    } finally {
      setVideoBusy(false);
    }
  };

  const onInspectPicked = async (f: File | null) => {
    if (!f) return;
    setInspectBusy(true);
    setMsg(null);
    setInspectNote('');
    try {
      const token = getAuthToken();
      const fd = new FormData();
      fd.append('file', f);
      fd.append('full_score', String(spec.full_score || DEFAULT_FULL_SCORE));
      const res = await fetch(`${API_CONFIG.apiUrl}${conf.base}/inspect`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      let json: any = null;
      try { json = await res.json(); } catch { /* ignore */ }
      if (res.status === 401) { const e: any = new Error('登录已失效，请重新登录'); e.isAuthError = true; throw e; }
      if (!res.ok) throw new Error(json?.error || `解析失败（${res.status}）`);
      const d = json?.data || {};
      const sug = d?.suggested_spec;
      if (!sug || !Array.isArray(sug.steps) || !sug.steps.length) {
        setMsg({ type: 'err', text: '没能从这份文件里识别出可判分的内容（可能表格/库是空的）' });
        return;
      }
      const checks = sug.steps.reduce((a: number, s: any) => a + (s.checks || []).length, 0);
      if (opKind === 'access') {
        const ts = d.summary?.tables || [];
        setInspectNote(
          `识别到 ${ts.length} 张表、${ts.reduce((a: number, t: any) => a + (t.columns || []).length, 0)} 个字段、`
          + `${ts.reduce((a: number, t: any) => a + (t.row_count || 0), 0)} 条记录，已自动生成 ${sug.steps.length} 个步骤 / ${checks} 个评分点`
        );
      } else {
        const sh = d.summary?.sheets?.[0];
        setInspectNote(
          `识别到 ${sh?.merges?.length || 0} 个合并区、${(sh?.cells || []).filter((c: any) => c.formula).length} 个公式、`
          + `${sh?.charts?.length || 0} 个图表，已自动生成 ${sug.steps.length} 个步骤 / ${checks} 个评分点`
        );
      }
      const parsed = parseSpec({ ...sug, full_score: spec.full_score || DEFAULT_FULL_SCORE, templates: spec.templates, template: spec.template }, opKind);
      setSpec(parsed);
      setMsg({ type: 'ok', text: '已用标准答案生成评分点骨架，请核对分值与描述后保存' });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.isAuthError ? '登录已失效，请重新登录' : (e?.message || '解析失败') });
    } finally {
      setInspectBusy(false);
      if (inspectRef.current) inspectRef.current.value = '';
    }
  };

  // ---------- 校验与保存 ----------
  const validate = async () => {
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_CONFIG.apiUrl}${conf.base}/validate-spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ spec, full_score: spec.full_score }),
      });
      const json = await res.json();
      const d = json?.data || { errors: ['校验失败'], warnings: [], total: 0 };
      setValidation(d);
      if (!d.errors?.length) setMsg({ type: 'ok', text: `校验通过，评分点合计 ${d.total} 分` });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '校验请求失败' });
    }
  };

  const save = async () => {
    if (!editing) return;
    if (!content.trim()) { setMsg({ type: 'err', text: '请填写题干' }); return; }
    if (!spec.steps.length) { setMsg({ type: 'err', text: '至少要有一个步骤' }); return; }
    const unlabeled = spec.steps.filter((s) => !s.title.trim());
    if (unlabeled.length) { setMsg({ type: 'err', text: '每个步骤都要填标题（学生端会显示）' }); return; }

    setSaving(true);
    setMsg(null);
    try {
      const clean: SpecDef = {
        ...spec,
        templates: (spec.templates || []).map((t) => ({ name: t.name, path: t.path, size: t.size ?? null, kind: t.kind })),
        template: (spec.templates || [])[0],
      };
      const payload: any = {
        type: conf.rowType,
        content: content.trim(),
        cluster_id: cluster || null,
        practice_enabled: practiceEnabled ? 1 : 0,
        [conf.specField]: clean,
        answers: JSON.stringify({ note: `${conf.label} 操作题由 ${conf.specField} 判分，answers 列仅占位` }),
      };
      let err: any = null;
      if (editing.id) {
        const r = await backendClient.from('questions').update(payload).eq('id', editing.id);
        err = r.error;
      } else {
        const r = await backendClient.from('questions').insert(payload);
        err = r.error;
      }
      if (err) throw new Error(err.error || err.message || '保存失败');
      setMsg({ type: 'ok', text: '已保存' });
      await load();
      setEditing(null);
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: Row) => {
    if (!window.confirm('确定删除这道操作题？已产生的学生提交记录会保留。')) return;
    try {
      const { error } = await backendClient.from('questions').delete().eq('id', r.id);
      if (error) throw new Error(error.error || error.message);
      await load();
      setMsg({ type: 'ok', text: '已删除' });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '删除失败' });
    }
  };

  const totalCheckScore = spec.steps.reduce((a, st) => a + st.checks.reduce((b, c) => b + (Number(c.score) || 0), 0), 0);

  // ============================================================
  // 编辑视图（整页）
  // ============================================================
  if (editing) {
    return (
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => setEditing(null)} className="text-sm text-gray-500 hover:text-gray-800">
            <i className="fas fa-arrow-left mr-1" /> 返回列表
          </button>
          <div className="flex items-center gap-2">
            <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              <i className={`fas ${conf.icon} mr-1`} />{conf.label} 操作题
            </span>
            <button onClick={validate} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">校验评分点</button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-gray-300">
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>

        {msg && (
          <div className={`mb-3 rounded-lg p-2.5 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {msg.text}
          </div>
        )}

        {validation && (
          <div className={`mb-3 rounded-lg p-3 text-xs ${validation.errors.length ? 'bg-rose-50' : 'bg-sky-50'}`}>
            <div className="font-medium text-gray-700">评分点合计 {validation.total} 分 / 满分 {spec.full_score} 分</div>
            {validation.errors.map((e, i) => <div key={'e' + i} className="mt-1 text-rose-700">✗ {e}</div>)}
            {validation.warnings.map((w, i) => <div key={'w' + i} className="mt-1 text-amber-700">⚠ {w}</div>)}
            {!validation.errors.length && !validation.warnings.length && <div className="mt-1 text-emerald-700">✓ 一切正常</div>}
          </div>
        )}

        <div className="space-y-4">
          {/* 基本信息 */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-bold text-gray-800">基本信息</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <label className="mb-1 block text-xs text-gray-500">题干（支持简单 HTML，如 &lt;p&gt;、&lt;strong&gt;）</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder={opKind === 'access'
                    ? '<p>下载「xxx.accdb」和「data.xlsx」，用 Access 完成以下操作并保存：</p><p>1. ...</p>'
                    : '<p>下载「xxx.xlsx」和「data.txt」，用 WPS 表格完成以下操作并保存：</p><p>1. ...</p>'}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">所属分类（章/小节）</label>
                <select value={cluster} onChange={(e) => setCluster(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">（未分类）</option>
                  {clusterOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.primary}{o.secondary ? ' / ' + o.secondary : '（整章）'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">满分（默认 100）</label>
                <input
                  type="number" min={1} step={1}
                  value={spec.full_score}
                  onChange={(e) => setSpec((s) => ({ ...s, full_score: Number(e.target.value) || 0 }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={practiceEnabled} onChange={(e) => setPracticeEnabled(e.target.checked)} />
                  学生可练
                </label>
              </div>
            </div>
          </div>

          {/* 模板与自动生成 */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-bold text-gray-800">模板文件与评分点</h3>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => templateRef.current?.click()}
                disabled={templateBusy}
                className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:bg-gray-300"
              >
                <i className="fas fa-upload mr-1" /> {templateBusy ? '上传中…' : '上传模板文件（可多选）'}
              </button>
              <input
                ref={templateRef}
                type="file"
                accept={conf.templateExt}
                multiple
                className="hidden"
                onChange={(e) => onTemplatesPicked(e.target.files)}
              />
              <span className="text-xs text-gray-500">
                {opKind === 'access'
                  ? <>支持 .accdb/.mdb <b>空白库</b>，以及 .xlsx/.txt 数据源（有些题要"把 xlsx 导入库"），学生端可分别下载</>
                  : <>支持 .xlsx/.xlsm 空白表 <b>和 .txt/.csv 数据源</b>（有些题要求"从 txt 导入数据"），学生端可分别下载</>}
              </span>
            </div>

            {/* 模板清单 */}
            {(spec.templates || []).length > 0 ? (
              <div className="mt-3 space-y-1.5">
                {(spec.templates || []).map((t) => (
                  <div key={t.path} className="flex items-center gap-2 rounded-lg bg-sky-50/60 px-3 py-2">
                    <i className={`fas ${tplIcon(t.kind)}`} />
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{t.name}</span>
                    {t.size ? <span className="flex-none text-[11px] text-gray-400">{fmtSize(t.size)}</span> : null}
                    <span className={`flex-none rounded px-1.5 py-0.5 text-[10px] ${tplTagCls(t.kind)}`}>
                      {tplTag(t.kind)}
                    </span>
                    <a
                      href={`${API_CONFIG.apiUrl}${t.path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-none text-[11px] text-sky-600 hover:underline"
                    >预览</a>
                    <button onClick={() => removeTemplate(t.path)} className="flex-none rounded border border-rose-200 px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50">移除</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-gray-300 py-3 text-center text-xs text-gray-400">
                还没有模板文件。学生端会提示"老师尚未上传模板"。
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
              <button
                onClick={() => inspectRef.current?.click()}
                disabled={inspectBusy}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300"
              >
                <i className="fas fa-wand-magic-sparkles mr-1" /> {inspectBusy ? '解析中…' : `上传标准答案${opKind === 'access' ? '库' : '表'} → 自动生成评分点`}
              </button>
              <input ref={inspectRef} type="file" accept={conf.inspectExt} className="hidden" onChange={(e) => onInspectPicked(e.target.files?.[0] || null)} />
              <span className="text-xs text-gray-500">
                {opKind === 'access'
                  ? '把做好的答案库(.accdb)丢进来，表/字段/类型/主键/记录/排序/筛选/对象会自动识别成评分点'
                  : '把做好的答案表丢进来，合并区/公式/数值/图表/排序/筛选/分类汇总/条件格式会自动识别成评分点'}
              </span>
            </div>
            {inspectNote && <div className="mt-2 rounded-lg bg-indigo-50 p-2.5 text-xs text-indigo-700">{inspectNote}</div>}
          </div>

          {/* 步骤与评分点 */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-gray-800">
                操作步骤与评分点
                <span className={`ml-2 text-xs font-normal ${Math.abs(totalCheckScore - spec.full_score) < 1e-9 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  评分点合计 {Math.round(totalCheckScore * 100) / 100} 分 / 满分 {spec.full_score} 分
                </span>
              </h3>
              <div className="flex flex-wrap gap-2">
                <button onClick={recalcScores} className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">按评分点重算步骤分</button>
                <button onClick={scaleToFull} className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">等比缩放到满分</button>
                <button onClick={() => setShowJson((v) => !v)} className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                  {showJson ? '收起 JSON' : '直接编辑 JSON'}
                </button>
                <button onClick={addStep} className="rounded bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700">+ 步骤</button>
              </div>
            </div>

            {showJson && (
              <div className="mb-4">
                <textarea
                  value={specJson}
                  onChange={(e) => setSpecJson(e.target.value)}
                  rows={16}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                />
                <button
                  onClick={() => {
                    try {
                      const parsed = parseSpec(JSON.parse(specJson), opKind);
                      setSpec(parsed);
                      setMsg({ type: 'ok', text: 'JSON 已应用' });
                    } catch (e: any) {
                      setMsg({ type: 'err', text: 'JSON 格式有误：' + e.message });
                    }
                  }}
                  className="mt-2 rounded bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-900"
                >
                  应用 JSON
                </button>
              </div>
            )}

            <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={(e) => onVideoPicked(e.target.files?.[0] || null)} />

            <div className="space-y-3">
              {spec.steps.map((st, si) => (
                <div key={si} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">{si + 1}</span>
                    <input
                      value={st.title}
                      onChange={(e) => patchStep(si, { title: e.target.value })}
                      placeholder="步骤标题（学生端显示，如：合并单元格并设置标题格式）"
                      className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <input
                      type="number" min={0} step={0.5}
                      value={st.score}
                      onChange={(e) => patchStep(si, { score: Number(e.target.value) || 0 })}
                      className="w-20 flex-none rounded border border-gray-300 px-2 py-1 text-sm"
                      title="步骤分值"
                    />
                    <span className="text-xs text-gray-400">分</span>
                    <button onClick={() => delStep(si)} className="flex-none rounded border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">删除步骤</button>
                  </div>

                  <input
                    value={st.desc || ''}
                    onChange={(e) => patchStep(si, { desc: e.target.value })}
                    placeholder="步骤说明（学生端显示的操作要求，不要在这里写答案）"
                    className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                  />

                  {/* 演示视频（一个步骤可挂多条） */}
                  <div className="mb-2 rounded border border-gray-200 bg-white p-2">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium text-gray-500">演示视频</span>
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">{normalizeVideos(st).length} 条</span>
                      <button
                        onClick={() => pickVideo(si)}
                        disabled={videoBusy}
                        className="flex-none rounded bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:bg-gray-300"
                      >
                        <i className="fas fa-upload mr-1" />上传本地视频
                      </button>
                      <button
                        onClick={() => fetchVideo(si)}
                        disabled={videoBusy}
                        className="flex-none rounded border border-violet-300 px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                        title="把外网链接的视频下载到本机，机房断网也能播"
                      >
                        <i className="fas fa-cloud-arrow-down mr-1" />抓取外链到本地
                      </button>
                      <button
                        onClick={() => appendVideo(si, window.prompt('视频地址（http/https 或 /uploads/…）：', '') || '')}
                        disabled={videoBusy}
                        className="flex-none rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <i className="fas fa-link mr-1" />粘贴地址
                      </button>
                    </div>
                    {normalizeVideos(st).length === 0 ? (
                      <div className="rounded border border-dashed border-gray-200 px-2 py-1.5 text-[11px] text-gray-400">
                        还没有视频。同一操作可挂<b>多条</b>视频（不同角度 / 不同版本），学生端会按顺序列出。
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {normalizeVideos(st).map((u, vi) => (
                          <div key={vi} className="flex items-center gap-2 rounded bg-gray-50 px-2 py-1">
                            <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-violet-500 text-[9px] font-bold text-white">{vi + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-[11px] text-gray-600" title={u}>{u}</span>
                            <span className={`flex-none rounded px-1.5 py-0.5 text-[10px] ${isLocalVideo(u) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {isLocalVideo(u) ? '本地(断网可用)' : '外链(需联网)'}
                            </span>
                            <a href={u} target="_blank" rel="noreferrer" className="flex-none text-[11px] text-sky-600 hover:underline">测试播放</a>
                            <button onClick={() => removeVideo(si, u)} className="flex-none rounded border border-rose-200 px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50">移除</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {st.checks.map((c, ci) => {
                      const meta = kindMeta[c.kind] || { label: c.kind, fields: [] as KindMeta['fields'] };
                      return (
                        <div key={ci} className="rounded border border-gray-200 bg-white p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={c.kind}
                              onChange={(e) => patchCheck(si, ci, { kind: e.target.value, label: kindMeta[e.target.value]?.label || e.target.value })}
                              className="rounded border border-gray-300 px-1.5 py-1 text-xs"
                            >
                              {Object.keys(kindMeta).map((k) => <option key={k} value={k}>{kindMeta[k].label}</option>)}
                            </select>
                            <input
                              value={c.label || ''}
                              onChange={(e) => patchCheck(si, ci, { label: e.target.value })}
                              placeholder="给学生的评分点描述"
                              className="min-w-[150px] flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs"
                            />
                            <input
                              type="number" min={0} step={0.5}
                              value={c.score ?? 1}
                              onChange={(e) => patchCheck(si, ci, { score: Number(e.target.value) || 0 })}
                              className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs"
                              title="该评分点分值"
                            />
                            <span className="text-[11px] text-gray-400">分</span>
                            <button onClick={() => delCheck(si, ci)} className="rounded border border-rose-200 px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50">删</button>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            {meta.fields.map((f) => (
                              <label key={f.key} className="flex items-center gap-1 text-[11px] text-gray-500">
                                {f.label}
                                {f.type === 'bool' ? (
                                  <input
                                    type="checkbox"
                                    checked={!!c[f.key]}
                                    onChange={(e) => patchCheck(si, ci, { [f.key]: e.target.checked })}
                                  />
                                ) : (
                                  <input
                                    type={f.type === 'number' ? 'number' : 'text'}
                                    value={
                                      f.type === 'json'
                                        ? (c[f.key] === undefined ? '' : JSON.stringify(c[f.key]))
                                        : (Array.isArray(c[f.key]) ? c[f.key].join(',') : (c[f.key] ?? ''))
                                    }
                                    onChange={(e) => {
                                      let v: any;
                                      const raw = e.target.value;
                                      if (f.type === 'number') v = raw === '' ? undefined : Number(raw);
                                      else if (f.type === 'csv') v = raw.split(',').map((x) => x.trim()).filter(Boolean);
                                      else if (f.type === 'json') {
                                        if (raw.trim() === '') v = undefined;
                                        else { try { v = JSON.parse(raw); } catch { return; } }
                                      } else v = raw;
                                      patchCheck(si, ci, { [f.key]: v });
                                    }}
                                    className={f.type === 'json' ? 'w-72 rounded border border-gray-300 px-1.5 py-0.5 font-mono text-[11px]' : 'w-28 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]'}
                                  />
                                )}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <button onClick={() => addCheck(si)} className="rounded border border-dashed border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-white">+ 评分点</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // 列表视图
  // ============================================================
  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-800">WPS / ACCESS 操作题</h2>
        <p className="mt-1 text-xs text-gray-500">
          学测操作题（默认每题 100 分、按评分点分步给分）。上传做好的「标准答案」可自动生成评分点，再改分值与描述即可。
        </p>
      </div>

      {/* 一级分段：WPS / Access */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {[
          { k: 'wps', label: 'WPS 操作题', icon: 'fa-file-excel' },
          { k: 'access', label: 'Access 操作题', icon: 'fa-database' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => switchKind(t.k as OpKind)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition ${
              opKind === t.k ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className={`fas ${t.icon}`} /> {t.label}
          </button>
        ))}
      </div>

      {/* 二级分段：题库管理 / 练习情况 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          { k: 'bank', label: '题库管理', icon: 'fa-list-check' },
          { k: 'analytics', label: '练习情况', icon: 'fa-chart-column' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setSubTab(t.k as 'bank' | 'analytics')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              subTab === t.k ? 'bg-emerald-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <i className={`fas ${t.icon} mr-1`} /> {t.label}
          </button>
        ))}
        {subTab === 'bank' && (
          <button onClick={startNew} className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            <i className="fas fa-plus mr-1" /> 新建操作题
          </button>
        )}
      </div>

      {msg && (
        <div className={`mb-3 rounded-lg p-2.5 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {msg.text}
        </div>
      )}

      {subTab === 'analytics' ? (
        <WpsOpAnalytics kind={opKind} />
      ) : loading ? (
        <div className="py-10 text-center text-sm text-gray-400">加载中…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-14 text-center text-sm text-gray-400">
          还没有 {conf.label} 操作题。点右上角「新建操作题」，或在编辑页上传标准答案自动生成评分点。
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, idx) => {
            const sp = parseSpec(specOfRow(r, opKind), opKind);
            const tpls = sp.templates || [];
            const videoTotal = sp.steps.reduce((a, s) => a + normalizeVideos(s).length, 0);
            const videos = sp.steps.filter((s) => normalizeVideos(s).length > 0).length;
            return (
              <div key={r.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                      {idx + 1}
                    </span>
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      {sp.full_score} 分 · {sp.steps.length} 步
                    </span>
                    <span className={`rounded px-2 py-0.5 text-[11px] ${Number(r.practice_enabled) === 1 ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>
                      {Number(r.practice_enabled) === 1 ? '学生可练' : '已下架'}
                    </span>
                    <span className="rounded bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700">
                      模板 {tpls.length}
                    </span>
                    <span className={`rounded px-2 py-0.5 text-[11px] ${videoTotal ? 'bg-violet-50 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>
                      视频 {videoTotal} 条 · {videos}/{sp.steps.length} 步
                    </span>
                  </div>
                  <div className="line-clamp-2 text-sm text-gray-700">{stripHtml(r.content)}</div>
                  {tpls.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {tpls.map((t) => (
                        <span key={t.path} className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                          <i className={`fas ${tplIcon(t.kind)}`} />
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-none gap-2">
                  <button onClick={() => startEdit(r)} className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50">编辑</button>
                  <button onClick={() => remove(r)} className="rounded border border-rose-200 px-3 py-1 text-xs text-rose-600 hover:bg-rose-50">删除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WpsOpManager;
