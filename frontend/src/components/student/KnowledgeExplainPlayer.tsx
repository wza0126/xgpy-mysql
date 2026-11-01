import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { authHeaders } from '../../utils/authToken';
import {
  buildVoiceChoices,
  parseChoice,
  pickDefaultChoice,
  speakUtterance,
  splitVoices,
  listZhVoices,
  normalizeNameList,
  type TtsEngine,
  type VoiceChoice,
  type XfyunVoice,
} from '../../utils/ttsEngine';

/**
 * 知识点 · AI 语音讲解（学生端全屏）
 *
 * 与「编程填空 AI 讲解」的区别（结构不同，讲法必须不同）：
 *   填空是「一空一步」，有唯一正确答案，重点是把答案填进代码里；
 *   知识点是一段有结构的讲义，重点是把这节内容**讲成一节课**：
 *     导入 → 若干要点（板书）→ 易错点 → 考点 → 一句话记住 → 随堂一问。
 *
 * 两个模式（吴老的场景：高一讲新课 / 高二复习）：
 *   · 新课：讲例子、讲推导，一句一句铺开，最后随堂一问；
 *   · 复习：跳过例子和随堂问，只过「要点标题 + 板书要点 + 易错 + 考点 + 口诀」，两三分钟过完一节。
 *   同一份脚本切两种节奏，不额外生成，老师课前核对一次两处都能用。
 *
 * ⛔ 必须 portal 到 document.body：桌面端窗口带 transform，全屏层会被任务栏压住。
 * ⛔ 讲稿内容是 AI 生成的：界面上要标明「AI 生成」，老师投屏前应自己听一遍。
 */

const VOICE_KEY = 'xgpy_kp_voice';
const FONT_KEY = 'xgpy_kp_font';
const RATE_KEY = 'xgpy_kp_rate';
const MODE_KEY = 'xgpy_kp_mode';

const readNum = (key: string, fallback: number) => {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export interface KnowledgeScript {
  intro: { hook: string; say: string };
  objectives: string[];
  points: { title: string; key: string; say: string; example: string }[];
  pitfalls: { what: string; say: string; how: string }[];
  exam: string;
  mnemonic: string;
  quiz: { q: string; options: string[]; answer: string; why: string }[];
}

interface Props {
  chapter: string;
  section: string;
  code?: string;
  questionCount?: number;
  onClose: () => void;
  audience?: 'student' | 'teacher';
}

interface TtsConfig {
  configured: boolean;
  voices: { id: string; name: string; group?: string; note?: string }[];
  voice: string;
  favorites?: string[];
  edgeFavorites?: string[];
  edgeDefault?: string;
  speed: number;
}

type Mode = 'new' | 'review';

type Step =
  | { kind: 'intro' }
  | { kind: 'point'; idx: number }
  | { kind: 'pitfall'; idx: number }
  | { kind: 'exam' }
  | { kind: 'mnemonic' }
  | { kind: 'quiz'; idx: number };

const LETTERS = 'ABCD';

function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[。！？；!?;])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 朗读前的符号规整。
 * ⛔ 只处理知识点讲稿里真会出现的几种（箭头、比较号、圈号），不要去做通用的数学式翻译 ——
 *    猜错比读错更糟（例如 "输入/机内码" 里的斜杠不能一律读成"或"）。
 */
function speechify(text: string): string {
  return String(text || '')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
    .replace(/→/g, ' 到 ')
    .replace(/←/g, ' 来自 ')
    .replace(/≤/g, ' 小于等于 ')
    .replace(/≥/g, ' 大于等于 ')
    .replace(/</g, ' 小于 ')
    .replace(/>/g, ' 大于 ')
    .replace(/＝/g, ' 等于 ')
    .replace(/[·•]/g, '、')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 把一条讲解拼成可以逐句朗读的话 */
function buildNarration(step: Step, s: KnowledgeScript, mode: Mode, picks: Record<number, string>): string {
  switch (step.kind) {
    case 'intro': {
      const obj = s.objectives.length
        ? `这一节要解决 ${s.objectives.length} 个问题：${s.objectives.join('；')}。`
        : '';
      return `${s.intro.hook}。${s.intro.say}${obj}`;
    }
    case 'point': {
      const p = s.points[step.idx];
      if (!p) return '';
      if (mode === 'review') {
        return `${p.title}。${p.key || p.say}`;
      }
      const ex = p.example ? `举个例子：${p.example}。` : '';
      const kk = p.key ? `板书上记这一句：${p.key}。` : '';
      return `${p.title}。${p.say}${ex}${kk}`;
    }
    case 'pitfall': {
      const p = s.pitfalls[step.idx];
      if (!p) return '';
      return `这里有个坑：${p.what}。${p.say}${p.how ? `正确做法是，${p.how}。` : ''}`;
    }
    case 'exam':
      return `学测会怎么考。${s.exam || '这一节以概念辨析为主。'}`;
    case 'mnemonic':
      return s.mnemonic ? `最后，用一句话把它记住：${s.mnemonic}` : '这一节就讲到这里。';
    case 'quiz': {
      const q = s.quiz[step.idx];
      if (!q) return '';
      const picked = picks[step.idx];
      if (!picked) {
        const opts = q.options.map((o, i) => `${LETTERS[i]}，${o}`).join('；');
        return `先做一道随堂小问。${q.q}。${opts}。想好了再选。`;
      }
      const ok = picked === q.answer;
      return `${ok ? '选对了' : `这道应该选 ${q.answer}`}。${q.why}`;
    }
    default:
      return '';
  }
}

export const KnowledgeExplainPlayer: React.FC<Props> = ({
  chapter, section, code, questionCount, onClose, audience = 'student',
}) => {
  const apiBase = audience === 'teacher' ? '/api/teacher' : '/api/student';

  const [script, setScript] = useState<KnowledgeScript | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [degraded, setDegraded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === 'review' ? 'review' : 'new'));
  const [stepIdx, setStepIdx] = useState(0);
  const [sentenceIdx, setSentenceIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [rate, setRate] = useState(() => readNum(RATE_KEY, 0.85));
  const [fontScale, setFontScale] = useState(() => readNum(FONT_KEY, 1));

  const [ttsConfig, setTtsConfig] = useState<TtsConfig | null>(null);
  const [voice, setVoice] = useState('');
  const [choice, setChoice] = useState('');
  const [voiceChoices, setVoiceChoices] = useState<VoiceChoice[]>([]);
  const [sysVoices, setSysVoices] = useState<{ edge: SpeechSynthesisVoice[]; local: SpeechSynthesisVoice[] }>({ edge: [], local: [] });

  /** 左侧板书滚动容器：讲到哪一块就把它滚到可视区（板书会越讲越长） */
  const boardRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCacheRef = useRef<Map<string, Blob>>(new Map());
  const engineLockRef = useRef<TtsEngine | null>(null);
  const nextTimerRef = useRef<number | null>(null);

  // ---------- 读脚本 ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadErr('');
      setElapsed(0);
      try {
        const res = await fetch(`${apiBase}/explain/knowledge`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ chapter_id: chapter, section }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error((json && json.error) || `生成讲解失败（${res.status}）`);
        if (!alive) return;
        setScript(json.data.script as KnowledgeScript);
        setDegraded(!!json.data.degraded);
      } catch (e) {
        if (alive) setLoadErr((e as Error).message || '生成讲解失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [chapter, section, apiBase]);

  // 生成可能要十几秒：给个计时，学生知道没卡死
  useEffect(() => {
    if (!loading) return;
    const t = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [loading]);

  // ---------- 语音配置 ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/explain/tts/config`, { headers: authHeaders() });
        const json = await res.json().catch(() => null);
        if (json?.data) {
          setTtsConfig(json.data as TtsConfig);
          setVoice(json.data.voice || 'xiaoyan');
        }
      } catch {
        setTtsConfig({ configured: false, voices: [], voice: '', speed: 50 });
      }
    })();
  }, [apiBase]);

  useEffect(() => {
    const load = () => {
      const { edge, local } = splitVoices(listZhVoices());
      setSysVoices({ edge, local });
    };
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
    return () => { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  useEffect(() => {
    const list = buildVoiceChoices(sysVoices.edge, (ttsConfig?.voices || []) as XfyunVoice[], sysVoices.local, {
      favoriteIds: ttsConfig?.favorites,
      edgeFavoriteIds: ttsConfig?.edgeFavorites,
      keepId: ttsConfig?.voice || voice,
    });
    setVoiceChoices(list);
    if (!sysVoices.edge.length && !ttsConfig) return;
    setChoice((prev) => pickDefaultChoice(list, prev || localStorage.getItem(VOICE_KEY) || '', {
      xfyunDefaultId: ttsConfig?.voice || voice,
      preferEdge: ttsConfig?.edgeDefault || normalizeNameList(ttsConfig?.edgeFavorites)[0] || '晓晓',
    }));
  }, [sysVoices, ttsConfig, voice]);

  useEffect(() => { if (choice) localStorage.setItem(VOICE_KEY, choice); }, [choice]);
  useEffect(() => { localStorage.setItem(FONT_KEY, String(fontScale)); }, [fontScale]);
  useEffect(() => { localStorage.setItem(RATE_KEY, String(rate)); }, [rate]);
  useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);

  const picked = useMemo(() => parseChoice(choice), [choice]);
  const cloudReady = !!ttsConfig?.configured;
  const xfyunVcn = picked.engine === 'xfyun' ? picked.id : voice;
  const edgeVoice = picked.engine === 'edge' ? (sysVoices.edge.find((v) => v.name === picked.id) || null) : null;
  const localVoice = sysVoices.local.find((v) => /Huihui|Yaoyao|Kangkang/i.test(v.name)) || sysVoices.local[0] || null;

  // ---------- 步骤 ----------
  const steps: Step[] = useMemo(() => {
    if (!script) return [];
    const base: Step[] = [{ kind: 'intro' }];
    script.points.forEach((_, i) => base.push({ kind: 'point', idx: i }));
    script.pitfalls.forEach((_, i) => base.push({ kind: 'pitfall', idx: i }));
    if (script.exam) base.push({ kind: 'exam' });
    if (script.mnemonic) base.push({ kind: 'mnemonic' });
    // 复习模式不出随堂问：课上没时间互动，而且复习要的是"过一遍"
    if (mode === 'new') script.quiz.forEach((_, i) => base.push({ kind: 'quiz', idx: i }));
    return base;
  }, [script, mode]);

  const step: Step | undefined = steps[Math.min(stepIdx, Math.max(steps.length - 1, 0))];

  const narration = useMemo(
    () => (script && step ? buildNarration(step, script, mode, picks) : ''),
    [script, step, mode, picks],
  );
  const sentences = useMemo(() => splitSentences(narration), [narration]);

  const stopAll = useCallback(() => {
    tokenRef.current += 1;
    window.speechSynthesis?.cancel();
    try { audioRef.current?.pause(); } catch { /* ignore */ }
    if (nextTimerRef.current) { clearTimeout(nextTimerRef.current); nextTimerRef.current = null; }
  }, []);

  const goStep = useCallback((next: number) => {
    if (next < 0 || next >= steps.length) return;
    stopAll();
    setStepIdx(next);
    setSentenceIdx(0);
    setPlaying(true);
  }, [steps.length, stopAll]);

  const getBlob = useCallback(async (text: string): Promise<Blob> => {
    const key = `${xfyunVcn}|${text}`;
    const hit = blobCacheRef.current.get(key);
    if (hit) return hit;
    const res = await fetch(`${apiBase}/explain/tts`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text, voice: xfyunVcn || undefined, speed: Math.round(50 * rate) }),
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

  // 逐句朗读；一句读完跳下一句，一步讲完自动进下一步
  useEffect(() => {
    if (!playing || !sentences.length || !step) return;
    const text = sentences[sentenceIdx];
    if (text == null) return;
    const spoken = speechify(text);
    const token = ++tokenRef.current;
    let cancelled = false;

    const advance = () => {
      if (cancelled || token !== tokenRef.current) return;
      if (sentenceIdx < sentences.length - 1) { setSentenceIdx(sentenceIdx + 1); return; }
      // 随堂问没作答：讲完题干就停住，等人点选项（这是唯一需要"人动"的步骤）
      if (step.kind === 'quiz' && !picks[step.idx]) { setPlaying(false); return; }
      if (stepIdx < steps.length - 1) {
        const waitMs = step.kind === 'intro' ? 1800 : 900;
        nextTimerRef.current = window.setTimeout(() => {
          if (!cancelled && token === tokenRef.current) goStep(stepIdx + 1);
        }, waitMs);
      } else {
        setPlaying(false);
      }
    };

    (async () => {
      if (edgeVoice) {
        try { await speakUtterance(spoken, edgeVoice, rate); advance(); return; } catch { engineLockRef.current = 'xfyun'; }
      }
      if (cloudReady && engineLockRef.current !== 'local') {
        try {
          const blob = await getBlob(spoken);
          if (cancelled || token !== tokenRef.current) return;
          await playBlob(blob);
          advance();
          return;
        } catch { engineLockRef.current = 'local'; }
      }
      if (cancelled || token !== tokenRef.current) return;
      try { await speakUtterance(spoken, localVoice, rate); advance(); } catch { advance(); }
    })();

    return () => {
      cancelled = true;
      window.speechSynthesis?.cancel();
      try { audioRef.current?.pause(); } catch { /* ignore */ }
    };
  }, [playing, stepIdx, sentenceIdx, sentences, steps.length, step, picks, edgeVoice, localVoice, cloudReady, rate, getBlob, playBlob, goStep]);

  // 预取下一句（讯飞有网络往返）
  useEffect(() => {
    if (!cloudReady || picked.engine !== 'xfyun') return;
    const next = sentences[sentenceIdx + 1];
    if (!next) return;
    const t = window.setTimeout(() => { getBlob(speechify(next)).catch(() => {}); }, 250);
    return () => window.clearTimeout(t);
  }, [cloudReady, picked, sentences, sentenceIdx, getBlob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); return; }
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); goStep(stepIdx + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goStep(stepIdx - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goStep, stepIdx, onClose]);

  useEffect(() => () => { stopAll(); }, [stopAll]);

  /**
   * 板书跟随：讲到的卡片滚到可视区中间。
   * ⛔ 不用 scrollIntoView：学习平台是桌面窗口内的应用，scrollIntoView 会连带滚外层窗口。
   *    这里只手动改板书容器自己的 scrollTop。
   */
  useEffect(() => {
    const box = boardRef.current;
    if (!box) return;
    const el = box.querySelector('[data-board-active="1"]') as HTMLElement | null;
    if (!el) return;
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const target = box.scrollTop + delta - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [stepIdx, mode, script]);

  // 切模式：回到开头重讲（两种模式的步骤序列完全不同，停在中间会错位）
  const changeMode = (m: Mode) => {
    if (m === mode) return;
    stopAll();
    setMode(m);
    setStepIdx(0);
    setSentenceIdx(0);
    setPicks({});
    setPlaying(true);
  };

  /** 某一步在步骤序列里的位置；-1 表示当前模式下没有这一步（板书据此决定显示与否） */
  const stepPos = useCallback((kind: Step['kind'], idx = -1) => {
    return steps.findIndex((s) => s.kind === kind && ((s as { idx?: number }).idx ?? -1) === idx);
  }, [steps]);

  const reached = (kind: Step['kind'], idx = -1) => {
    const pos = stepPos(kind, idx);
    return pos >= 0 && stepIdx >= pos;
  };

  const answerQuiz = (qIdx: number, letter: string) => {
    setPicks((prev) => (prev[qIdx] ? prev : { ...prev, [qIdx]: letter }));
    stopAll();
    setSentenceIdx(0);
    setPlaying(true);
  };

  const total = steps.length || 1;
  const cur = Math.min(stepIdx + 1, total);
  const quizStep = step && step.kind === 'quiz' ? script?.quiz[step.idx] : null;
  const quizPick = step && step.kind === 'quiz' ? picks[step.idx] : undefined;

  const body = (
    <div
      data-kp-player="1"
      className="fixed inset-0 z-[9999] flex flex-col bg-slate-950 text-slate-100"
      style={{ fontSize: `${fontScale}rem` }}
    >
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-full bg-sky-500 px-3 py-1 text-sm font-semibold text-slate-950">
            <i className="fa-solid fa-headphones mr-1.5"></i>AI 讲解 · 知识点
          </span>
          <span className="truncate text-base font-semibold" title={`${chapter} / ${section}`}>
            {code && <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-sky-300">{code}</span>}
            {section}
          </span>
          <span className="shrink-0 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
            第 {cur} / {total} 步
          </span>
          {degraded && (
            <span className="shrink-0 rounded bg-amber-900/60 px-2 py-0.5 text-xs text-amber-300" title="AI 暂时不可用，已改为按讲义原文朗读">
              基础朗读
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 新课 / 复习：同一份脚本切两种节奏，老师上课和考前复习各用各的 */}
          <div className="flex overflow-hidden rounded-lg border border-slate-700">
            {([['new', '新课'], ['review', '复习']] as [Mode, string][]).map(([m, label]) => (
              <button
                key={m}
                onClick={() => changeMode(m)}
                title={m === 'new' ? '上新课时用：有例子、有随堂问' : '复习时用：只过要点、易错、考点、口诀'}
                className={`px-2.5 py-1 text-xs ${mode === m ? 'bg-sky-500 font-semibold text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {voiceChoices.length > 0 && (
            <select
              value={choice}
              onChange={(e) => { setChoice(e.target.value); engineLockRef.current = null; }}
              className="max-w-[9rem] rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
              title="发音人"
            >
              {Array.from(new Set(voiceChoices.map((c) => c.group))).map((g) => (
                <optgroup key={g} label={g}>
                  {voiceChoices.filter((c) => c.group === g).map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          <select
            value={String(rate)}
            onChange={(e) => setRate(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
            title="语速"
          >
            <option value="0.7">0.7×</option>
            <option value="0.85">0.85×</option>
            <option value="1">1.0×</option>
            <option value="1.15">1.15×</option>
            <option value="1.3">1.3×</option>
          </select>
          <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-1 py-0.5">
            <button
              onClick={() => setFontScale((v) => Math.max(0.8, +(v - 0.1).toFixed(2)))}
              className="px-1.5 text-xs text-slate-300 hover:text-white"
              title="缩小字号"
            >A-</button>
            <span className="text-[11px] text-slate-500">{Math.round(fontScale * 100)}%</span>
            <button
              onClick={() => setFontScale((v) => Math.min(2, +(v + 0.1).toFixed(2)))}
              className="px-1.5 text-sm text-slate-300 hover:text-white"
              title="放大字号（投屏用）"
            >A+</button>
          </div>
          <button onClick={onClose} className="rounded-lg px-2.5 py-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100" title="退出（Esc）">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
          <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
          <p className="text-base">AI 正在备课，把这一节讲成一节微课…</p>
          <p className="text-xs text-slate-500">第一次准备要十几秒，之后全校共用，再点秒开（已等 {elapsed} 秒）</p>
        </div>
      ) : loadErr ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <i className="fa-solid fa-circle-exclamation text-2xl text-rose-400"></i>
          <p className="text-rose-300">{loadErr}</p>
          <button onClick={onClose} className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">关闭</button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* 左：板书（像黑板一样一行行长出来） */}
          <div className="hidden min-w-0 flex-[0.9] flex-col border-r border-slate-800 lg:flex">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-1.5 text-xs text-slate-400">
              <i className="fa-solid fa-chalkboard"></i>本节板书
              <span className="ml-auto text-slate-500">讲到哪里，黑板长到哪里</span>
            </div>
            <div ref={boardRef} className="min-h-0 flex-1 space-y-2 overflow-auto px-4 py-4">
              {script?.objectives.length ? (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2">
                  <p className="mb-1 text-[11px] font-semibold tracking-wide text-sky-300">学习目标</p>
                  {script.objectives.map((o, i) => (
                    <p key={i} className="text-[0.86em] leading-6 text-slate-200">
                      <span className="mr-1 text-sky-400">{i + 1}.</span>{o}
                    </p>
                  ))}
                </div>
              ) : null}

              {script?.points.map((p, i) => {
                const on = reached('point', i);
                const active = step?.kind === 'point' && step.idx === i;
                // 没讲到的要点也先露出标题（淡显），板书一开始就是一张完整的课的地图；
                // 讲过之后才把 board 要点展开 —— 这比逐条"从无到有"更能让学生知道还剩多少。
                return (
                  <div
                    key={`p-${i}`}
                    data-board-active={active ? '1' : undefined}
                    className={`rounded-xl border px-3 py-2 transition-colors ${
                      active
                        ? 'border-sky-400/70 bg-sky-500/15'
                        : on
                          ? 'border-slate-700/60 bg-slate-900/60'
                          : 'border-slate-800/60 bg-slate-900/30'
                    }`}
                  >
                    <p className={`flex items-center gap-1.5 text-[0.92em] font-semibold ${on ? 'text-slate-100' : 'text-slate-500'}`}>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                        active ? 'bg-sky-400 text-slate-950' : on ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-500'
                      }`}>{i + 1}</span>
                      {p.title}
                    </p>
                    {on && p.key && <p className="mt-1 text-[0.84em] leading-6 text-slate-300">{p.key}</p>}
                  </div>
                );
              })}

              {script?.pitfalls.map((p, i) => {
                if (!reached('pitfall', i)) return null;
                const active = step?.kind === 'pitfall' && step.idx === i;
                return (
                  <div key={`f-${i}`} data-board-active={active ? '1' : undefined} className={`rounded-xl border px-3 py-2 ${
                    active ? 'border-rose-400/70 bg-rose-500/15' : 'border-rose-500/25 bg-rose-500/5'
                  }`}>
                    <p className="text-[0.9em] font-semibold text-rose-200">
                      <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>{p.what || `易错点 ${i + 1}`}
                    </p>
                    {p.how && <p className="mt-1 text-[0.82em] leading-6 text-slate-300">{p.how}</p>}
                  </div>
                );
              })}

              {reached('exam') && script?.exam && (
                <div data-board-active={step?.kind === 'exam' ? '1' : undefined} className={`rounded-xl border px-3 py-2 ${
                  step?.kind === 'exam' ? 'border-violet-400/70 bg-violet-500/15' : 'border-violet-500/25 bg-violet-500/5'
                }`}>
                  <p className="text-[0.9em] font-semibold text-violet-200">
                    <i className="fa-solid fa-bullseye mr-1.5"></i>学测怎么考
                  </p>
                  <p className="mt-1 text-[0.82em] leading-6 text-slate-300">{script.exam}</p>
                </div>
              )}

              {reached('mnemonic') && script?.mnemonic && (
                <div data-board-active={step?.kind === 'mnemonic' ? '1' : undefined} className="rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2">
                  <p className="text-[11px] font-semibold tracking-wide text-amber-300">一句话记住</p>
                  <p className="mt-1 text-[0.95em] font-semibold leading-7 text-amber-100">{script.mnemonic}</p>
                </div>
              )}
            </div>
          </div>

          {/* 右：讲解 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-1.5 text-xs text-slate-400">
              <span>
                <i className="fa-solid fa-chalkboard-user mr-1"></i>
                {step?.kind === 'intro' ? '导入' :
                 step?.kind === 'point' ? `要点 ${step.idx + 1} / ${script?.points.length}` :
                 step?.kind === 'pitfall' ? `易错 ${step.idx + 1} / ${script?.pitfalls.length}` :
                 step?.kind === 'exam' ? '考点' :
                 step?.kind === 'mnemonic' ? '记住它' : '随堂一问'}
              </span>
              <span className="text-slate-500">
                {mode === 'new' ? '新课模式' : '复习模式'}
                {questionCount ? ` · 本节题库 ${questionCount} 题` : ''}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
              {step?.kind === 'intro' && script && (
                <div>
                  <p className="text-[1.7em] font-bold leading-tight text-sky-200">{script.intro.hook}</p>
                  <p className="mt-4 text-[1.05em] leading-9 text-slate-200">{script.intro.say}</p>
                  {script.objectives.length > 0 && (
                    <div className="mt-6 space-y-1.5">
                      <p className="text-xs tracking-wide text-slate-500">这一节要解决</p>
                      {script.objectives.map((o, i) => (
                        <p key={i} className="flex items-start gap-2 text-[0.95em] leading-7 text-slate-300">
                          <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[11px] font-bold text-sky-300">{i + 1}</span>
                          {o}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {step?.kind === 'point' && script && (() => {
                const p = script.points[step.idx];
                if (!p) return null;
                return (
                  <div>
                    <p className="text-[1.6em] font-bold leading-tight text-slate-50">{p.title}</p>
                    {p.key && (
                      <p className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-[1.08em] font-semibold leading-8 text-sky-100">
                        {p.key}
                      </p>
                    )}
                    <p className="mt-5 text-[1.02em] leading-9 text-slate-200">{p.say}</p>
                    {p.example && mode === 'new' && (
                      <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
                        <p className="text-xs font-medium text-emerald-400"><i className="fa-solid fa-lightbulb mr-1"></i>例子</p>
                        <p className="mt-0.5 text-[0.95em] leading-7 text-emerald-100">{p.example}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {step?.kind === 'pitfall' && script && (() => {
                const p = script.pitfalls[step.idx];
                if (!p) return null;
                return (
                  <div>
                    <p className="text-[1.4em] font-bold leading-tight text-rose-200">
                      <i className="fa-solid fa-triangle-exclamation mr-2 text-[0.9em]"></i>{p.what}
                    </p>
                    <p className="mt-4 text-[1.02em] leading-9 text-slate-200">{p.say}</p>
                    {p.how && (
                      <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
                        <p className="text-xs font-medium text-emerald-400"><i className="fa-solid fa-check mr-1"></i>正确做法</p>
                        <p className="mt-0.5 text-[0.95em] leading-7 text-emerald-100">{p.how}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {step?.kind === 'exam' && script && (
                <div>
                  <p className="text-[1.4em] font-bold text-violet-200">
                    <i className="fa-solid fa-bullseye mr-2 text-[0.9em]"></i>学测会怎么考
                  </p>
                  <p className="mt-4 text-[1.02em] leading-9 text-slate-200">{script.exam}</p>
                  {(questionCount || 0) > 0 && (
                    <p className="mt-5 text-xs text-slate-500">
                      本节题库共 {questionCount} 道练习题，听完可以点标题旁的「去练习」直接练这一节。
                    </p>
                  )}
                </div>
              )}

              {step?.kind === 'mnemonic' && script && (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <p className="text-xs tracking-[0.3em] text-amber-400">一句话记住</p>
                  <p className="mt-4 text-[1.6em] font-bold leading-relaxed text-amber-200">{script.mnemonic || '这一节就讲到这里。'}</p>
                </div>
              )}

              {step?.kind === 'quiz' && quizStep && (
                <div>
                  <p className="text-xs tracking-wide text-slate-500">随堂一问 · 点一个选项</p>
                  <p className="mt-2 text-[1.15em] font-semibold leading-8 text-slate-100">{quizStep.q}</p>
                  <div className="mt-4 space-y-2">
                    {quizStep.options.map((o, i) => {
                      const letter = LETTERS[i];
                      const isPick = quizPick === letter;
                      const isRight = quizStep.answer === letter;
                      const show = !!quizPick;
                      const cls = show
                        ? isRight
                          ? 'border-emerald-400/70 bg-emerald-500/15 text-emerald-100'
                          : isPick
                            ? 'border-rose-400/70 bg-rose-500/15 text-rose-100'
                            : 'border-slate-700 bg-slate-900/60 text-slate-500'
                        : 'border-slate-700 bg-slate-900/60 text-slate-200 hover:border-sky-400/60 hover:bg-slate-800';
                      return (
                        <button
                          key={i}
                          disabled={show}
                          onClick={() => answerQuiz(step.idx, letter)}
                          className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-[0.96em] leading-7 transition-colors ${cls} disabled:cursor-default`}
                        >
                          <span className="font-bold">{letter}</span>
                          <span className="flex-1">{o}</span>
                          {show && isRight && <i className="fa-solid fa-check mt-1.5 text-xs"></i>}
                          {show && isPick && !isRight && <i className="fa-solid fa-xmark mt-1.5 text-xs"></i>}
                        </button>
                      );
                    })}
                  </div>
                  {quizPick && quizStep.why && (
                    <p className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[0.9em] leading-7 text-slate-300">
                      <span className="text-slate-500">解析：</span>{quizStep.why}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 字幕 */}
            <div className="shrink-0 border-t border-slate-800 bg-slate-950/60 px-4 py-3">
              <p className="text-[0.92em] leading-7">
                {sentences.map((s, i) => (
                  <span key={i} className={i === sentenceIdx ? 'rounded bg-sky-400/25 px-0.5 font-medium text-sky-200' : i < sentenceIdx ? 'text-slate-600' : 'text-slate-400'}>
                    {s}
                  </span>
                ))}
                {!sentences.length && <span className="text-slate-600">（这一步没有讲解词）</span>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 控制栏 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-slate-800 bg-slate-900 px-5 py-2.5">
        <button
          onClick={() => goStep(stepIdx - 1)}
          disabled={stepIdx === 0}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
        >
          <i className="fa-solid fa-chevron-left mr-1"></i>上一步
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-400"
        >
          {playing ? <><i className="fa-solid fa-pause mr-1"></i>暂停</> : <><i className="fa-solid fa-play mr-1"></i>继续</>}
        </button>
        <button
          onClick={() => { stopAll(); setSentenceIdx(0); setPlaying(true); }}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          title="从这一步开头重讲"
        >
          <i className="fa-solid fa-rotate-left mr-1"></i>重讲
        </button>
        <button
          onClick={() => goStep(stepIdx + 1)}
          disabled={stepIdx >= steps.length - 1}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
        >
          下一步<i className="fa-solid fa-chevron-right ml-1"></i>
        </button>

        <div className="ml-3 flex items-center gap-1">
          {steps.map((s, i) => (
            <button
              key={i}
              onClick={() => goStep(i)}
              title={
                s.kind === 'intro' ? '导入' : s.kind === 'exam' ? '考点' : s.kind === 'mnemonic' ? '记住它'
                  : s.kind === 'quiz' ? `随堂一问 ${s.idx + 1}` : s.kind === 'point' ? `要点 ${s.idx + 1}` : `易错 ${s.idx + 1}`
              }
              className={`h-2 rounded-full transition-all ${i === stepIdx ? 'w-6 bg-sky-400' : 'w-2 bg-slate-700 hover:bg-slate-500'}`}
            />
          ))}
        </div>

        <span className="ml-auto text-xs text-slate-500">
          <i className="fa-solid fa-wand-magic-sparkles mr-1"></i>讲稿由 AI 生成，投屏前建议先听一遍
          <span className="mx-2 text-slate-700">|</span>空格暂停 · ←→ 上下步 · Esc 退出
        </span>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};

export default KnowledgeExplainPlayer;
