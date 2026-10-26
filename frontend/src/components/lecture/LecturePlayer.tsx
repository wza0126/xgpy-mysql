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

export type LecturePageKind = 'lead' | 'point' | 'steps' | 'flow' | 'table' | 'chart' | 'code' | 'example' | 'recap' | 'quiz' | 'lab';

/**
 * 讲解节拍（2026-10-26）：一句一动作。
 * 以前一页只有一整段 narration，学生听完第一句就把后面全看完了；
 * 现在把旁白拆成 beat，每句带一个 focus 指向本页要强调的元素，
 * 播到哪句就把哪个元素点亮、其余淡下去（聚光灯效果）。
 * ⛔ 不叫 steps —— 那个名字已经被「横向步骤图」页型占了。
 */
export interface LectureBeat {
  /** 这一句要念的话 */
  say: string;
  /** 强调哪个元素，取值见后端 normalizeLecturePage 的白名单；不填 = 不高亮 */
  focus?: string;
  /** 讲到这一句时自动运行代码（只有 lab 页用） */
  run?: boolean;
}

/** 检测页的一道题（2026-10-26，题干与选项来自题库，answer/analysis 也来自题库） */
export interface LectureQuizQuestion {
  id: string;
  stem: string;
  options: string[];
  answer: string;
  analysis?: string;
}

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
  /** 讲解节拍；老课程没有这个字段，仍按整段 narration 逐句念 */
  beats?: LectureBeat[];
  /** kind='quiz' 时的题目 */
  questions?: LectureQuizQuestion[];
  /** kind='lab' 时的代码实验（2026-10-26 第三步） */
  lab?: { lang?: string; code: string; hints?: string[]; expected?: string };
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
  /** 系统设置的默认 Edge 音色（短名，如「晓晓」） */
  edgeDefault?: string;
  speed: number;
}

interface Props {
  lecture: Lecture;
  /** teacher：可以跳到编辑器改这一页；student：只读 */
  audience?: 'teacher' | 'student';
  onClose: () => void;
  onEditPage?: (index: number) => void;
  /** 上一门 / 下一门微课程（按当前列表顺序）；不传 = 没有相邻课程，上下键无动作 */
  onPrevLecture?: () => void;
  onNextLecture?: () => void;
  /** 当前是第几门 / 共几门（顶栏显示，也用来确认上下键确实换了课程） */
  courseIndex?: number;
  courseTotal?: number;
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
  quiz: '检测',
  lab: '实验',
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
export const LecturePlayer: React.FC<Props> = ({ lecture, audience = 'teacher', onClose, onEditPage, onPrevLecture, onNextLecture, courseIndex, courseTotal }) => {
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

  /**
   * 切课程（↑↓ / 从列表点另一门）要把播放进度归零。
   * ⛔ 这里**必须在渲染期间同步重置**：播放器是同一个组件实例被复用（只换 lecture 这个 prop），
   *    用 useEffect 重置就晚了一拍 —— 这次渲染已经拿旧 pageIdx 取到新课程的同一页码并开始朗读，
   *    表现为「切过去不是第一页，而是上一篇看到的那一页」。
   *    这是 React 官方的「props 变化时在渲染中调整 state」写法，会在提交前立刻重渲染。
   */
  const prevLectureIdRef = useRef(lecture.id);
  if (prevLectureIdRef.current !== lecture.id) {
    prevLectureIdRef.current = lecture.id;
    setPageIdx(0);
    setSentenceIdx(0);
    setRevealed(false);
    setPlaying(true);
  }

  const page = pages[pageIdx];
  // 有 beats 就按节拍念（一句一动作），没有就用老办法把整段 narration 切句
  const sentences = useMemo(() => {
    const beats = page?.beats;
    if (Array.isArray(beats) && beats.length) {
      return beats.map((b) => String(b?.say || '').trim());
    }
    return splitSentences(page?.narration || '');
  }, [page]);

  /** 当前这句要强调的元素；没有 beats 就返回空串（不做高亮，与旧版表现一致） */
  const focusKey = useMemo(() => {
    const beats = page?.beats;
    if (!Array.isArray(beats) || !beats.length) return '';
    return String(beats[sentenceIdx]?.focus || '');
  }, [page, sentenceIdx]);
  const isLastPage = pageIdx >= pages.length - 1;

  const tokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCacheRef = useRef<Map<string, Blob>>(new Map());
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  /** 本课内一旦某级引擎失败就锁定降级，避免每句都先去试一遍再失败（每句白等 200~500ms） */
  const engineLockRef = useRef<TtsEngine | null>(null);
  const nextTimerRef = useRef<number | null>(null);
  /**
   * 上一次 speechSynthesis.cancel() 的时间戳。
   * ⛔ Chromium 有个老 bug：cancel() 之后**在同一轮事件循环里**立刻 speak()，
   *    新 utterance 会被静默丢掉 —— 既不触发 onend 也不触发 onerror，
   *    表现就是「讲完一句就再也不出声」（2026-10-26 吴老报的「第一页只讲一句就终止」）。
   *    所以凡是 cancel 过，下一次 speak 都要让出事件循环再发。
   */
  const lastCancelRef = useRef(0);
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
      preferEdge: ttsConfig?.edgeDefault || normalizeNameList(ttsConfig?.edgeFavorites)[0] || '晓晓',
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
    lastCancelRef.current = Date.now();
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

  // 换课程：掐掉上一篇还在播的音频，清掉按句子缓存的 mp3 与引擎降级锁
  //（页面内容已经换了，旧缓存再也命中不了，留着只是占内存）
  useEffect(() => {
    stopAll();
    blobCacheRef.current.clear();
    engineLockRef.current = null;
    setDegraded(null);
  }, [lecture.id, stopAll]);

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
    /** 这一句是否已经播完（自然结束）。cleanup 靠它决定要不要 cancel */
    let ended = false;
    /** 被静默丢弃后是否已补读过一次，避免无限重试 */
    let retried = false;
    let watchdogTimer: number | null = null;

    const advance = () => {
      ended = true;
      if (cancelled || token !== tokenRef.current) return;
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
      if (sentenceIdx < sentences.length - 1) {
        setSentenceIdx(sentenceIdx + 1);
        return;
      }
      // 本页讲完：example 页自动揭晓答案，再按设置翻下一页
      setRevealed(true);
      // 检测页：讲完就停下等作答，绝不自动翻页（否则学生还没答就跳走了）
      if (page?.kind === 'quiz') { setPlaying(false); return; }
      if (isLastPage) { markDone(); setPlaying(false); return; }
      if (!autoNext) { setPlaying(false); return; }
      nextTimerRef.current = window.setTimeout(() => {
        nextTimerRef.current = null;
        goPage(pageIdx + 1);
      }, 900);
    };

    /** cancel 之后要等一会儿再 speak，否则新 utterance 会被浏览器吞掉 */
    const settleCancel = async () => {
      const since = Date.now() - lastCancelRef.current;
      const wait = 140 - since;
      if (wait > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, wait));
    };

    const speakLocal = () => {
      const syn = window.speechSynthesis;
      if (!syn) { advance(); return; }
      const u = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) u.voice = voiceRef.current;
      u.lang = 'zh-CN';
      u.rate = rate;
      u.onend = () => { if (!cancelled && token === tokenRef.current) advance(); };
      u.onerror = () => { if (!cancelled && token === tokenRef.current) window.setTimeout(advance, 1500); };
      settleCancel().then(() => {
        if (cancelled || token !== tokenRef.current) return;
        syn.speak(u);
        armWatchdog();
      });
    };

    /**
     * 看门狗：Chromium 偶尔既不 onend 也不 onerror（utterance 被吞），
     * 界面就永远停在这一句上。这里 1 秒后确认引擎真没在发声 → 补读一次；还不行就跳下一句，
     * 宁可漏一句也不能让整节课卡在第一页。
     */
    const armWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = window.setTimeout(() => {
        watchdogTimer = null;
        if (cancelled || token !== tokenRef.current || ended) return;
        const syn = window.speechSynthesis;
        if (syn && (syn.speaking || syn.pending)) return;
        if (!retried) {
          retried = true;
          void speakCurrent();
          return;
        }
        advance();
      }, 1000);
    };

    const speakCurrent = async () => {
      if (cancelled || token !== tokenRef.current) return;
      let engine: TtsEngine = engineLockRef.current || picked.engine;
      await settleCancel();
      if (cancelled || token !== tokenRef.current) return;

      // ① Edge 在线自然音色（Azure 神经网络，免费、无额度）
      if (engine === 'edge') {
        const v = findVoiceByName(sysVoices.edge, picked.id) || pickEdgeVoice(sysVoices.edge);
        if (v) {
          armWatchdog();
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
        armWatchdog();
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
    };

    void speakCurrent();

    return () => {
      cancelled = true;
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
      // ⛔ 只有「还没讲完就被打断」才需要 cancel。自然播完还 cancel，
      //    会把紧接着的下一句一起掐掉（这正是「只讲一句就终止」的第二个成因）。
      if (!ended) {
        lastCancelRef.current = Date.now();
        window.speechSynthesis?.cancel();
        try { audioRef.current?.pause(); } catch { /* ignore */ }
      }
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

  // 键盘：空格暂停 / 左右翻页 / 上下切课程 / Esc 退出
  // ⛔ 上下键不绑翻页：翻页已有左右键，上下键留给「上一门 / 下一门」，投屏连着讲好几节课才顺。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); return; }
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goPage(pageIdx + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goPage(pageIdx - 1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); onNextLecture?.(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); onPrevLecture?.(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPage, pageIdx, onClose, onPrevLecture, onNextLecture]);

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
          {courseIndex && courseTotal ? (
            <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500" title="↑ 上一门 / ↓ 下一门">
              第 {courseIndex} / {courseTotal} 门
            </span>
          ) : null}
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
            {/* key 用页序号：换页时重挂载，检测页的作答状态必须清空 */}
            <PageBody
              key={pageIdx}
              page={page}
              revealed={revealed}
              onReveal={() => setRevealed(true)}
              focus={focusKey}
              runToken={page?.beats?.[sentenceIdx]?.run ? `${pageIdx}-${sentenceIdx}` : ''}
              onNext={() => goPage(pageIdx + 1)}
            />
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
          {(onPrevLecture || onNextLecture) && (
            <div className="ml-1 flex items-center gap-0.5 rounded-lg border border-gray-300 px-0.5 py-0.5" title="切换课程：↑ 上一门 / ↓ 下一门">
              <button
                onClick={onPrevLecture}
                disabled={!onPrevLecture}
                className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                title="上一门课程（↑）"
              >
                <i className="fa-solid fa-angles-up"></i>
              </button>
              <span className="text-[11px] text-gray-400">课程</span>
              <button
                onClick={onNextLecture}
                disabled={!onNextLecture}
                className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                title="下一门课程（↓）"
              >
                <i className="fa-solid fa-angles-down"></i>
              </button>
            </div>
          )}
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

const OPT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * 检测页（2026-10-26）：讲完一节就停下来考一下，答完才继续。
 * 题目来自题库（题干/选项/答案/解析都由服务端取），学生点选项立即判对错 —— 不留到课后。
 * ⛔ 全部答完才出现「继续学习」，中途不让人溜过去。
 */
const QuizPanel: React.FC<{ page: LecturePage; onNext?: () => void }> = ({ page, onNext }) => {
  const qs = page.questions || [];
  const [picked, setPicked] = useState<Record<number, string>>({});
  const answeredCount = Object.keys(picked).length;
  const allAnswered = qs.length > 0 && answeredCount === qs.length;
  const rightCount = qs.reduce(
    (n, q, i) => n + (picked[i] && String(picked[i]).toUpperCase() === String(q.answer || '').toUpperCase() ? 1 : 0),
    0,
  );

  if (!qs.length) {
    return <p className="pt-8 text-center text-[1.1em] text-gray-400">这一页没有题目</p>;
  }

  return (
    <div className="space-y-4 pt-2">
      {qs.map((q, qi) => {
        const mine = picked[qi];
        const rightLetter = String(q.answer || '').toUpperCase();
        const isRight = !!mine && String(mine).toUpperCase() === rightLetter;
        return (
          <div key={q.id || qi} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-white">{qi + 1}</span>
              <p className="text-[1.2em] leading-relaxed text-gray-900">{q.stem}</p>
            </div>
            <div className="mt-3 space-y-2 pl-10">
              {(q.options || []).map((opt, oi) => {
                const letter = OPT_LETTERS[oi];
                const on = mine === letter;
                const showRight = !!mine && letter === rightLetter;
                return (
                  <button
                    key={oi}
                    onClick={() => { if (!mine) setPicked((prev) => ({ ...prev, [qi]: letter })); }}
                    disabled={!!mine}
                    className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-[1.05em] transition-colors ${
                      showRight
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                        : on
                          ? 'border-rose-400 bg-rose-50 text-rose-900'
                          : 'border-gray-200 hover:border-amber-300 hover:bg-amber-50'
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs ${showRight ? 'bg-emerald-500 text-white' : on ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      {letter}
                    </span>
                    <span className="min-w-0">{opt}</span>
                  </button>
                );
              })}
            </div>
            {mine && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-[1.05em] ${isRight ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
                <i className={`fa-solid ${isRight ? 'fa-circle-check' : 'fa-circle-xmark'} mr-1.5`}></i>
                {isRight ? '答对了' : `答错了，正确答案是 ${q.answer}`}
                {q.analysis && <p className="mt-1 leading-relaxed text-gray-700">{q.analysis}</p>}
              </div>
            )}
          </div>
        );
      })}

      {allAnswered && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[1.1em] text-amber-900">
            本节检测完成：答对 <span className="text-xl font-bold">{rightCount}</span> / {qs.length} 题
          </p>
          {onNext && (
            <button onClick={onNext} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">
              继续学习<i className="fa-solid fa-arrow-right ml-1.5"></i>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * 聚光灯：当前这句讲到的元素亮起，其余淡下去（2026-10-26）。
 * focus 为空（老课程没有 beats）时一律正常显示，与改动前完全一致。
 */
const spot = (focus: string | undefined, fid: string) => {
  if (!focus || focus === '*') return 'transition-all duration-500';
  return focus === fid
    ? 'rounded-xl ring-4 ring-violet-400/70 ring-offset-2 transition-all duration-500'
    : 'opacity-25 transition-all duration-500';
};

/** 8 种页型渲染 */

/**
 * 代码实验页（2026-10-26 第三步）。
 *
 * 左边代码可以直接改，右边看运行结果；讲到「跑起来」那句会自动执行一次（beat.run）。
 * ⛔ 执行复用 /api/python/run（和 Python 作业同一个沙盒），不另写一套执行逻辑。
 * ⛔ 运行失败要原样显示报错：这是实验，学生改错了就该看到错误信息，不要吞掉。
 */
const LabPanel: React.FC<{ page: LecturePage; focus?: string; runToken?: string }> = ({ page, focus, runToken }) => {
  const lab = page.lab;
  const [code, setCode] = useState(lab ? lab.code : '');
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');

  const run = useCallback(async () => {
    const src = code;
    if (!src.trim()) return;
    setRunning(true);
    setErr('');
    try {
      const res = await fetch('/api/python/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ code: src }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `运行失败（${res.status}）`);
      const d = (json && json.data) || {};
      setOut({ ok: !!d.success, text: d.success ? (d.output || '（这段代码没有输出）') : (d.error || '运行出错') });
    } catch (e) {
      setErr((e as Error).message || '运行失败');
    } finally {
      setRunning(false);
    }
  }, [code]);

  // 讲稿推到「跑起来」那句时自动跑一次；用 ref 避免把 run 放进依赖导致反复触发
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (runToken) void runRef.current();
  }, [runToken]);

  if (!lab) {
    return <p className="pt-8 text-center text-[1.1em] text-gray-400">这一页没有可运行的代码</p>;
  }

  return (
    <div className="flex h-[21rem] gap-3 pt-2">
      <div className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 ${spot(focus, 'code')}`}>
        <div className="flex items-center justify-between border-b border-slate-700 px-3 py-1.5">
          <span className="text-xs uppercase tracking-wide text-slate-400">{lab.lang || 'python'}</span>
          <button
            onClick={() => void run()}
            disabled={running}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {running ? <><i className="fa-solid fa-spinner fa-spin mr-1"></i>运行中</> : <><i className="fa-solid fa-play mr-1"></i>运行</>}
          </button>
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-slate-900 px-4 py-3 font-mono text-[1.05em] leading-relaxed text-slate-100 outline-none"
        />
      </div>

      <div className={`flex w-[17rem] shrink-0 flex-col overflow-hidden rounded-xl border bg-white ${out && !out.ok ? 'border-rose-300' : 'border-gray-200'} ${spot(focus, 'output')}`}>
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-1.5">
          <span className="text-xs font-medium text-gray-500">运行结果</span>
          {out && (
            <span className={`text-[11px] ${out.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
              {out.ok ? '成功' : '有错误'}
            </span>
          )}
        </div>
        <pre className={`min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[0.95em] leading-relaxed ${out && !out.ok ? 'text-rose-700' : 'text-gray-800'}`}>
          {out ? out.text : (lab.expected ? `这段代码应当输出：${lab.expected}` : '点「运行」看看结果')}
        </pre>
        {err && <p className="border-t border-rose-200 px-3 py-1.5 text-xs text-rose-700">{err}</p>}
        {(lab.hints || []).length > 0 && (
          <div className="border-t border-gray-200 bg-amber-50/70 px-3 py-2">
            {(lab.hints || []).map((h, i) => (
              <p key={i} className="text-[0.95em] leading-relaxed text-amber-900">
                <i className="fa-solid fa-lightbulb mr-1.5 text-amber-500"></i>{h}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const PageBody: React.FC<{
  page: LecturePage;
  revealed: boolean;
  onReveal: () => void;
  /** 当前节拍要强调的元素（'bullet:0' / 'flow' / 'table:row:1' …） */
  focus?: string;
  /** 检测页答完后「继续学习」 */
  onNext?: () => void;
  /** 讲解到「跑起来」那句时传一个变化的值，lab 页据此自动执行 */
  runToken?: string;
}> = ({ page, revealed, onReveal, focus, onNext, runToken }) => {
  if (page.kind === 'quiz') {
    return <QuizPanel page={page} onNext={onNext} />;
  }

  if (page.kind === 'lab') {
    return <LabPanel page={page} focus={focus} runToken={runToken} />;
  }

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
          <div key={i} className={`flex items-start gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm ${spot(focus, `bullet:${i}`)}`}>
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
        <div className={`rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm ${spot(focus, 'flow')}`}>
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
              <div className={`flex-1 rounded-xl border border-violet-200 bg-white px-4 py-5 shadow-sm ${spot(focus, `step:${i}`)}`}>
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
              <tr key={ri} className={`${ri % 2 ? 'bg-gray-50' : 'bg-white'} ${spot(focus && focus !== 'table' ? focus : '', `table:row:${ri}`)}`}>
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
        <div className={`flex h-[22rem] items-end justify-around gap-6 rounded-xl border border-gray-200 bg-white px-8 py-6 shadow-sm ${spot(focus, 'chart')}`}>
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
        <div className={`overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-sm ${spot(focus, 'code')}`}>
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
        <div className={`rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm ${spot(focus, 'scenario')}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">情景</p>
          <p className="mt-1 text-[1.3em] leading-relaxed text-gray-800">{page.scenario}</p>
        </div>
      )}
      {page.question && (
        <div className={`rounded-xl border border-violet-200 bg-violet-50 px-5 py-4 ${spot(focus, 'question')}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-violet-500">想一想</p>
          <p className="mt-1 text-[1.3em] font-semibold leading-relaxed text-violet-900">{page.question}</p>
        </div>
      )}
      {page.answer && (
        revealed ? (
          <div className={`rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 ${spot(focus, 'answer')}`}>
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
