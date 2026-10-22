import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { authHeaders } from '../../utils/authToken';
import {
  buildVoiceChoices,
  findVoiceByName,
  listZhVoices,
  normalizeNameList,
  parseChoice,
  pickDefaultChoice,
  pickEdgeVoice,
  splitVoices,
  speakUtterance,
  VOICE_MORE,
  type TtsEngine,
  type VoiceChoice,
  type XfyunVoice,
} from '../../utils/ttsEngine';
import { CourseFlowDiagram } from './CourseFlowDiagram';

export type LecturePageKind = 'lead' | 'point' | 'steps' | 'flow' | 'table' | 'chart' | 'code' | 'example' | 'recap';

export interface LecturePage {
  kind: LecturePageKind;
  title: string;
  narration: string;
  kicker?: string;
  bullets?: string[];
  steps?: { label: string; text: string }[];
  flow?: { nodes: { id: string; type: 'start' | 'io' | 'process' | 'decision' | 'end'; text: string }[]; edges: { from: string; to: string; label?: string }[] };
  table?: { columns: string[]; rows: string[][] };
  chart?: { unit?: string; items: { label: string; value: number }[] };
  code?: { lang?: string; text: string };
  note?: string;
  scenario?: string;
  question?: string;
  answer?: string;
}

export interface Lecture {
  id: string;
  title: string;
  subject?: string;
  chapter?: string;
  style_key?: string;
  pages: LecturePage[];
  page_count?: number;
  duration_sec?: number;
  class_ids?: string[];
  status?: 'draft' | 'published';
}

interface TtsConfig {
  configured: boolean;
  voices: { id: string; name: string; group?: string; note?: string }[];
  voice: string;
  /** 系统设置里勾的课堂常用发音人（空 = 全部显示） */
  favorites?: string[];
  /** 系统设置里勾的 Edge 常用音色（短名；空 = 用内置最常用的 6 个） */
  edgeFavorites?: string[];
  speed: number;
}

interface Props {
  lecture: Lecture;
  /** teacher：可以跳到编辑器改这一页；student：只读 */
  audience?: 'teacher' | 'student';
  onClose: () => void;
  onEditPage?: (index: number) => void;
}

const VOICE_KEY = 'xgpy_lecture_voice';
const RATE_KEY = 'xgpy_lecture_rate';
const FONT_KEY = 'xgpy_lecture_font';
const AUTONEXT_KEY = 'xgpy_lecture_autonext';

/** 按中文标点切句：逐句合成才不会一段等十几秒 */
function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[。！？；!?;])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const PAGE_KIND_LABEL: Record<string, string> = {
  lead: '引入',
  point: '要点',
  steps: '流程',
  table: '对比',
  chart: '数据',
  code: '代码',
  example: '例子',
  recap: '小结',
};

const readNum = (key: string, fallback: number) => {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * AI 讲堂 · 微课程播放器。
 *
 * ⛔ 必须 portal 到 document.body：桌面端的 WindowFrame 带 transform，会形成层叠上下文，
 *    全屏 fixed 层会被任务栏压住（错题讲解第一次就踩了这个坑）。
 * ⛔ 全屏层只许动 opacity：以前给整屏层加 transform 缩放，暴击后直接合成层卡死。
 *    翻页动画因此只用淡入淡出，缩放一律不下放到全屏容器。
 */
export const LecturePlayer: React.FC<Props> = ({ lecture, audience = 'teacher', onClose, onEditPage }) => {
  const pages = useMemo(() => (Array.isArray(lecture.pages) ? lecture.pages : []), [lecture.pages]);
  const apiBase = `/api/${audience === 'teacher' ? 'teacher' : 'student'}/explain`;

  const [pageIdx, setPageIdx] = useState(0);
  const [sentenceIdx, setSentenceIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ttsConfig, setTtsConfig] = useState<TtsConfig | null>(null);
  const [voice, setVoice] = useState('');
  // 语音引擎三级降级：Edge 在线（免费）→ 讯飞云端（按量计费）→ 本机。
  // choice 是下拉里的值：`edge::<voice.name>` / `xfyun::<vcn>` / `local::<voice.name>`
  const [choice, setChoice] = useState('');
  const [voiceChoices, setVoiceChoices] = useState<VoiceChoice[]>([]);
  /** 点过「更多发音人…」→ 这次播放期间展开全部（不记住，下次仍从精简列表开始） */
  const [showAllVoices, setShowAllVoices] = useState(false);
  const [sysVoices, setSysVoices] = useState<{ edge: SpeechSynthesisVoice[]; local: SpeechSynthesisVoice[] }>({ edge: [], local: [] });
  const [rate, setRate] = useState(() => readNum(RATE_KEY, 1));
  const [fontScale, setFontScale] = useState(() => readNum(FONT_KEY, 1));
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem(AUTONEXT_KEY) !== '0');
  const [revealed, setRevealed] = useState(false);
  /** 哪一级引擎失败降级了（null = 一切正常），只用于顶栏提示 */
  const [degraded, setDegraded] = useState<null | 'edge' | 'xfyun'>(null);
  const [fadeIn, setFadeIn] = useState(false);

  const page = pages[pageIdx];
  const sentences = useMemo(() => splitSentences(page?.narration || ''), [page?.narration]);
  const isLastPage = pageIdx >= pages.length - 1;

  const tokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCacheRef = useRef<Map<string, Blob>>(new Map());
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  /** 本课内一旦某级引擎失败就锁定降级，避免每句都先去试一遍再失败（每句白等 200~500ms） */
  const engineLockRef = useRef<TtsEngine | null>(null);
  const nextTimerRef = useRef<number | null>(null);
  const markedRef = useRef<Set<string>>(new Set());

  // ---------- 语音配置 ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/tts/config`, { headers: authHeaders() });
        const json = await res.json().catch(() => null);
        if (!alive || !json?.data) return;
        const cfg = json.data as TtsConfig;
        setTtsConfig(cfg);
        setVoice((v) => v || localStorage.getItem(VOICE_KEY) || cfg.voice || '');
      } catch {
        /* 语音不可用就走本机朗读 */
      }
    })();
    return () => { alive = false; };
  }, [apiBase]);

  useEffect(() => {
    if (!ttsConfig || !voice) return;
    localStorage.setItem(VOICE_KEY, voice);
    localStorage.setItem(RATE_KEY, String(rate));
  }, [voice, rate, ttsConfig]);

  useEffect(() => { localStorage.setItem(FONT_KEY, String(fontScale)); }, [fontScale]);
  useEffect(() => { localStorage.setItem(AUTONEXT_KEY, autoNext ? '1' : '0'); }, [autoNext]);

  // 系统音色：Edge 的在线自然音色（Azure 神经网络，免费）与本机 SAPI 音色一起取，
  // 用于「Edge 优先 → 讯飞 → 本机」三级降级。getVoices 异步填充，所以 onvoiceschanged 再取一次。
  useEffect(() => {
    if (!window.speechSynthesis) return;
    const load = () => {
      const { edge, local } = splitVoices(listZhVoices());
      setSysVoices({ edge, local });
      // 本机兜底音色：优先老牌中文音色
      voiceRef.current = local.find((v) => /Huihui|Xiaoxiao|Yaoyao|Kangkang/i.test(v.name)) || local[0] || null;
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // 下拉选项：Edge 在前、讯飞其次、本机兜底。没有 Edge 音色时列表里就没有 Edge 组，
  // 默认值自动落到讯飞 —— 这就是老师要的「没 Edge 就用小露」。
  // ⛔ 没有 Edge 音色时**必须等讯飞配置加载完**再定默认：否则第一次渲染时讯飞列表还是空的，
  //    默认会落成「本机」并记住，配置回来以后也再不会被升级成讯飞（实测踩过）。
  useEffect(() => {
    const list = buildVoiceChoices(
      sysVoices.edge,
      (ttsConfig?.voices || []) as XfyunVoice[],
      sysVoices.local,
      {
        favoriteIds: ttsConfig?.favorites,
        edgeFavoriteIds: ttsConfig?.edgeFavorites,
        keepId: ttsConfig?.voice || voice,
        showAll: showAllVoices,
      },
    );
    setVoiceChoices(list);
    if (!sysVoices.edge.length && !ttsConfig) return;
    setChoice((prev) => pickDefaultChoice(list, prev || localStorage.getItem(VOICE_KEY) || '', {
      xfyunDefaultId: ttsConfig?.voice || voice,
      preferEdge: normalizeNameList(ttsConfig?.edgeFavorites)[0] || '晓晓',
    }));
  }, [sysVoices, ttsConfig, voice, showAllVoices]);

  useEffect(() => { if (choice) localStorage.setItem(VOICE_KEY, choice); }, [choice]);

  const picked = useMemo(() => parseChoice(choice), [choice]);

  const cloudReady = !!ttsConfig?.configured;
  /** 讯飞请求用的 vcn：下拉选了讯飞就用它，否则用系统默认（Edge 降级下来时也要能出声） */
  const xfyunVcn = picked.engine === 'xfyun' ? picked.id : voice;

  const getBlob = useCallback(async (text: string): Promise<Blob> => {
    const speed = Math.max(0, Math.min(100, Math.round(50 * rate)));
    const key = `${xfyunVcn}|${speed}|${text}`;
    const hit = blobCacheRef.current.get(key);
    if (hit) return hit;
    const res = await fetch(`${apiBase}/tts`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text, voice: xfyunVcn || undefined, speed }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error((json && json.error) || `语音合成失败（${res.status}）`);
    }
    const blob = await res.blob();
    if (!blob.size) throw new Error('语音文件为空');
    blobCacheRef.current.set(key, blob);
    return blob;
  }, [xfyunVcn, rate, apiBase]);

  const playBlob = useCallback((blob: Blob) => new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('音频播放失败')); };
    audio.play().catch((e) => { URL.revokeObjectURL(url); reject(e); });
  }), []);

  const stopAll = useCallback(() => {
    tokenRef.current += 1;
    window.speechSynthesis?.cancel();
    try { audioRef.current?.pause(); } catch { /* ignore */ }
    if (nextTimerRef.current) { clearTimeout(nextTimerRef.current); nextTimerRef.current = null; }
  }, []);

  const goPage = useCallback((next: number) => {
    if (next < 0 || next >= pages.length) return;
    stopAll();
    setPageIdx(next);
    setSentenceIdx(0);
    setRevealed(false);
    setFadeIn(true);
    window.setTimeout(() => setFadeIn(false), 30);
    setPlaying(true);
  }, [pages.length, stopAll]);

  // 翻页后淡入（只动 opacity）
  useEffect(() => {
    setFadeIn(true);
    const t = window.setTimeout(() => setFadeIn(false), 40);
    return () => clearTimeout(t);
  }, [pageIdx]);

  const markDone = useCallback(() => {
    // 播放次数由学生端详情接口自增；教师投屏不重复计数，这里只在本地标记本课已讲完
    if (audience !== 'teacher') return;
    markedRef.current.add(lecture.id);
  }, [audience, lecture.id]);

  // ---------- 逐句朗读 ----------
  useEffect(() => {
    if (!playing || !page || !sentences.length) return;
    const text = sentences[sentenceIdx];
    if (text == null) return;

    const token = ++tokenRef.current;
    let cancelled = false;

    const advance = () => {
      if (cancelled || token !== tokenRef.current) return;
      if (sentenceIdx < sentences.length - 1) {
        setSentenceIdx(sentenceIdx + 1);
        return;
      }
      // 本页讲完：example 页自动揭晓答案，再按设置翻下一页
      setRevealed(true);
      if (isLastPage) { markDone(); setPlaying(false); return; }
      if (!autoNext) { setPlaying(false); return; }
      nextTimerRef.current = window.setTimeout(() => {
        nextTimerRef.current = null;
        goPage(pageIdx + 1);
      }, 900);
    };

    const speakLocal = () => {
      if (!window.speechSynthesis) { advance(); return; }
      const u = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) u.voice = voiceRef.current;
      u.lang = 'zh-CN';
      u.rate = rate;
      u.onend = () => { if (!cancelled && token === tokenRef.current) advance(); };
      u.onerror = () => { if (!cancelled && token === tokenRef.current) window.setTimeout(advance, 1500); };
      window.speechSynthesis.speak(u);
    };

    (async () => {
      let engine: TtsEngine = engineLockRef.current || picked.engine;

      // ① Edge 在线自然音色（Azure 神经网络，免费、无额度）
      if (engine === 'edge') {
        const v = findVoiceByName(sysVoices.edge, picked.id) || pickEdgeVoice(sysVoices.edge);
        if (v) {
          try {
            await speakUtterance(text, v, rate);
            if (!cancelled && token === tokenRef.current) advance();
            return;
          } catch {
            // 断网 / Edge 朗读通道不可用 → 降一级，别把课卡住
            engineLockRef.current = cloudReady ? 'xfyun' : 'local';
            setDegraded('edge');
            engine = engineLockRef.current;
          }
        } else {
          engineLockRef.current = cloudReady ? 'xfyun' : 'local';
          engine = engineLockRef.current;
        }
      }

      // ② 讯飞云端（按量计费，后端有内存缓存）
      if (engine === 'xfyun' && cloudReady) {
        try {
          const blob = await getBlob(text);
          if (cancelled || token !== tokenRef.current) return;
          await playBlob(blob);
          advance();
          return;
        } catch {
          engineLockRef.current = 'local';
          setDegraded('xfyun'); // 额度/网络/音色未开通 → 回落本机
        }
      }

      // ③ 本机 SAPI
      if (!cancelled && token === tokenRef.current) speakLocal();
    })();

    return () => {
      cancelled = true;
      window.speechSynthesis?.cancel();
      try { audioRef.current?.pause(); } catch { /* ignore */ }
    };
  }, [playing, page, sentences, sentenceIdx, pageIdx, isLastPage, autoNext, cloudReady, picked, sysVoices, rate, getBlob, playBlob, goPage, markDone]);

  // 预取下一句：只在走讯飞（有网络往返）时预取；Edge 是边播边合成，预取没意义
  useEffect(() => {
    const engine = engineLockRef.current || picked.engine;
    if (!cloudReady || engine !== 'xfyun') return;
    const next = sentences[sentenceIdx + 1];
    if (!next) return;
    const t = window.setTimeout(() => { getBlob(next).catch(() => {}); }, 250);
    return () => window.clearTimeout(t);
  }, [cloudReady, picked, sentences, sentenceIdx, getBlob]);

  // 键盘：空格暂停 / 左右翻页 / Esc 退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); return; }
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goPage(pageIdx + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goPage(pageIdx - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPage, pageIdx, onClose]);

  useEffect(() => () => { stopAll(); }, [stopAll]);

  if (!pages.length) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <p className="text-lg text-gray-500">这门课还没有内容</p>
          <button onClick={onClose} className="mt-4 rounded-lg bg-gray-800 px-4 py-2 text-white">关闭</button>
        </div>
      </div>,
      document.body,
    );
  }

  const s = fontScale;
  const totalSentences = sentences.length;
  const choiceGroups = useMemo(() => {
    const map = new Map<string, VoiceChoice[]>();
    voiceChoices.forEach((c) => {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    });
    return Array.from(map.entries());
  }, [voiceChoices]);

  const body = (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-50" style={{ fontSize: `${s}rem` }}>
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-full bg-violet-600 px-3 py-1 text-sm font-medium text-white">
            <i className="fa-solid fa-chalkboard-user mr-1.5"></i>AI 讲堂
          </span>
          <span className="truncate text-base font-semibold text-gray-800" title={lecture.title}>{lecture.title}</span>
          {lecture.chapter && <span className="shrink-0 text-sm text-gray-400">{lecture.chapter}</span>}
          {degraded && (
            <span
              className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
              title={degraded === 'edge'
                ? 'Edge 在线语音不可用（断网或非 Edge 浏览器），已降级到讯飞 / 本机'
                : '讯飞语音不可用（额度、密钥或发音人未开通），已改用本机朗读'}
            >
              {degraded === 'edge' ? '已降级' : '本机语音'}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm text-gray-500">第 {pageIdx + 1} / {pages.length} 页</span>
          {voiceChoices.length > 0 && (
            <select
              value={choice}
              onChange={(e) => {
                const v = e.target.value;
                // 「更多发音人…」不是音色，选中它只是把折叠的项展开
                if (v === VOICE_MORE) { setShowAllVoices(true); return; }
                setChoice(v); engineLockRef.current = null; setDegraded(null);
              }}
              className="max-w-[11rem] rounded-lg border border-gray-300 px-2 py-1 text-xs"
              title="发音人：Edge 在线免费 / 讯飞按量计费 / 本机兜底"
            >
              {choiceGroups.map(([group, list]) => (
                <optgroup key={group} label={group}>
                  {list.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </optgroup>
              ))}
            </select>
          )}
          <select
            value={String(rate)}
            onChange={(e) => setRate(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            title="语速"
          >
            <option value="0.8">0.8×</option>
            <option value="1">1.0×</option>
            <option value="1.15">1.15×</option>
            <option value="1.3">1.3×</option>
          </select>
          <div className="flex items-center gap-1 rounded-lg border border-gray-300 px-1 py-0.5">
            <button onClick={() => setFontScale((v) => Math.max(0.8, +(v - 0.1).toFixed(2)))} className="px-1.5 text-xs text-gray-600 hover:text-gray-900" title="缩小字号">A-</button>
            <span className="text-[11px] text-gray-400">{Math.round(s * 100)}%</span>
            <button onClick={() => setFontScale((v) => Math.min(1.6, +(v + 0.1).toFixed(2)))} className="px-1.5 text-sm text-gray-600 hover:text-gray-900" title="放大字号（投屏用）">A+</button>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            title="退出（Esc）"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      {/* 页面主体 */}
      <div
        className="flex-1 overflow-hidden px-10 py-8 transition-opacity duration-200"
        style={{ opacity: fadeIn ? 0 : 1 }}
      >
        <div className="mx-auto flex h-full max-w-6xl flex-col">
          <PageHead page={page} index={pageIdx} total={pages.length} />
          <div className="mt-6 flex-1 overflow-auto">
            <PageBody page={page} revealed={revealed} onReveal={() => setRevealed(true)} />
          </div>
        </div>
      </div>

      {/* 字幕条：当前句高亮 */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-10 py-3">
        <div className="mx-auto max-w-6xl">
          <p className="text-[1.05em] leading-relaxed text-gray-800">
            {sentences.map((text, i) => (
              <span
                key={i}
                className={
                  i === sentenceIdx
                    ? 'rounded bg-violet-100 px-1 font-semibold text-violet-900'
                    : i < sentenceIdx
                      ? 'text-gray-400'
                      : 'text-gray-600'
                }
              >
                {text}
              </span>
            ))}
            {!sentences.length && <span className="text-gray-400">（这一页没有讲解词）</span>}
          </p>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="flex shrink-0 items-center justify-between border-t border-gray-200 bg-white px-6 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => goPage(pageIdx - 1)}
            disabled={pageIdx === 0}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <i className="fa-solid fa-chevron-left mr-1"></i>上一页
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            {playing ? <><i className="fa-solid fa-pause mr-1"></i>暂停</> : <><i className="fa-solid fa-play mr-1"></i>继续</>}
          </button>
          <button
            onClick={() => { stopAll(); setSentenceIdx(0); setRevealed(false); setPlaying(true); }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            title="从这一页开头重讲"
          >
            <i className="fa-solid fa-rotate-left mr-1"></i>重讲本页
          </button>
          <button
            onClick={() => goPage(pageIdx + 1)}
            disabled={isLastPage}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            下一页<i className="fa-solid fa-chevron-right ml-1"></i>
          </button>
          <label className="ml-2 flex cursor-pointer select-none items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} className="accent-violet-600" />
            讲完自动翻页
          </label>
        </div>

        <div className="flex items-center gap-3">
          {audience === 'teacher' && onEditPage && (
            <button
              onClick={() => { stopAll(); onEditPage(pageIdx); }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              title="回到编辑器修改这一页"
            >
              <i className="fa-solid fa-pen mr-1"></i>改这一页
            </button>
          )}
          <div className="flex items-center gap-1">
            {pages.map((p, i) => (
              <button
                key={i}
                onClick={() => goPage(i)}
                title={`第 ${i + 1} 页 · ${PAGE_KIND_LABEL[p.kind] || p.kind}`}
                className={`h-2 rounded-full transition-all ${i === pageIdx ? 'w-6 bg-violet-600' : 'w-2 bg-gray-300 hover:bg-gray-400'}`}
              />
            ))}
          </div>
          <span className="text-xs text-gray-400">
            {totalSentences ? `本页 ${sentenceIdx + 1}/${totalSentences} 句` : ''}
          </span>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};

/** 页眉：页型标签 + 标题
 *  ⛔ 引入页（lead）不重复显示标题：它的版式本身就是「大标题居中」，
 *    再在顶部排一次同名标题，投屏上会出现两个一模一样的字。
 */
const PageHead: React.FC<{ page: LecturePage; index: number; total: number }> = ({ page, index, total }) => (
  <div className="shrink-0">
    <div className="flex items-center gap-2">
      <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
        {PAGE_KIND_LABEL[page.kind] || page.kind}
      </span>
      <span className="text-xs text-gray-400">第 {index + 1} / {total} 页</span>
    </div>
    {page.kind !== 'lead' && (
      <h2 className="mt-2 text-[2em] font-bold leading-tight text-gray-900">{page.title}</h2>
    )}
  </div>
);

/** 8 种页型渲染 */
const PageBody: React.FC<{
  page: LecturePage;
  revealed: boolean;
  onReveal: () => void;
}> = ({ page, revealed, onReveal }) => {
  if (page.kind === 'lead') {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg">
          <i className="fa-solid fa-lightbulb text-4xl"></i>
        </div>
        {page.kicker && <p className="mb-3 text-[1.3em] font-medium text-violet-700">{page.kicker}</p>}
        <h1 className="max-w-3xl text-[2.6em] font-bold leading-tight text-gray-900">{page.title}</h1>
      </div>
    );
  }

  if (page.kind === 'point' || page.kind === 'recap') {
    const bullets = page.bullets || [];
    return (
      <div className="space-y-4 pt-2">
        {page.kind === 'recap' && (
          <div className="mb-2 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
            <i className="fa-solid fa-check-double"></i>本课小结
          </div>
        )}
        {bullets.length === 0 && <p className="text-[1.2em] leading-relaxed text-gray-700">{page.narration}</p>}
        {bullets.map((b, i) => (
          <div key={i} className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white ${page.kind === 'recap' ? 'bg-emerald-500' : 'bg-violet-600'}`}>
              {page.kind === 'recap' ? <i className="fa-solid fa-check"></i> : i + 1}
            </span>
            <p className="text-[1.35em] leading-relaxed text-gray-800">{b}</p>
          </div>
        ))}
      </div>
    );
  }

  if (page.kind === 'flow' && page.flow) {
    return (
      <div className="pt-2">
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
          <CourseFlowDiagram flow={page.flow} />
        </div>
      </div>
    );
  }

  if (page.kind === 'steps') {
    const steps = page.steps || [];
    return (
      <div className="pt-4">
        <div className="flex items-stretch gap-2">
          {steps.map((st, i) => (
            <React.Fragment key={i}>
              <div className="flex-1 rounded-xl border border-violet-200 bg-white px-4 py-5 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white">{i + 1}</span>
                  <span className="text-[1.3em] font-semibold text-gray-900">{st.label}</span>
                </div>
                <p className="text-[1.1em] leading-relaxed text-gray-600">{st.text}</p>
              </div>
              {i < steps.length - 1 && (
                <div className="flex items-center px-1 text-violet-400">
                  <i className="fa-solid fa-arrow-right text-xl"></i>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  if (page.kind === 'table') {
    const table = page.table || { columns: [], rows: [] };
    return (
      <div className="pt-2">
        <table className="w-full overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm">
          <thead>
            <tr className="bg-violet-600 text-white">
              {table.columns.map((c, i) => (
                <th key={i} className="px-5 py-3 text-[1.15em] font-semibold">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, ri) => (
              <tr key={ri} className={ri % 2 ? 'bg-gray-50' : 'bg-white'}>
                {r.map((cell, ci) => (
                  <td key={ci} className={`px-5 py-3 text-[1.15em] ${ci === 0 ? 'font-medium text-gray-900' : 'text-gray-700'}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (page.kind === 'chart') {
    const items = page.chart?.items || [];
    const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
    return (
      <div className="pt-4">
        <div className="flex h-[22rem] items-end justify-around gap-6 rounded-xl border border-gray-200 bg-white px-8 py-6 shadow-sm">
          {items.map((it, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
              <span className="mb-2 text-[1.1em] font-semibold text-violet-700">
                {it.value}{page.chart?.unit || ''}
              </span>
              <div
                className="w-full max-w-[6rem] rounded-t-lg bg-gradient-to-t from-violet-600 to-indigo-400 transition-all"
                style={{ height: `${Math.max(6, (Number(it.value) / max) * 100)}%` }}
              />
              <span className="mt-2 text-[1.05em] text-gray-700">{it.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (page.kind === 'code') {
    const lines = String(page.code?.text || '').split('\n');
    return (
      <div className="pt-2">
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">{page.code?.lang || 'text'}</span>
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400"></span>
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
            </span>
          </div>
          <pre className="overflow-auto px-4 py-3 text-[1.05em] leading-relaxed text-slate-100">
            {lines.map((ln, i) => (
              <div key={i} className="flex">
                <span className="mr-4 w-8 shrink-0 select-none text-right text-slate-500">{i + 1}</span>
                <code className="whitespace-pre">{ln || ' '}</code>
              </div>
            ))}
          </pre>
        </div>
        {page.note && (
          <p className="mt-3 rounded-lg bg-amber-50 px-4 py-2 text-[1.05em] text-amber-800">
            <i className="fa-solid fa-circle-info mr-1.5"></i>{page.note}
          </p>
        )}
      </div>
    );
  }

  // example
  return (
    <div className="space-y-4 pt-2">
      {page.scenario && (
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">情景</p>
          <p className="mt-1 text-[1.3em] leading-relaxed text-gray-800">{page.scenario}</p>
        </div>
      )}
      {page.question && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-violet-500">想一想</p>
          <p className="mt-1 text-[1.3em] font-semibold leading-relaxed text-violet-900">{page.question}</p>
        </div>
      )}
      {page.answer && (
        revealed ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-600">答案</p>
            <p className="mt-1 text-[1.3em] leading-relaxed text-emerald-900">{page.answer}</p>
          </div>
        ) : (
          <button
            onClick={onReveal}
            className="w-full rounded-xl border-2 border-dashed border-gray-300 bg-white py-6 text-[1.2em] text-gray-500 hover:border-violet-400 hover:text-violet-600"
          >
            <i className="fa-solid fa-eye mr-2"></i>揭晓答案
          </button>
        )
      )}
    </div>
  );
};

export default LecturePlayer;
