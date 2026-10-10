import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import { API_CONFIG } from '../../api/config';
import { getAuthToken } from '../../utils/authToken';
import { sanitizeHtml } from '../../utils/htmlUtils';

/**
 * 学测「操作题」
 * ============================================================
 * 一个入口承载两类操作题：
 *   ┌ WPS 操作题 ── 下载模板（可多个：表格 + txt 数据源）→ 真 WPS 做题 → 上传 .xlsx → 服务端判分
 *   └ Access 操作题（占位，后续开放）
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
  steps: StepView[];
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
}

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

/** 本地上传/抓取的视频（相对路径）可内嵌播放；外链在新窗口打开（机房断网时可能打不开） */
const isLocalVideo = (u: string) => /^\/uploads\//.test(u) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(u);

/** 一个步骤可挂多条演示视频：本地的内嵌播放，外链的给链接 */
const VideoBlock: React.FC<{ urls?: string[]; url?: string; compact?: boolean }> = ({ urls, url, compact }) => {
  const [open, setOpen] = React.useState(false);
  const list = (Array.isArray(urls) && urls.length ? urls : (url ? [url] : []))
    .map((u) => String(u || '').trim())
    .filter(Boolean);
  if (!list.length) return null;
  const local = list.filter((u) => isLocalVideo(u));
  const remote = list.filter((u) => !isLocalVideo(u));
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:underline"
      >
        <i className={`fas ${open ? 'fa-circle-pause' : 'fa-circle-play'}`} />
        {open ? '收起演示视频' : (list.length > 1 ? `看这一步的演示视频（${list.length} 个）` : '看这一步的演示视频')}
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

export const WpsOpApp: React.FC = () => {
  const [opKind, setOpKind] = useState<'wps' | 'access'>('wps');

  const [list, setList] = useState<QuestionItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');

  const [current, setCurrent] = useState<QuestionItem | null>(null);
  const [spec, setSpec] = useState<SpecView | null>(null);
  const [content, setContent] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({});
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const { data, error } = await backendClient.get('/api/student/wps-op/questions');
      if (error) throw new Error(error.message || String(error));
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setListError(e?.message || '加载失败');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const openQuestion = async (item: QuestionItem) => {
    setCurrent(item);
    setSpec(null);
    setResult(null);
    setFile(null);
    setSubmitError('');
    setOpenSteps({});
    setLoadingDetail(true);
    try {
      const { data, error } = await backendClient.get(`/api/student/wps-op/${item.id}`);
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
      const { data } = await backendClient.get(`/api/student/wps-op/${id}`);
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
      const res = await fetch(`${API_CONFIG.apiUrl}/api/student/wps-op/${current.id}/submit`, {
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

  const plainContent = useMemo(() => sanitizeHtml(content || ''), [content]);
  const templates = useMemo<TemplateItem[]>(() => {
    if (!spec) return [];
    if (Array.isArray(spec.templates) && spec.templates.length) return spec.templates;
    return spec.template ? [spec.template] : [];
  }, [spec]);

  // ---------------- 一级分段：WPS / Access ----------------
  const kindTabs = (
    <div className="mb-4 flex gap-1 border-b border-gray-200">
      {[
        { k: 'wps', label: 'WPS 操作题', icon: 'fa-file-excel' },
        { k: 'access', label: 'Access 操作题', icon: 'fa-database' },
      ].map((t) => (
        <button
          key={t.k}
          onClick={() => { setOpKind(t.k as 'wps' | 'access'); setCurrent(null); }}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition ${
            opKind === t.k ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <i className={`fas ${t.icon}`} /> {t.label}
        </button>
      ))}
    </div>
  );

  if (opKind === 'access') {
    return (
      <div className="h-full overflow-auto bg-gray-50 p-5">
        {kindTabs}
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
          <i className="fas fa-database mb-3 text-3xl text-gray-300" />
          <div className="text-base font-semibold text-gray-700">Access 操作题</div>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-gray-500">
            这一部分还在准备中，老师开放后就能在这里练习数据库操作题。
            现在可以先做「WPS 操作题」。
          </p>
        </div>
      </div>
    );
  }

  // ---------------- 列表 ----------------
  if (!current) {
    return (
      <div className="h-full overflow-auto bg-gray-50 p-5">
        {kindTabs}
        <div className="mb-1 flex items-center gap-2">
          <i className="fas fa-file-excel text-emerald-600" />
          <h2 className="text-lg font-bold text-gray-800">WPS 操作题</h2>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          下载模板（可能同时有表格和数据源文件）→ 用 WPS 表格完成操作 → 另存为 .xlsx → 上传作答。系统按步骤逐项判分。
        </p>

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
          {list.map((it) => (
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
                {it.cluster_id || '未分类'}
                {it.template_name ? ` · ${it.template_name}` : ''}
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
          onClick={() => { setCurrent(null); setResult(null); }}
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
          {/* 题干 */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div
              className="prose prose-sm max-w-none text-sm leading-relaxed text-gray-700"
              dangerouslySetInnerHTML={{ __html: plainContent }}
            />
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
                      <i className={`fas ${t.kind === 'text' ? 'fa-file-lines' : 'fa-download'}`} />
                      下载 {t.name}
                      {t.size ? <span className="opacity-80">（{fmtSize(t.size)}）</span> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">老师尚未上传模板文件</div>
              )}
              {templates.length > 1 && (
                <div className="mt-1.5 text-[11px] text-gray-400">
                  本题有多个文件：表格模板用来做题，数据源文件（txt/csv）里的数据需要按题目要求导入表格。
                </div>
              )}
              <div className="mt-1 text-[11px] text-gray-400">用 WPS 表格打开，做完后「另存为 .xlsx」</div>
            </div>

            <div className="mb-1.5 text-xs font-medium text-gray-600">第 2 步：上传做好的 .xlsx</div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); setSubmitError(''); }}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="mb-3 cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-5 text-center hover:border-emerald-400 hover:bg-emerald-50/40"
            >
              {file ? (
                <div className="text-sm text-gray-700">
                  <i className="fas fa-file-excel mr-1 text-emerald-600" />
                  {file.name}
                  <span className="ml-2 text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>
                  <div className="mt-1 text-[11px] text-gray-400">点击可重新选择文件</div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  <i className="fas fa-cloud-arrow-up mr-1" /> 点击选择要上传的 .xlsx 作答文件
                </div>
              )}
            </div>

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

              <div className="space-y-2">
                {(result.detail?.steps || []).map((s, i) => {
                  const open = !!openSteps[s.id || String(i)];
                  return (
                    <div key={s.id || i} className={`rounded-lg border p-2.5 ${s.pass ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/40'}`}>
                      <button
                        className="flex w-full items-center justify-between gap-2 text-left"
                        onClick={() => setOpenSteps((o) => ({ ...o, [s.id || String(i)]: !open }))}
                      >
                        <span className="flex items-center gap-2 text-sm text-gray-800">
                          <i className={`fas ${s.pass ? 'fa-circle-check text-emerald-600' : 'fa-circle-exclamation text-amber-500'}`} />
                          第 {i + 1} 步 {s.title || ''}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${scoreColor(s.obtained, s.score)}`}>
                            {s.obtained} / {s.score}
                          </span>
                          <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-xs text-gray-400`} />
                        </span>
                      </button>

                      {open && (
                        <div className="mt-2 space-y-1.5 border-t border-gray-200/70 pt-2">
                          {s.checks.map((c, j) => (
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
              </div>

              {result.detail?.passed && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700">
                  <i className="fas fa-trophy mr-1" /> 满分通过，全部操作都正确！
                </div>
              )}
            </div>
          )}

          {/* 历史 */}
          {history.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-bold text-gray-800">我的提交记录</h3>
              <div className="space-y-1.5">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                    <span className="truncate text-gray-600">{h.filename || '（未记录文件名）'}</span>
                    <span className="flex flex-none items-center gap-3">
                      <span className="text-gray-400">{fmtTime(h.created_at)}</span>
                      <span className={`font-bold ${scoreColor(h.score, h.full_score)}`}>{h.score}/{h.full_score}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WpsOpApp;
