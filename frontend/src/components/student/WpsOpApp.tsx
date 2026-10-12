import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { API_CONFIG } from '../../api/config';
import { getAuthToken } from '../../utils/authToken';
import { sanitizeHtml } from '../../utils/htmlUtils';

/**
 * 学测「操作题」（WPS / Access 共用一套作答界面）
 * ============================================================
 * 一个入口承载两类操作题，一级分段切换：
 *   ┌ WPS 操作题  ── 下载模板（可多个：表格 + txt 数据源）→ 真 WPS 做题 → 上传 .xlsx → 服务端判分
 *   └ Access 操作题 ── 下载模板（空白库 + 待导入的 xlsx）→ 真 Access 做题 → 上传 .accdb → 服务端判分
 *
 * 两类题的作答链路完全一致，所以这里只做"参数化"：
 *   base 路径 / 接受的文件后缀 / 文案图标，其余全复用。
 *
 * ⛔ 前端拿不到评分点（答案）：后端下发的 spec 已被剥离 checks，
 *    回执里的逐评分点明细是「判完之后」才返回的，属正常作答反馈。
 */

interface StepView {
  id: string;
  index: number;
  title: string;
  desc: string;
  score: number;
  /** 兼容旧字段（单视频） */
  video_url: string;
  /** 一个步骤可挂多条演示视频 */
  video_urls?: string[];
  check_count: number;
}

interface TemplateItem {
  name: string;
  path: string;
  size?: number | null;
  kind?: string;
}

interface SpecView {
  full_score: number;
  templates: TemplateItem[];
  template: TemplateItem | null;
  /** 题干分块（文字块 + 视频块，按序渲染）；为空时回退渲染 content（老题） */
  stem_blocks?: StemBlockView[];
  steps: StepView[];
}

/**
 * 题干分块：与「评分步骤」分开的、教师原题版式。
 * 老师按自己原题的《操作步骤》写，每一步文字后面可以挂一段演示视频 / 一组图示。
 */
interface StemBlockView {
  type: 'text' | 'video' | 'image';
  html?: string;
  title?: string;
  /** 兼容单条素材字段 */
  url?: string;
  urls?: string[];
}

interface QuestionItem {
  id: string;
  content: string;
  cluster_id: string | null;
  sub_topic: string | null;
  full_score: number;
  step_count: number;
  template_name: string;
  template_count: number;
  best_score: number | null;
  tries: number;
}

interface CheckResult {
  kind: string;
  label: string;
  pass: boolean;
  score: number;
  earned: number;
  got: string;
  want: string;
  note?: string;
}

interface StepResult {
  id: string;
  title: string;
  desc: string;
  video_url: string;
  video_urls?: string[];
  score: number;
  obtained: number;
  pass: boolean;
  checks: CheckResult[];
}

interface GradeResult {
  duplicate?: boolean;
  submission_id?: string;
  score: number;
  full_score: number;
  percent?: number;
  passed?: boolean;
  created_at?: string;
  message?: string;
  detail?: {
    score: number;
    full_score: number;
    percent: number;
    passed: boolean;
    steps: StepResult[];
  } | null;
}

interface HistoryItem {
  id: string;
  filename: string;
  score: number;
  full_score: number;
  graded_at: string | null;
  created_at: string;
  /** 这一次提交的判分明细：点记录名称即可弹窗回看错在哪 */
  detail?: GradeResult['detail'] | null;
}

type OpKind = 'wps' | 'access';

/** 两类操作题在作答链路上的差异，全部收敛在这里 */
const OP_CONF: Record<OpKind, {
  base: string;
  tabLabel: string;
  tabIcon: string;
  title: string;
  listDesc: string;
  accept: string;
  fileIcon: string;
  uploadHint: string;
  fileTip: string;
  multiHint: string;
  /** 是否有"另交附件"（导出题要另交 txt/xlsx） */
  extras: boolean;
}> = {
  wps: {
    base: '/api/student/wps-op',
    tabLabel: 'WPS 操作题',
    tabIcon: 'fa-file-excel',
    title: 'WPS 操作题',
    listDesc: '下载模板（可能同时有表格和数据源文件）→ 用 WPS 表格完成操作 → 另存为 .xlsx → 上传作答。系统按步骤逐项判分。',
    accept: '.xlsx,.xlsm',
    fileIcon: 'fa-file-excel',
    uploadHint: '点击选择要上传的 .xlsx 作答文件',
    fileTip: '用 WPS 表格打开，做完后「另存为 .xlsx」',
    multiHint: '本题有多个文件：表格模板用来做题，数据源文件（txt/csv）里的数据需要按题目要求导入表格。',
    extras: false,
  },
  access: {
    base: '/api/student/access-op',
    tabLabel: 'Access 操作题',
    tabIcon: 'fa-database',
    title: 'Access 操作题',
    listDesc: '下载模板（空白库 + 可能要导入的数据源）→ 用 Access 完成建表 / 查询等操作 → 保存 .accdb → 上传作答。系统按步骤逐项判分。',
    accept: '.accdb,.mdb',
    fileIcon: 'fa-database',
    uploadHint: '点击选择要上传的 .accdb 作答库',
    fileTip: '用 Access 打开，做完后「文件 → 保存」（不要加密）',
    multiHint: '本题有多个文件：空白库用来做题，xlsx 数据源需要按题目要求导入数据库（外部数据 → 导入）。',
    extras: true,
  },
};

const scoreColor = (obtained: number, full: number) => {
  if (full <= 0) return 'text-gray-500';
  const r = obtained / full;
  if (r >= 1) return 'text-emerald-600';
  if (r >= 0.6) return 'text-amber-600';
  return 'text-rose-600';
};

const fmtTime = (v: string | null) => {
  if (!v) return '';
  const d = new Date(v.includes('T') ? v : v.replace(' ', 'T'));
  if (isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const fmtSize = (n?: number | null) => {
  if (!n || n <= 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
};

/** 模板文件图标（数据库 / 表格 / 数据源） */
const tplIcon = (kind?: string) => (kind === 'text' ? 'fa-file-lines' : kind === 'accdb' ? 'fa-database' : 'fa-file-excel');

/** 本地上传/抓取的视频（相对路径）可内嵌播放；外链在新窗口打开（机房断网时可能打不开） */
const isLocalVideo = (u: string) => /^\/uploads\//.test(u) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(u);

/** 题干视频块按钮文案（题干不分"这一步"，所以不说"这一步的"） */
const stemVideoLabel = (b: StemBlockView) => {
  const list = Array.isArray(b.urls) && b.urls.length ? b.urls : (b.url ? [b.url] : []);
  return list.length > 1 ? `看演示视频（${list.length} 个）` : '看演示视频';
};

/** 一个步骤/一个题干块可挂多条演示视频：本地的内嵌播放，外链的给链接 */
const VideoBlock: React.FC<{ urls?: string[]; url?: string; compact?: boolean; label?: string }> = ({ urls, url, compact, label }) => {
  const [open, setOpen] = React.useState(false);
  const list = (Array.isArray(urls) && urls.length ? urls : (url ? [url] : []))
    .map((u) => String(u || '').trim())
    .filter(Boolean);
  if (!list.length) return null;
  const local = list.filter((u) => isLocalVideo(u));
  const remote = list.filter((u) => !isLocalVideo(u));
  const closed = label || (list.length > 1 ? `看这一步的演示视频（${list.length} 个）` : '看这一步的演示视频');
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:underline"
      >
        <i className={`fas ${open ? 'fa-circle-pause' : 'fa-circle-play'}`} />
        {open ? '收起演示视频' : closed}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {local.map((u, i) => (
            <div key={'l' + i}>
              {local.length > 1 && <div className="mb-1 text-[11px] text-gray-500">视频 {i + 1} / {local.length}</div>}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={`${API_CONFIG.apiUrl}${u}`}
                controls
                preload="metadata"
                className={`w-full rounded-lg border border-gray-200 bg-black ${compact ? 'max-w-sm' : 'max-w-lg'}`}
              />
            </div>
          ))}
          {remote.length > 0 && (
            <div className="space-y-1">
              {remote.map((u, i) => (
                <a
                  key={'r' + i}
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:underline"
                  title="外链视频，需要联网才能播放"
                >
                  <i className="fas fa-circle-play" /> 演示视频（外链，需联网）
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** 题干图片块按钮文案（题干不分"这一步"，所以不说"这一步的"） */
const stemImageLabel = (b: StemBlockView) => {
  const list = Array.isArray(b.urls) && b.urls.length ? b.urls : (b.url ? [b.url] : []);
  return list.length > 1 ? `看图示（${list.length} 张）` : '看图示';
};

/** 只认 http(s) 外链与同源 /uploads 素材（防手写 JSON 里的 javascript: 之类脏协议） */
const safeAsset = (u: string) => (/^https?:\/\//i.test(u) || /^\/uploads\//.test(u) ? u : '');

/** 本地上传/抓取到本地的素材走同源地址；外链原样用 */
const assetSrc = (u: string) => (isLocalVideo(u) ? `${API_CONFIG.apiUrl}${u}` : u);

/**
 * 题干图片块：和视频块一样**默认收起**，点一下才展开（题面不会被图撑长）；
 * 一个块可挂多张图（如"如图"的多张截图），点图在新窗口看大图。
 */
const ImageBlock: React.FC<{ urls?: string[]; url?: string; label?: string }> = ({ urls, url, label }) => {
  const [open, setOpen] = React.useState(false);
  const list = (Array.isArray(urls) && urls.length ? urls : (url ? [url] : []))
    .map((u) => safeAsset(String(u || '').trim()))
    .filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] text-emerald-600 hover:underline"
      >
        <i className={`fas ${open ? 'fa-image' : 'fa-eye'}`} />
        {open ? '收起图示' : (label || '看图示')}
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {list.map((u, i) => (
            <a
              key={'img' + i}
              href={assetSrc(u)}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg border border-gray-200 bg-white hover:border-emerald-300"
              title="在新窗口看大图"
            >
              {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
              <img
                src={assetSrc(u)}
                alt={`图示 ${i + 1}`}
                className="max-h-72 w-auto max-w-full"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 判分明细视图 ——「本次提交结果」与「历史提交回看弹窗」共用同一套渲染，
 * 保证以后复看时看到的明细和当时提交后看到的完全一致。
 * defaultOpenIncomplete=true：默认展开「没拿满分」的步骤，复看时一眼看到错在哪。
 */
const ResultDetailView: React.FC<{
  detail?: GradeResult['detail'] | null;
  defaultOpenIncomplete?: boolean;
}> = ({ detail, defaultOpenIncomplete }) => {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const steps = detail?.steps || [];
  if (!steps.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-3 text-center text-xs text-gray-400">
        这次提交没有留下评分点明细
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const key = s.id || String(i);
        const incomplete = !s.pass || Number(s.obtained) < Number(s.score);
        const isOpen = open[key] ?? (defaultOpenIncomplete ? incomplete : false);
        return (
          <div key={key} className={`rounded-lg border p-2.5 ${s.pass ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/40'}`}>
            <button
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
            >
              <span className="flex items-center gap-2 text-sm text-gray-800">
                <i className={`fas ${s.pass ? 'fa-circle-check text-emerald-600' : 'fa-circle-exclamation text-amber-500'}`} />
                第 {i + 1} 步 {s.title || ''}
              </span>
              <span className="flex items-center gap-2">
                <span className={`text-sm font-bold ${scoreColor(s.obtained, s.score)}`}>
                  {s.obtained} / {s.score}
                </span>
                <i className={`fas fa-chevron-${isOpen ? 'up' : 'down'} text-xs text-gray-400`} />
              </span>
            </button>

            {isOpen && (
              <div className="mt-2 space-y-1.5 border-t border-gray-200/70 pt-2">
                {(s.checks || []).map((c, j) => (
                  <div key={j} className="flex items-start gap-2 text-xs">
                    <i className={`fas ${c.pass ? 'fa-check text-emerald-600' : 'fa-xmark text-rose-500'} mt-0.5`} />
                    <div className="min-w-0 flex-1">
                      <span className="text-gray-700">{c.label}</span>
                      <span className="ml-1 text-gray-400">（{c.earned}/{c.score} 分）</span>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        要求：{c.want}
                        {c.pass ? '' : `　实际：${c.got}`}
                        {c.note ? `　${c.note}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
                <VideoBlock urls={s.video_urls} url={s.video_url} compact />
              </div>
            )}
          </div>
        );
      })}

      {detail?.passed && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700">
          <i className="fas fa-trophy mr-1" /> 满分通过，全部操作都正确！
        </div>
      )}
    </div>
  );
};

export const WpsOpApp: React.FC = () => {
  const [opKind, setOpKind] = useState<OpKind>('wps');
  const conf = OP_CONF[opKind];

  const [list, setList] = useState<QuestionItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');

  const [current, setCurrent] = useState<QuestionItem | null>(null);
  const [spec, setSpec] = useState<SpecView | null>(null);
  const [content, setContent] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [extras, setExtras] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [submitError, setSubmitError] = useState('');
  /** 正在弹窗回看的某次历史提交（点提交记录名称打开） */
  const [viewingHistory, setViewingHistory] = useState<HistoryItem | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const extrasInputRef = React.useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const { data, error } = await backendClient.get(`${conf.base}/questions`);
      if (error) throw new Error(error.message || String(error));
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setListError(e?.message || '加载失败');
    } finally {
      setLoadingList(false);
    }
  }, [conf.base]);

  useEffect(() => { loadList(); }, [loadList]);

  const switchKind = (k: OpKind) => {
    if (k === opKind) return;
    setOpKind(k);
    setCurrent(null);
    setResult(null);
    setFile(null);
    setExtras([]);
    setSpec(null);
    setSubmitError('');
    setList([]);
  };

  const openQuestion = async (item: QuestionItem) => {
    setCurrent(item);
    setSpec(null);
    setResult(null);
    setFile(null);
    setExtras([]);
    setSubmitError('');
    setViewingHistory(null);
    setLoadingDetail(true);
    try {
      const { data, error } = await backendClient.get(`${conf.base}/${item.id}`);
      if (error) throw new Error(error.message || String(error));
      setSpec(data?.spec || null);
      setContent(data?.content || '');
      setHistory(data?.submissions || []);
    } catch (e: any) {
      setSubmitError(e?.message || '加载题目失败');
    } finally {
      setLoadingDetail(false);
    }
  };

  const reloadHistory = async (id: string) => {
    try {
      const { data } = await backendClient.get(`${conf.base}/${id}`);
      setHistory(data?.submissions || []);
    } catch { /* 忽略 */ }
  };

  const submit = async () => {
    if (!current || !file) return;
    setSubmitting(true);
    setSubmitError('');
    setResult(null);
    try {
      const token = getAuthToken();
      const fd = new FormData();
      fd.append('file', file);
      extras.forEach((f) => fd.append('extras', f));
      const res = await fetch(`${API_CONFIG.apiUrl}${conf.base}/${current.id}/submit`, {
        method: 'POST',
        // ⚠️ 不要手工设置 Content-Type，浏览器要自己带 multipart boundary
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      let json: any = null;
      try { json = await res.json(); } catch { /* 无 body */ }
      if (res.status === 401) {
        const err: any = new Error('登录状态已失效，请重新登录后再提交');
        err.isAuthError = true;
        throw err;
      }
      if (!res.ok) throw new Error(json?.error || `提交失败（${res.status}）`);
      const payload: GradeResult = json?.data || null;
      if (!payload) throw new Error('服务端未返回判分结果');
      setResult(payload);
      await reloadHistory(current.id);
      await loadList();
    } catch (e: any) {
      setSubmitError(
        e?.isAuthError || e?.status === 401
          ? '登录状态已失效，请重新登录后再提交。'
          : (e?.message || '提交失败，请检查网络后重试')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const downloadTemplate = (t: TemplateItem) => {
    if (!t?.path) return;
    const a = document.createElement('a');
    a.href = `${API_CONFIG.apiUrl}${t.path}`;
    a.download = t.name || '模板';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /** 下载自己提交过的作答文件（带鉴权，走 blob），可在此基础上修改后再上传 */
  const [downloading, setDownloading] = useState<string | null>(null);
  const downloadSubmission = async (h: HistoryItem) => {
    if (downloading) return;
    setDownloading(h.id);
    setSubmitError('');
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_CONFIG.apiUrl}${conf.base}/submissions/${h.id}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401) {
        const err: any = new Error('登录状态已失效，请重新登录');
        err.isAuthError = true;
        throw err;
      }
      if (!res.ok) {
        let msg = `下载失败（${res.status}）`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* 无 body */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = h.filename || '我的提交';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setSubmitError(
        e?.isAuthError
          ? '登录状态已失效，请重新登录后再试。'
          : (e?.message || '下载失败，请检查网络后重试')
      );
    } finally {
      setDownloading(null);
    }
  };

  const plainContent = useMemo(() => sanitizeHtml(content || ''), [content]);
  const templates = useMemo<TemplateItem[]>(() => {
    if (!spec) return [];
    if (Array.isArray(spec.templates) && spec.templates.length) return spec.templates;
    return spec.template ? [spec.template] : [];
  }, [spec]);

  // ---------------- 一级分段：WPS / Access ----------------
  const kindTabs = (
    <div className="mb-4 flex gap-1 border-b border-gray-200">
      {(Object.keys(OP_CONF) as OpKind[]).map((k) => (
        <button
          key={k}
          onClick={() => switchKind(k)}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition ${
            opKind === k ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <i className={`fas ${OP_CONF[k].tabIcon}`} /> {OP_CONF[k].tabLabel}
        </button>
      ))}
    </div>
  );

  // ---------------- 列表 ----------------
  if (!current) {
    return (
      <div className="h-full overflow-auto bg-gray-50 p-5">
        {kindTabs}
        <div className="mb-1 flex items-center gap-2">
          <i className={`fas ${conf.tabIcon} text-emerald-600`} />
          <h2 className="text-lg font-bold text-gray-800">{conf.title}</h2>
        </div>
        <p className="mb-4 text-xs text-gray-500">{conf.listDesc}</p>

        {loadingList && <div className="py-10 text-center text-sm text-gray-400">加载中…</div>}
        {!loadingList && listError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {listError}
            <button onClick={loadList} className="ml-2 underline">重试</button>
          </div>
        )}
        {!loadingList && !listError && list.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center text-sm text-gray-400">
            暂时没有可练习的操作题，等老师布置后再来看看吧。
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((it, idx) => (
            <button
              key={it.id}
              onClick={() => openQuestion(it)}
              className="group rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:shadow-md"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  {it.full_score} 分 · {it.step_count} 步
                  {it.template_count > 1 ? ` · ${it.template_count} 个模板` : ''}
                </span>
                {it.best_score !== null && (
                  <span className={`text-sm font-bold ${scoreColor(it.best_score, it.full_score)}`}>
                    {it.best_score} / {it.full_score}
                  </span>
                )}
              </div>
              <div className="line-clamp-2 text-sm font-medium text-gray-800 group-hover:text-emerald-700">
                <span className="mr-1.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-emerald-600 align-[-2px] text-[11px] font-bold text-white">
                  {idx + 1}
                </span>
                {it.template_name || '（未命名模板）'}
              </div>
              <div className="mt-2 text-[11px] text-gray-400">
                {it.tries > 0 ? `已提交 ${it.tries} 次` : '尚未作答'}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------------- 作答 ----------------
  return (
    <div className="h-full overflow-auto bg-gray-50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => { setCurrent(null); setResult(null); setFile(null); setExtras([]); }}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
        >
          <i className="fas fa-arrow-left" /> 返回列表
        </button>
        {current.best_score !== null && (
          <span className={`text-sm font-bold ${scoreColor(current.best_score, current.full_score)}`}>
            最好成绩 {current.best_score} / {current.full_score}
          </span>
        )}
      </div>

      {loadingDetail && <div className="py-10 text-center text-sm text-gray-400">加载题目中…</div>}

      {!loadingDetail && spec && (
        <div className="space-y-4">
          {/* 题干：教师在教师端按"原题版式"分块（文字块 + 视频块 + 图片块），每一步后面可挂演示视频 / 图示 */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            {(spec.stem_blocks || []).length > 0 ? (
              <div className="space-y-2.5">
                {(spec.stem_blocks || []).map((b, i) => {
                  if (b.type === 'video') {
                    return (
                      <div key={'sv' + i} className="rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2">
                        {b.title && (
                          <div className="text-xs font-medium text-violet-700">
                            <i className="fas fa-circle-play mr-1" />{b.title}
                          </div>
                        )}
                        <VideoBlock urls={b.urls} url={b.url} label={stemVideoLabel(b)} />
                      </div>
                    );
                  }
                  if (b.type === 'image') {
                    return (
                      <div key={'si' + i} className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2">
                        {b.title && (
                          <div className="text-xs font-medium text-emerald-700">
                            <i className="fas fa-image mr-1" />{b.title}
                          </div>
                        )}
                        <ImageBlock urls={b.urls} url={b.url} label={stemImageLabel(b)} />
                      </div>
                    );
                  }
                  return (
                    <div
                      key={'st' + i}
                      className="prose prose-sm max-w-none text-sm leading-relaxed text-gray-700"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(b.html || '') }}
                    />
                  );
                })}
              </div>
            ) : (
              <div
                className="prose prose-sm max-w-none text-sm leading-relaxed text-gray-700"
                dangerouslySetInnerHTML={{ __html: plainContent }}
              />
            )}
          </div>

          {/* 步骤 */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-bold text-gray-800">操作步骤与分值</h3>
            <ol className="space-y-2">
              {spec.steps.map((s) => (
                <li key={s.id} className="flex gap-3 rounded-lg bg-gray-50 p-2.5">
                  <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                    {s.index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-gray-800">{s.title}</span>
                      <span className="flex-none text-xs font-semibold text-emerald-700">{s.score} 分</span>
                    </div>
                    {s.desc && <p className="mt-0.5 text-xs text-gray-500">{s.desc}</p>}
                    <VideoBlock urls={s.video_urls} url={s.video_url} />
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* 模板与上传 */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-bold text-gray-800">作答</h3>

            <div className="mb-3">
              <div className="mb-1.5 text-xs font-medium text-gray-600">第 1 步：下载模板文件</div>
              {templates.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {templates.map((t) => (
                    <button
                      key={t.path}
                      onClick={() => downloadTemplate(t)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
                    >
                      <i className={`fas ${tplIcon(t.kind)}`} />
                      下载 {t.name}
                      {t.size ? <span className="opacity-80">（{fmtSize(t.size)}）</span> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">老师尚未上传模板文件</div>
              )}
              {templates.length > 1 && (
                <div className="mt-1.5 text-[11px] text-gray-400">{conf.multiHint}</div>
              )}
              <div className="mt-1 text-[11px] text-gray-400">{conf.fileTip}</div>
            </div>

            <div className="mb-1.5 text-xs font-medium text-gray-600">
              第 2 步：上传做好的 {conf.accept.split(',')[0]}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={conf.accept}
              className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); setSubmitError(''); }}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="mb-3 cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-5 text-center hover:border-emerald-400 hover:bg-emerald-50/40"
            >
              {file ? (
                <div className="text-sm text-gray-700">
                  <i className={`fas ${conf.fileIcon} mr-1 text-emerald-600`} />
                  {file.name}
                  <span className="ml-2 text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>
                  <div className="mt-1 text-[11px] text-gray-400">点击可重新选择文件</div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  <i className="fas fa-cloud-arrow-up mr-1" /> {conf.uploadHint}
                </div>
              )}
            </div>

            {/* 另交附件（导出题：把导出的 txt / xlsx 一起交上来） */}
            {conf.extras && (
              <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-600">另交的附件（选做）</span>
                  <span className="text-[11px] text-gray-400">导出题：把导出的 txt / xlsx 一并交上来，方便老师核对</span>
                </div>
                <input
                  ref={extrasInputRef}
                  type="file"
                  accept=".txt,.csv,.xlsx,.xlsm"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files || []);
                    setExtras(picked);
                    setResult(null);
                    setSubmitError('');
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => extrasInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    <i className="fas fa-paperclip" /> 选择附件
                  </button>
                  {extras.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {extras.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[11px] text-gray-600">
                          <i className="fas fa-file-lines text-amber-600" />{f.name}
                          <button
                            onClick={() => setExtras((arr) => arr.filter((_, j) => j !== i))}
                            className="text-rose-500 hover:text-rose-700"
                            title="移除"
                          ><i className="fas fa-xmark" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={submit}
              disabled={!file || submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? <><i className="fas fa-spinner fa-spin" /> 正在判分…</> : <><i className="fas fa-paper-plane" /> 提交判分</>}
            </button>

            {submitError && (
              <div className={`mt-3 rounded-lg p-2.5 text-xs ${submitError.includes('登录') ? 'border border-amber-200 bg-amber-50 text-amber-700' : 'border border-rose-200 bg-rose-50 text-rose-700'}`}>
                {submitError}
              </div>
            )}
          </div>

          {/* 判分结果 */}
          {result && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">判分结果</h3>
                <div className={`text-2xl font-extrabold ${scoreColor(result.score, result.full_score)}`}>
                  {result.score}
                  <span className="text-sm font-normal text-gray-400"> / {result.full_score}</span>
                </div>
              </div>

              {result.duplicate && result.message && (
                <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-700">
                  {result.message}
                </div>
              )}

              <ResultDetailView detail={result.detail || null} />
            </div>
          )}

          {/* 历史 */}
          {history.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="text-sm font-bold text-gray-800">我的提交记录</h3>
              <p className="mb-3 mt-0.5 text-[11px] text-gray-400">
                点<b>记录名称</b>可回看这一次的判分明细（错在哪）；点「下载」可取回当时提交的文件，在此基础上修改后再次上传即可（取最好成绩）。
              </p>
              <div className="space-y-1.5">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                    <button
                      onClick={() => setViewingHistory(h)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-gray-700 hover:text-sky-700 hover:underline"
                      title="查看这一次判分的详细情况"
                    >
                      <i className="fas fa-file-lines flex-none text-gray-400" />
                      <span className="truncate">{h.filename || '（未记录文件名）'}</span>
                    </button>
                    <span className="flex flex-none items-center gap-3">
                      <button
                        onClick={() => downloadSubmission(h)}
                        disabled={downloading === h.id}
                        className="inline-flex items-center gap-1 text-sky-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        title="下载这份提交的文件，修改后可再次上传"
                      >
                        <i className={`fas ${downloading === h.id ? 'fa-spinner fa-spin' : 'fa-download'}`} />
                        {downloading === h.id ? '下载中' : '下载'}
                      </button>
                      <span className="text-gray-400">{fmtTime(h.created_at)}</span>
                      <span className={`font-bold ${scoreColor(h.score, h.full_score)}`}>{h.score}/{h.full_score}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 历史提交的判分明细弹窗（点记录名称打开，可反复回看） */}
          {viewingHistory && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={() => setViewingHistory(null)}
            >
              <div
                className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-gray-800">这次判分详情</h3>
                    <p className="mt-0.5 truncate text-[11px] text-gray-400">
                      {viewingHistory.filename || '（未记录文件名）'} · {fmtTime(viewingHistory.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <span className={`text-xl font-extrabold ${scoreColor(viewingHistory.score, viewingHistory.full_score)}`}>
                      {viewingHistory.score}
                      <span className="text-sm font-normal text-gray-400"> / {viewingHistory.full_score}</span>
                    </span>
                    <button
                      onClick={() => setViewingHistory(null)}
                      className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      title="关闭"
                    >
                      <i className="fas fa-xmark" />
                    </button>
                  </div>
                </div>
                <ResultDetailView detail={viewingHistory.detail || null} defaultOpenIncomplete />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WpsOpApp;
