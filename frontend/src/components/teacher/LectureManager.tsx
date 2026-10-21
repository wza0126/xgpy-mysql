import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backendClient } from '../../api/backendClient';
import LecturePlayer, { Lecture, LecturePage, LecturePageKind } from '../lecture/LecturePlayer';

// ============ 类型 ============
interface LectureCard {
  id: string;
  title: string;
  subject: string;
  chapter: string;
  style_key: string;
  cover: { kind: string; title: string; kicker?: string } | null;
  page_count: number;
  duration_sec: number;
  status: 'draft' | 'published';
  class_ids: string[];
  sort_order: number;
  play_count: number;
  updated_at?: string;
}

interface ClassInfo {
  id: string;
  name: string;
}

interface StyleOption {
  style_key: string;
  name: string;
  summary?: string;
  max_chars: number;
  enabled?: number;
}

const KIND_OPTIONS: { value: LecturePageKind; label: string; hint: string }[] = [
  { value: 'lead', label: '引入', hint: '每课第一页：一句钩子 + 大标题' },
  { value: 'point', label: '要点', hint: '2~4 条要点卡' },
  { value: 'steps', label: '流程', hint: '横向箭头，2~4 步' },
  { value: 'table', label: '对比', hint: '2~3 列对照表' },
  { value: 'chart', label: '数据', hint: '柱状图（数字必须来自大纲）' },
  { value: 'code', label: '代码', hint: '带行号的代码块 + 说明' },
  { value: 'example', label: '例子', hint: '情景 + 设问 + 揭晓式答案' },
  { value: 'recap', label: '小结', hint: '每课最后一页：回顾要点' },
];

const KIND_ICON: Record<string, string> = {
  lead: 'fa-lightbulb',
  point: 'fa-list-check',
  steps: 'fa-arrow-right-arrow-left',
  table: 'fa-table-columns',
  chart: 'fa-chart-simple',
  code: 'fa-code',
  example: 'fa-circle-question',
  recap: 'fa-check-double',
};

const fmtDuration = (sec: number) => {
  const s = Number(sec) || 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m} 分 ${r} 秒` : `${r} 秒`;
};

/** 空页面模板：新增一页时按页型给一份可编辑的骨架 */
function blankPage(kind: LecturePageKind): LecturePage {
  const base: LecturePage = { kind, title: '新的一页', narration: '' };
  if (kind === 'lead') return { ...base, kicker: '' };
  if (kind === 'point' || kind === 'recap') return { ...base, bullets: [''] };
  if (kind === 'steps') return { ...base, steps: [{ label: '', text: '' }, { label: '', text: '' }] };
  if (kind === 'table') return { ...base, table: { columns: ['列1', '列2'], rows: [['', '']] } };
  if (kind === 'chart') return { ...base, chart: { unit: '', items: [{ label: '', value: 0 }] } };
  if (kind === 'code') return { ...base, code: { lang: 'python', text: '' }, note: '' };
  if (kind === 'example') return { ...base, scenario: '', question: '', answer: '' };
  return base;
}

/**
 * AI 讲堂（微课程）管理器。
 *
 * 与错题讲解的差别决定了界面形态：微课程是老师的**长期资产**，
 * 所以是「列表 → 生成 → 逐页审改 → 发布」的编辑流程，而不是「点一下就播」。
 * ⛔ 发布是显式动作：草稿永远不会下发给学生（后端已挡），老师不点发布就不算数。
 */
export const LectureManager: React.FC = () => {
  const [list, setList] = useState<LectureCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(''); // 非空表示有异步任务在跑，显示遮罩
  const [busyText, setBusyText] = useState('');

  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [styles, setStyles] = useState<StyleOption[]>([]);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<Lecture | null>(null);
  const [playing, setPlaying] = useState<Lecture | null>(null);
  const [editPageIdx, setEditPageIdx] = useState(0);

  // ---------- 数据加载 ----------
  const loadList = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await backendClient.get('/api/teacher/lectures');
      setList(res?.data?.lectures || []);
    } catch (e) {
      setErr((e as Error).message || '读取微课程失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
    (async () => {
      try {
        const c = await backendClient.get('/api/classes');
        setClasses(c?.data || []);
      } catch { /* 班级拉不到不影响生成，只是不能限定班级 */ }
      try {
        const s = await backendClient.get('/api/teacher/explain/styles');
        const arr = s?.data?.styles || s?.styles || [];
        setStyles(arr.filter((x: StyleOption) => x.enabled !== 0 || x.style_key === 'lecture'));
      } catch { /* 风格拉不到就用后端默认 */ }
    })();
  }, [loadList]);

  const openEditor = useCallback(async (id: string) => {
    setBusy('load');
    setBusyText('正在打开…');
    try {
      const res = await backendClient.get(`/api/teacher/lectures/${id}`);
      setEditing(res?.data?.lecture || null);
      setEditPageIdx(0);
    } catch (e) {
      alert((e as Error).message || '打开失败');
    } finally {
      setBusy('');
    }
  }, []);

  const doPublish = async (item: LectureCard) => {
    if (item.status === 'published') {
      if (!window.confirm(`取消发布后学生端就看不到「${item.title}」了，确定吗？`)) return;
      await backendClient.post(`/api/teacher/lectures/${item.id}/unpublish`, {});
    } else {
      if (!item.page_count) { alert('这门课还没有生成页面，不能发布'); return; }
      await backendClient.post(`/api/teacher/lectures/${item.id}/publish`, {});
    }
    await loadList();
  };

  const doDuplicate = async (item: LectureCard) => {
    await backendClient.post(`/api/teacher/lectures/${item.id}/duplicate`, {});
    await loadList();
  };

  const doDelete = async (item: LectureCard) => {
    if (!window.confirm(`删除「${item.title}」？删除后无法恢复。\n（已发布的话学生端也会一起消失）`)) return;
    await backendClient.delete(`/api/teacher/lectures/${item.id}`);
    await loadList();
  };

  const playItem = async (id: string) => {
    setBusy('load');
    setBusyText('正在准备播放…');
    try {
      const res = await backendClient.get(`/api/teacher/lectures/${id}`);
      const lec = res?.data?.lecture;
      if (!lec?.pages?.length) { alert('这门课还没有页面'); return; }
      setPlaying(lec);
    } catch (e) {
      alert((e as Error).message || '打开失败');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="h-full overflow-auto bg-gray-50 p-6">
      {/* 顶部 */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
            <i className="fa-solid fa-chalkboard-user text-violet-600"></i>AI 讲堂
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            给知识点就能生成一节图文并茂的语音微课程，投屏就能上；发布后学生端也能自己看。
          </p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <i className="fa-solid fa-plus mr-1.5"></i>新建微课程
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          <i className="fa-solid fa-circle-exclamation mr-1.5"></i>{err}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-400">
          <i className="fa-solid fa-spinner fa-spin mr-2"></i>加载中…
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white py-16 text-center">
          <i className="fa-solid fa-chalkboard-user mb-3 text-4xl text-gray-300"></i>
          <p className="text-gray-500">还没有微课程</p>
          <p className="mt-1 text-sm text-gray-400">点右上角「新建微课程」，填上知识点大纲就行</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((item) => (
            <div key={item.id} className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md">
              <div className="flex items-start gap-3 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
                  <i className={`fa-solid ${KIND_ICON[item.cover?.kind || 'lead'] || 'fa-lightbulb'}`}></i>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-gray-800" title={item.title}>{item.title}</h3>
                    {item.status === 'published' ? (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700">已发布</span>
                    ) : (
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">草稿</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {item.chapter || item.subject || '未填章节'}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {item.page_count} 页 · 约 {fmtDuration(item.duration_sec)}
                    {item.play_count > 0 && <span className="ml-2">播放 {item.play_count} 次</span>}
                  </p>
                </div>
              </div>

              <div className="mt-auto flex items-center gap-1.5 border-t border-gray-100 px-3 py-2">
                <button
                  onClick={() => playItem(item.id)}
                  disabled={!item.page_count}
                  className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-40"
                  title="全屏投屏播放"
                >
                  <i className="fa-solid fa-play mr-1"></i>播放
                </button>
                <button onClick={() => openEditor(item.id)} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                  <i className="fa-solid fa-pen mr-1"></i>编辑
                </button>
                <button
                  onClick={() => doPublish(item)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs ${
                    item.status === 'published'
                      ? 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                      : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  {item.status === 'published' ? '取消发布' : '发布'}
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => doDuplicate(item)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="复制一份">
                    <i className="fa-solid fa-clone text-xs"></i>
                  </button>
                  <button onClick={() => doDelete(item)} className="rounded p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600" title="删除">
                    <i className="fa-solid fa-trash text-xs"></i>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {wizardOpen && (
        <NewLectureWizard
          classes={classes}
          styles={styles}
          onClose={() => setWizardOpen(false)}
          onCreated={async (lecture) => {
            setWizardOpen(false);
            await loadList();
            setEditing(lecture);
            setEditPageIdx(0);
          }}
        />
      )}

      {editing && (
        <LectureEditor
          lecture={editing}
          classes={classes}
          pageIdx={editPageIdx}
          onPageIdx={setEditPageIdx}
          onClose={async () => { setEditing(null); await loadList(); }}
          onPreview={() => setPlaying(editing)}
          onSaved={(lec) => setEditing(lec)}
        />
      )}

      {playing && (
        <LecturePlayer
          lecture={playing}
          audience="teacher"
          onClose={() => setPlaying(null)}
          onEditPage={(i) => {
            // 投屏时发现某页不对 → 直接回编辑器定位到那一页
            setPlaying(null);
            if (!editing) openEditor(playing.id);
            setEditPageIdx(i);
          }}
        />
      )}

      {busy && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-3 rounded-xl bg-white px-6 py-4 shadow-xl">
            <i className="fa-solid fa-spinner fa-spin text-violet-600"></i>
            <span className="text-sm text-gray-700">{busyText}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ 新建向导 ============
const NewLectureWizard: React.FC<{
  classes: ClassInfo[];
  styles: StyleOption[];
  onClose: () => void;
  onCreated: (lecture: Lecture) => void;
}> = ({ classes, styles, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('必修1');
  const [chapter, setChapter] = useState('');
  const [outline, setOutline] = useState('');
  const [requirement, setRequirement] = useState('');
  const [styleKey, setStyleKey] = useState('lecture');
  const [pageTarget, setPageTarget] = useState(7);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<'form' | 'creating' | 'generating'>('form');
  const [err, setErr] = useState('');

  const submit = async (generate: boolean) => {
    if (!title.trim()) { setErr('请填写课程标题'); return; }
    if (!outline.trim()) { setErr('请填写知识点大纲'); return; }
    setErr('');
    setPhase('creating');
    try {
      const created = await backendClient.post('/api/teacher/lectures', {
        title: title.trim(), subject, chapter: chapter.trim(), outline, requirement,
        style_key: styleKey, class_ids: classIds, page_target: pageTarget,
      });
      const lec = created?.data?.lecture;
      if (!lec) throw new Error('创建失败');
      if (!generate) { onCreated(lec); return; }

      setPhase('generating');
      const gen = await backendClient.post(`/api/teacher/lectures/${lec.id}/generate`, {
        style_key: styleKey, page_target: pageTarget,
      });
      const full = gen?.data?.lecture;
      if (!full?.pages?.length) throw new Error('生成失败，没有拿到页面');
      onCreated(full);
    } catch (e) {
      setErr((e as Error).message || '生成失败');
      setPhase('form');
    }
  };

  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <h3 className="text-lg font-semibold text-gray-800">新建微课程</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" disabled={phase !== 'form'}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {phase !== 'form' ? (
            <div className="py-14 text-center">
              <i className="fa-solid fa-wand-magic-sparkles mb-4 text-4xl text-violet-500"></i>
              <p className="text-gray-700">
                {phase === 'creating' ? '正在创建…' : '正在生成微课程，约 10~30 秒'}
              </p>
              <p className="mt-1 text-sm text-gray-400">生成中请勿关闭窗口</p>
            </div>
          ) : (
            <div className="space-y-4">
              {err && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">课程标题</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例如：数据、信息与知识"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">教材模块</label>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="必修1">必修1</option>
                    <option value="必修2">必修2</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">章节（可留空）</label>
                <input
                  value={chapter}
                  onChange={(e) => setChapter(e.target.value)}
                  placeholder="例如：1.1 我们身边的数据"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  知识点大纲 <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={outline}
                  onChange={(e) => setOutline(e.target.value)}
                  rows={7}
                  placeholder={'一行一个知识点，写得越具体，讲得越准。例如：\n1. 数据是客观事物的符号记录，可以是数字、文字、图像、声音\n2. 信息是加工后的、对人有意义的数据\n3. 知识是信息经过提炼形成的规律性认识\n4. 三者关系：数据 → 信息 → 知识，逐层加工'}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-violet-400 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  大纲里有数字才会生成柱状图页——模型不会自己编数据画图。
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">额外要求（可留空）</label>
                <textarea
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  rows={2}
                  placeholder="例如：面向学测，重点讲清三者区别，用天气预报的例子贯穿"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">讲解风格</label>
                  <select
                    value={styleKey}
                    onChange={(e) => setStyleKey(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    {styles.map((s) => (
                      <option key={s.style_key} value={s.style_key}>{s.name}</option>
                    ))}
                    {!styles.some((s) => s.style_key === 'lecture') && <option value="lecture">课堂讲授</option>}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">页数（3~12）</label>
                  <input
                    type="number"
                    min={3}
                    max={12}
                    value={pageTarget}
                    onChange={(e) => setPageTarget(Math.min(12, Math.max(3, Number(e.target.value) || 7)))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-400">7 页约 3 分钟</p>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  开放班级（不选 = 全部班级可见）
                </label>
                <div className="flex flex-wrap gap-2">
                  {classes.length === 0 && <span className="text-xs text-gray-400">没有可选班级</span>}
                  {classes.map((c) => {
                    const on = classIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setClassIds((prev) => (on ? prev.filter((x) => x !== c.id) : [...prev, c.id]))}
                        className={`rounded-lg border px-3 py-1.5 text-xs ${on ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                      >
                        {on && <i className="fa-solid fa-check mr-1"></i>}{c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-3">
          <button onClick={onClose} disabled={phase !== 'form'} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            取消
          </button>
          <button onClick={() => submit(false)} disabled={phase !== 'form'} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            只存大纲
          </button>
          <button onClick={() => submit(true)} disabled={phase !== 'form'} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
            <i className="fa-solid fa-wand-magic-sparkles mr-1.5"></i>生成微课程
          </button>
        </div>
      </div>
    </div>
  );
};

// ============ 编辑器 ============
const LectureEditor: React.FC<{
  lecture: Lecture;
  classes: ClassInfo[];
  pageIdx: number;
  onPageIdx: (i: number) => void;
  onClose: () => void;
  onPreview: () => void;
  onSaved: (lec: Lecture) => void;
}> = ({ lecture, classes, pageIdx, onPageIdx, onClose, onPreview, onSaved }) => {
  const pages = lecture.pages || [];
  const page = pages[pageIdx];
  const [draft, setDraft] = useState<LecturePage | null>(page || null);
  const [meta, setMeta] = useState({ title: lecture.title, chapter: lecture.chapter || '', class_ids: lecture.class_ids || [] as string[] });
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    setDraft(pages[pageIdx] || null);
    setDirty(false);
  }, [pageIdx, pages]);

  const patch = (p: Partial<LecturePage>) => { setDraft((d) => (d ? { ...d, ...p } : d)); setDirty(true); };

  const savePage = async (silent = false) => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = pages.slice();
      next[pageIdx] = draft;
      const res = await backendClient.put(`/api/teacher/lectures/${lecture.id}`, { pages: next });
      const lec = res?.data?.lecture;
      if (lec) onSaved(lec);
      setDirty(false);
      if (!silent) { /* 保存成功不弹窗，避免打断编辑节奏 */ }
    } catch (e) {
      alert((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveMeta = async () => {
    setSaving(true);
    try {
      const res = await backendClient.put(`/api/teacher/lectures/${lecture.id}`, {
        title: meta.title, chapter: meta.chapter, class_ids: meta.class_ids,
      });
      const lec = res?.data?.lecture;
      if (lec) onSaved(lec);
    } catch (e) {
      alert((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const regeneratePage = async () => {
    if (dirtyRef.current && !window.confirm('这一页还有未保存的修改，重新生成会覆盖，继续吗？')) return;
    setRegen(true);
    try {
      const res = await backendClient.post(`/api/teacher/lectures/${lecture.id}/generate-page`, {
        index: pageIdx, kind: draft?.kind,
      });
      const lec = res?.data?.lecture;
      if (lec) { onSaved(lec); setDraft(lec.pages[pageIdx]); setDirty(false); }
    } catch (e) {
      alert((e as Error).message || '重新生成失败');
    } finally {
      setRegen(false);
    }
  };

  const movePage = async (dir: -1 | 1) => {
    const target = pageIdx + dir;
    if (target < 0 || target >= pages.length) return;
    const next = pages.slice();
    [next[pageIdx], next[target]] = [next[target], next[pageIdx]];
    setSaving(true);
    try {
      const res = await backendClient.put(`/api/teacher/lectures/${lecture.id}`, { pages: next });
      if (res?.data?.lecture) onSaved(res.data.lecture);
      onPageIdx(target);
    } finally {
      setSaving(false);
    }
  };

  const deletePage = async () => {
    if (pages.length <= 1) { alert('至少要保留一页'); return; }
    if (!window.confirm(`删除第 ${pageIdx + 1} 页？`)) return;
    const next = pages.filter((_, i) => i !== pageIdx);
    setSaving(true);
    try {
      const res = await backendClient.put(`/api/teacher/lectures/${lecture.id}`, { pages: next });
      if (res?.data?.lecture) onSaved(res.data.lecture);
      onPageIdx(Math.max(0, pageIdx - 1));
    } finally {
      setSaving(false);
    }
  };

  const addPage = async (after: number) => {
    const insertAt = Math.min(after + 1, pages.length);
    const next = pages.slice();
    next.splice(insertAt, 0, blankPage('point'));
    setSaving(true);
    try {
      const res = await backendClient.put(`/api/teacher/lectures/${lecture.id}`, { pages: next });
      if (res?.data?.lecture) onSaved(res.data.lecture);
      onPageIdx(insertAt);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9980] flex flex-col bg-gray-100">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-5 py-2.5">
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100" title="返回列表">
          <i className="fa-solid fa-arrow-left"></i>
        </button>
        <input
          value={meta.title}
          onChange={(e) => setMeta({ ...meta, title: e.target.value })}
          onBlur={saveMeta}
          className="w-72 rounded-lg border border-transparent px-2 py-1 text-base font-semibold text-gray-800 hover:border-gray-300 focus:border-violet-400 focus:outline-none"
        />
        <input
          value={meta.chapter}
          onChange={(e) => setMeta({ ...meta, chapter: e.target.value })}
          onBlur={saveMeta}
          placeholder="章节"
          className="w-48 rounded-lg border border-transparent px-2 py-1 text-sm text-gray-600 hover:border-gray-300 focus:border-violet-400 focus:outline-none"
        />
        <span className="text-xs text-gray-400">{pages.length} 页</span>

        <div className="ml-auto flex items-center gap-2">
          {saving && <span className="text-xs text-gray-400"><i className="fa-solid fa-spinner fa-spin mr-1"></i>保存中</span>}
          {dirty && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">有未保存修改</span>}
          <select
            multiple
            value={meta.class_ids}
            onChange={(e) => {
              const ids = Array.from(e.target.selectedOptions).map((o) => o.value);
              setMeta({ ...meta, class_ids: ids });
              backendClient.put(`/api/teacher/lectures/${lecture.id}`, { class_ids: ids })
                .then((r: any) => r?.data?.lecture && onSaved(r.data.lecture))
                .catch(() => {});
            }}
            className="h-8 rounded-lg border border-gray-300 px-1 text-xs"
            title="按住 Ctrl 多选；不选 = 全部班级可见"
          >
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={onPreview} className="rounded-lg border border-violet-300 px-3 py-1.5 text-xs text-violet-700 hover:bg-violet-50">
            <i className="fa-solid fa-play mr-1"></i>预览投屏
          </button>
          <button
            onClick={() => savePage()}
            disabled={saving}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            保存本页
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左侧页列表 */}
        <div className="w-56 shrink-0 overflow-auto border-r border-gray-200 bg-white p-2">
          {pages.map((p, i) => (
            <button
              key={i}
              onClick={() => onPageIdx(i)}
              className={`mb-1 flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left ${i === pageIdx ? 'bg-violet-50 ring-1 ring-violet-300' : 'hover:bg-gray-50'}`}
            >
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${i === pageIdx ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-gray-800">{p.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                  {KIND_OPTIONS.find((k) => k.value === p.kind)?.label || p.kind}
                </span>
              </span>
            </button>
          ))}
          <button
            onClick={() => addPage(pages.length - 1)}
            className="mt-1 w-full rounded-lg border border-dashed border-gray-300 py-1.5 text-xs text-gray-500 hover:border-violet-400 hover:text-violet-600"
          >
            <i className="fa-solid fa-plus mr-1"></i>加一页
          </button>
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 overflow-auto p-5">
          {!draft ? (
            <div className="py-16 text-center text-gray-400">没有可编辑的页面</div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="flex items-center gap-2">
                <button onClick={() => movePage(-1)} disabled={pageIdx === 0} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                  <i className="fa-solid fa-arrow-up"></i>
                </button>
                <button onClick={() => movePage(1)} disabled={pageIdx === pages.length - 1} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                  <i className="fa-solid fa-arrow-down"></i>
                </button>
                <button onClick={() => addPage(pageIdx)} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                  <i className="fa-solid fa-plus mr-1"></i>在下面插一页
                </button>
                <button onClick={deletePage} className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
                  <i className="fa-solid fa-trash mr-1"></i>删本页
                </button>
                <button
                  onClick={regeneratePage}
                  disabled={regen}
                  className="ml-auto rounded-lg border border-violet-300 px-3 py-1.5 text-xs text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  title="只重写这一页，其他页不动"
                >
                  {regen ? <><i className="fa-solid fa-spinner fa-spin mr-1"></i>生成中</> : <><i className="fa-solid fa-wand-magic-sparkles mr-1"></i>重新生成这一页</>}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">页型</label>
                  <select
                    value={draft.kind}
                    onChange={(e) => patch({ kind: e.target.value as LecturePageKind })}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label} · {k.hint}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">页标题（≤20 字）</label>
                  <input
                    value={draft.title}
                    onChange={(e) => patch({ title: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  讲解词（≤300 字，会逐句朗读并显示为字幕）
                </label>
                <textarea
                  value={draft.narration}
                  onChange={(e) => patch({ narration: e.target.value })}
                  rows={5}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-violet-400 focus:outline-none"
                />
                <p className="mt-1 text-right text-[11px] text-gray-400">{draft.narration.length} / 300</p>
              </div>

              <PageFields draft={draft} patch={patch} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** 各页型的结构化字段编辑 */
const PageFields: React.FC<{ draft: LecturePage; patch: (p: Partial<LecturePage>) => void }> = ({ draft, patch }) => {
  const inputCls = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-violet-400 focus:outline-none';

  if (draft.kind === 'lead') {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">钩子（为什么学这个，≤24 字）</label>
        <input value={draft.kicker || ''} onChange={(e) => patch({ kicker: e.target.value })} className={inputCls} />
      </div>
    );
  }

  if (draft.kind === 'point' || draft.kind === 'recap') {
    const bullets = draft.bullets || [];
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">要点（每条 ≤26 字）</label>
        <div className="space-y-2">
          {bullets.map((b, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={b}
                onChange={(e) => { const n = bullets.slice(); n[i] = e.target.value; patch({ bullets: n }); }}
                className={inputCls}
              />
              <button
                onClick={() => patch({ bullets: bullets.filter((_, j) => j !== i) })}
                className="shrink-0 rounded px-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <i className="fa-solid fa-xmark text-xs"></i>
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => patch({ bullets: [...bullets, ''] })} className="mt-1.5 text-xs text-violet-600 hover:underline">
          <i className="fa-solid fa-plus mr-1"></i>加一条
        </button>
      </div>
    );
  }

  if (draft.kind === 'steps') {
    const steps = draft.steps || [];
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">步骤</label>
        <div className="space-y-2">
          {steps.map((st, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">{i + 1}</span>
              <input
                value={st.label}
                placeholder="动作名"
                onChange={(e) => { const n = steps.slice(); n[i] = { ...n[i], label: e.target.value }; patch({ steps: n }); }}
                className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <input
                value={st.text}
                placeholder="一句说明"
                onChange={(e) => { const n = steps.slice(); n[i] = { ...n[i], text: e.target.value }; patch({ steps: n }); }}
                className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <button onClick={() => patch({ steps: steps.filter((_, j) => j !== i) })} className="rounded px-1 text-gray-400 hover:text-rose-600">
                <i className="fa-solid fa-xmark text-xs"></i>
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => patch({ steps: [...steps, { label: '', text: '' }] })} className="mt-1.5 text-xs text-violet-600 hover:underline">
          <i className="fa-solid fa-plus mr-1"></i>加一步
        </button>
      </div>
    );
  }

  if (draft.kind === 'table') {
    const table = draft.table || { columns: ['列1', '列2'], rows: [['', '']] };
    const setCell = (ri: number, ci: number, v: string) => {
      const rows = table.rows.map((r) => r.slice());
      rows[ri][ci] = v;
      patch({ table: { ...table, rows } });
    };
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">对照表</label>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                {table.columns.map((c, ci) => (
                  <th key={ci} className="p-1.5">
                    <input
                      value={c}
                      onChange={(e) => { const cols = table.columns.slice(); cols[ci] = e.target.value; patch({ table: { ...table, columns: cols } }); }}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-medium"
                    />
                  </th>
                ))}
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-gray-100">
                  {table.columns.map((_, ci) => (
                    <td key={ci} className="p-1.5">
                      <input
                        value={row[ci] || ''}
                        onChange={(e) => setCell(ri, ci, e.target.value)}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                      />
                    </td>
                  ))}
                  <td className="text-center">
                    <button onClick={() => patch({ table: { ...table, rows: table.rows.filter((_, j) => j !== ri) } })} className="text-gray-400 hover:text-rose-600">
                      <i className="fa-solid fa-xmark text-xs"></i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={() => patch({ table: { ...table, rows: [...table.rows, table.columns.map(() => '')] } })}
          className="mt-1.5 text-xs text-violet-600 hover:underline"
        >
          <i className="fa-solid fa-plus mr-1"></i>加一行
        </button>
      </div>
    );
  }

  if (draft.kind === 'chart') {
    const chart = draft.chart || { unit: '', items: [{ label: '', value: 0 }] };
    return (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">单位</label>
          <input
            value={chart.unit || ''}
            onChange={(e) => patch({ chart: { ...chart, unit: e.target.value } })}
            className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
          />
          <span className="text-[11px] text-gray-400">数字必须能在课程大纲/讲解词里找到，否则播放时会被降级成要点页</span>
        </div>
        <div className="space-y-2">
          {chart.items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={it.label}
                placeholder="标签"
                onChange={(e) => { const n = chart.items.slice(); n[i] = { ...n[i], label: e.target.value }; patch({ chart: { ...chart, items: n } }); }}
                className="w-40 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                value={it.value}
                onChange={(e) => { const n = chart.items.slice(); n[i] = { ...n[i], value: Number(e.target.value) }; patch({ chart: { ...chart, items: n } }); }}
                className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <button onClick={() => patch({ chart: { ...chart, items: chart.items.filter((_, j) => j !== i) } })} className="rounded px-1 text-gray-400 hover:text-rose-600">
                <i className="fa-solid fa-xmark text-xs"></i>
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => patch({ chart: { ...chart, items: [...chart.items, { label: '', value: 0 }] } })} className="mt-1.5 text-xs text-violet-600 hover:underline">
          <i className="fa-solid fa-plus mr-1"></i>加一项
        </button>
      </div>
    );
  }

  if (draft.kind === 'code') {
    const code = draft.code || { lang: 'python', text: '' };
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">语言</label>
          <select
            value={code.lang || 'python'}
            onChange={(e) => patch({ code: { ...code, lang: e.target.value } })}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="python">python</option>
            <option value="sql">sql</option>
            <option value="text">text</option>
          </select>
        </div>
        <textarea
          value={code.text}
          onChange={(e) => patch({ code: { ...code, text: e.target.value } })}
          rows={8}
          spellCheck={false}
          className="w-full rounded-lg border border-gray-300 bg-slate-900 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100 focus:border-violet-400 focus:outline-none"
        />
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">代码下方说明（≤60 字）</label>
          <input value={draft.note || ''} onChange={(e) => patch({ note: e.target.value })} className={inputCls} />
        </div>
      </div>
    );
  }

  // example
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">情景（≤80 字）</label>
        <textarea value={draft.scenario || ''} onChange={(e) => patch({ scenario: e.target.value })} rows={2} className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">设问（≤60 字）</label>
        <input value={draft.question || ''} onChange={(e) => patch({ question: e.target.value })} className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">答案（播放时先藏起来，讲完才揭晓）</label>
        <textarea value={draft.answer || ''} onChange={(e) => patch({ answer: e.target.value })} rows={2} className={inputCls} />
      </div>
    </div>
  );
};

export default LectureManager;
