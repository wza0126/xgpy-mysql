import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_CONFIG } from '../../api/config';
import { authHeaders } from '../../utils/authToken';
import { sanitizeHtml } from '../../utils/htmlUtils';

export interface ExplainQuestion {
  id: string;
  type?: string;
  content: string;
  options?: unknown;
  answers?: unknown;
  explanation?: string | null;
  cluster_id?: string | null;
  wrong_count?: number;
  total_attempts?: number;
}

interface CompareOption {
  key: string;
  text: string;
  verdict: 'correct' | 'wrong';
  reason: string;
}

interface Scene {
  kind: 'point' | 'compare' | 'chart' | 'memory';
  title: string;
  narration: string;
  bullets?: string[];
  options?: CompareOption[];
  chart?: { unit?: string; items: { label: string; value: number }[] };
}

interface Script {
  topic: string;
  scenes: Scene[];
}

interface TtsConfig {
  configured: boolean;
  voices: { id: string; name: string; group?: string; note?: string }[];
  voice: string;
  speed: number;
  volume: number;
}

interface Props {
  questions: ExplainQuestion[];
  title?: string;
  /** 传入班级 ID 时，讲完一题自动打「已讲解」标记（仅教师端） */
  classId?: string;
  onClose: () => void;
  /**
   * 端点归属：
   *  - teacher（默认）：/api/teacher/explain/*（错题排行、试卷按题目查看）
   *  - student：/api/student/explain/*，只能听自己做错过的题，且需老师放开「讲解」开关
   */
  audience?: 'teacher' | 'student';
  /** 可选风格（学生端由 access 接口下发；教师端不传则组件自己拉） */
  styles?: ExplainStyleOption[];
  /**
   * 本批连播里因题型被跳过的说明，例如「已跳过 2 道综合题」。
   * 显示在顶栏，避免老师以为漏题（播放器是全屏的，外面的横幅被挡住看不到）。
   */
  skipNote?: string;
}

export interface ExplainStyleOption {
  style_key: string;
  name: string;
  summary?: string;
  max_chars?: number;
}

const FONT_KEY = 'xgpy_explain_font_scale';
const VOICE_KEY = 'xgpy_explain_voice';
// 上次见到的「系统设置里的默认发音人」：变了说明老师在别处改过，播放器要以新默认为准
const VOICE_DEFAULT_KEY = 'xgpy_explain_voice_default';
const GAP_KEY = 'xgpy_explain_gap_sec';
const STYLE_KEY = 'xgpy_explain_style';

/** 按中文标点切句，供逐句朗读 + 高亮 */
function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[。！？；!?;])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 去掉选项自带的「A.」「A、」前缀，避免和界面上的字母重复 */
function stripLetterPrefix(text: string): string {
  return String(text || '').replace(/^\s*(（?\s*[A-Ha-h]\s*）?\s*[.、．)）:：]\s*)/, '').trim();
}

/**
 * 解析 options 字段。
 * 题库里有三种存法：["A. xx","B. xx"] / {"options":[...]} / [[键, 值], ...]，都要吃得下。
 */
function parseOptions(raw: unknown): string[] {
  const unwrap = (v: any): string[] => {
    if (Array.isArray(v)) {
      return v
        .map((x) => {
          if (typeof x === 'string') return stripLetterPrefix(x);
          if (Array.isArray(x)) return x.filter((i) => i != null && i !== '').join(' ');
          if (x && typeof x === 'object') return stripLetterPrefix(String(x.text ?? x.content ?? x.label ?? x.value ?? ''));
          return String(x ?? '');
        })
        .filter(Boolean);
    }
    if (v && typeof v === 'object') {
      for (const k of ['options', 'items', 'choices', 'list']) {
        if (Array.isArray((v as any)[k])) return unwrap((v as any)[k]);
      }
    }
    return [];
  };
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return unwrap(v);
  } catch {
    return [];
  }
}

/**
 * 解析正确答案里的选项字母。
 * 兼容 ["A"] / {"answers":["A"]} / [{"answers":["A"]}] / "A,B" 等写法。
 */
function correctnessKeys(raw: unknown): Set<string> {
  const out = new Set<string>();
  const collect = (v: any) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if (typeof v === 'object') {
      ['answers', 'answer', 'correct', 'values'].forEach((k) => { if ((v as any)[k] != null) collect((v as any)[k]); });
      return;
    }
    String(v)
      .split(/[,\s、/|;；]+/)
      .forEach((piece) => {
        const letter = piece.trim().toUpperCase().replace(/^[（(]?([A-H])[）)]?[.、．)）]?.*$/, '$1');
        if (/^[A-H]$/.test(letter)) out.add(letter);
      });
  };
  try {
    collect(typeof raw === 'string' ? JSON.parse(raw || '[]') : raw);
  } catch {
    collect(raw);
  }
  return out;
}

/**
 * 取答案的纯文本（填空题用）。
 * 题库结构如 {"answers":["list.append(x)"]}，多空时数组会有多项，逐个取出来。
 */
function extractAnswerTexts(raw: unknown): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    const t = v.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  };
  const collect = (v: any) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if (typeof v === 'object') {
      ['answers', 'answer', 'correct', 'values'].forEach((k) => { if ((v as any)[k] != null) collect((v as any)[k]); });
      return;
    }
    push(String(v));
  };
  try {
    collect(typeof raw === 'string' ? JSON.parse(raw || '[]') : raw);
  } catch {
    collect(raw);
  }
  return Array.from(new Set(out));
}

/**
 * AI 语音讲解器（教师端投屏讲评）
 *
 * 语音优先级：讯飞云端（系统配置里填了密钥）→ 浏览器本机语音（Huihui）。云端失败自动回落。
 * 字号、音色都会记住，下次打开沿用。
 */
export const AiExplainPlayer: React.FC<Props> = ({
  questions,
  title = 'AI 语音讲解',
  classId,
  onClose,
  audience = 'teacher',
  styles,
  skipNote,
}) => {
  const apiBase = `${API_CONFIG.apiUrl}/api/${audience}/explain`;
  const [idx, setIdx] = useState(0);
  const [styleList, setStyleList] = useState<ExplainStyleOption[]>(styles || []);
  const [styleKey, setStyleKey] = useState<string>(() => {
    const saved = localStorage.getItem(STYLE_KEY) || '';
    if (styles && styles.length) {
      // 学生端风格由 access 接口下发：上次保存的风格若已被老师停用，直接用第一个
      return styles.some((s) => s.style_key === saved) ? saved : styles[0].style_key;
    }
    return saved;
  });
  const [script, setScript] = useState<Script | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [sentenceIdx, setSentenceIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [showSubtitle, setShowSubtitle] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [marked, setMarked] = useState(false);
  const [ttsConfig, setTtsConfig] = useState<TtsConfig | null>(null);
  const [voice, setVoice] = useState<string>(() => localStorage.getItem(VOICE_KEY) || '');
  // 题与题之间的停留秒数（默认 3 秒），让学生看完上一题再进下一题；同样记住设置
  const [gapSec, setGapSec] = useState<number>(() => {
    const v = Number(localStorage.getItem(GAP_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 20 ? v : 3;
  });
  const [gapLeft, setGapLeft] = useState(0);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gapTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [fontScale, setFontScale] = useState<number>(() => {
    const v = Number(localStorage.getItem(FONT_KEY));
    return v >= 0.8 && v <= 2 ? v : 1;
  });

  const current = questions[idx];
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCacheRef = useRef<Map<string, Blob>>(new Map());
  const tokenRef = useRef(0);
  const finishedRef = useRef<Set<string>>(new Set());

  useEffect(() => { localStorage.setItem(FONT_KEY, String(fontScale)); }, [fontScale]);
  useEffect(() => { if (voice) localStorage.setItem(VOICE_KEY, voice); }, [voice]);
  useEffect(() => { localStorage.setItem(GAP_KEY, String(gapSec)); }, [gapSec]);

  // 风格：学生端由父组件传入（access 接口已过滤停用项）；教师端自己拉启用列表。
  // ⚠️ 依赖用签名字符串而不是数组本身：父组件内联数组每次渲染都是新引用，直接依赖会无限重渲染。
  const stylesSig = styles ? styles.map((s) => `${s.style_key}:${s.name}`).join('|') : '';
  useEffect(() => {
    if (styles && styles.length) {
      setStyleList((prev) => (
        prev.length === styles.length && prev.every((p, i) => p.style_key === styles[i].style_key && p.name === styles[i].name)
          ? prev
          : styles
      ));
      return;
    }
    if (audience !== 'teacher') return;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/styles`, { headers: authHeaders() });
        const json = await res.json().catch(() => null);
        // ⛔ 排除「课堂讲授」（lecture）：它是 AI 讲堂的微课程专用风格，
        //    口吻是「我们来看一个新东西」这种上课话术，用在单题讲解里很怪。
        const list = (json?.data?.styles || [])
          .filter((s: any) => Number(s.enabled) !== 0 && s.style_key !== 'lecture');
        setStyleList(list.map((s: any) => ({
          style_key: s.style_key,
          name: s.name,
          summary: s.summary,
          max_chars: s.max_chars,
        })));
      } catch {
        setStyleList([]);
      }
    })();
  }, [stylesSig, audience, apiBase]);

  // 上次选的风格可能被老师停用/删除了 → 回落到列表第一个，避免请求一个不存在的风格
  useEffect(() => {
    if (!styleList.length) return;
    if (!styleList.some((s) => s.style_key === styleKey)) setStyleKey(styleList[0].style_key);
  }, [styleList, styleKey]);

  useEffect(() => { if (styleKey) localStorage.setItem(STYLE_KEY, styleKey); }, [styleKey]);

  const sentences = useMemo(() => splitSentences(script?.scenes?.[sceneIdx]?.narration || ''), [script, sceneIdx]);
  const scene = script?.scenes?.[sceneIdx];
  const cloudReady = !!ttsConfig?.configured;

  // 读语音配置（不返回密钥，只告诉前端有没有配）
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/tts/config`, { headers: authHeaders() });
        const json = await res.json().catch(() => null);
        if (json?.data) {
          setTtsConfig(json.data as TtsConfig);
          const cfgVoice = (json.data as TtsConfig).voice || 'xiaoyan';
          // ⛔ 不能简单地「localStorage 有值就用」：老师在系统设置里换了默认发音人，
          // 讲解器还拿旧缓存就永远不生效。所以记住上次见到的系统默认，一旦它变了就以新默认为准。
          let lastDefault = '';
          try { lastDefault = localStorage.getItem(VOICE_DEFAULT_KEY) || ''; } catch { /* ignore */ }
          if (lastDefault !== cfgVoice) {
            try { localStorage.setItem(VOICE_DEFAULT_KEY, cfgVoice); } catch { /* ignore */ }
            setVoice(cfgVoice);
          } else {
            setVoice((v) => v || cfgVoice);
          }
        }
      } catch {
        setTtsConfig({ configured: false, voices: [], voice: '', speed: 50, volume: 50 });
      }
    })();
  }, [apiBase]);

  // 本机中文语音（云端不可用时用）
  useEffect(() => {
    const pick = () => {
      const voices = window.speechSynthesis?.getVoices?.() || [];
      const zh = voices.filter((v) => /^zh(-|_)/i.test(v.lang) || /Chinese|Huihui|Kangkang|Yaoyao|Xiaoxiao|Yunxi/i.test(v.name));
      voiceRef.current =
        zh.find((v) => /Huihui|Xiaoxiao/i.test(v.name)) ||
        zh.find((v) => /Yaoyao|Kangkang/i.test(v.name)) ||
        zh[0] ||
        null;
    };
    pick();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = pick;
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /** 取一句的音频 blob（带内存缓存，重讲同一句不再消耗额度） */
  const getBlob = useCallback(async (text: string): Promise<Blob> => {
    const speed = Math.max(0, Math.min(100, Math.round(50 * rate)));
    const key = `${voice}|${speed}|${text}`;
    const hit = blobCacheRef.current.get(key);
    if (hit) return hit;

    const res = await fetch(`${apiBase}/tts`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text, voice: voice || undefined, speed }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error((json && json.error) || `语音合成失败（${res.status}）`);
    }
    const blob = await res.blob();
    if (!blob.size) throw new Error('语音文件为空');
    blobCacheRef.current.set(key, blob);
    return blob;
  }, [voice, rate, apiBase]);

  const playBlob = useCallback((blob: Blob) => new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('音频播放失败')); };
    audio.play().catch((e) => { URL.revokeObjectURL(url); reject(e); });
  }), []);

  const fetchScript = useCallback(async (questionId: string, force = false): Promise<Script> => {
    const res = await fetch(`${apiBase}/script`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      // style_key 必须每次带上：后端按 (题目, 风格) 取缓存，不带就走默认风格
      body: JSON.stringify({ question_id: questionId, force, style_key: styleKey || undefined }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error((json && json.error) || `生成讲解失败（${res.status}）`);
    return json.data.script as Script;
  }, [apiBase, styleKey]);

  const loadScript = useCallback(async (question: ExplainQuestion | undefined) => {
    if (!question) return;
    setLoading(true);
    setError('');
    setScript(null);
    setSceneIdx(0);
    setSentenceIdx(0);
    try {
      setScript(await fetchScript(question.id));
    } catch (e) {
      setError((e as Error).message || '生成讲解失败');
    } finally {
      setLoading(false);
    }
  }, [fetchScript]);

  useEffect(() => { loadScript(current); }, [current?.id, loadScript]);

  // 预取下一题的讲解脚本
  useEffect(() => {
    const next = questions[idx + 1];
    if (!next) return;
    const t = setTimeout(() => { fetchScript(next.id).catch(() => {}); }, 1200);
    return () => clearTimeout(t);
  }, [idx, questions, fetchScript]);

  // 预取下一句音频：讲这句时下一句已经在合成，听感更连贯
  useEffect(() => {
    if (!cloudReady) return;
    const next = sentences[sentenceIdx + 1];
    if (!next) return;
    const t = setTimeout(() => { getBlob(next).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [cloudReady, sentences, sentenceIdx, getBlob]);

  const markExplained = useCallback(async (questionId: string) => {
    // 「已讲解」标记是教师端讲评行为，学生自助听不写这张表
    if (audience !== 'teacher') return;
    if (!classId || finishedRef.current.has(questionId)) return;
    finishedRef.current.add(questionId);
    try {
      await fetch(`${API_CONFIG.apiUrl}/api/teacher/analytics/explained/${classId}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ question_ids: [questionId], explained: true }),
      });
      setMarked(true);
    } catch {
      // 标记失败不影响讲解
    }
  }, [classId, audience]);

  const goQuestion = useCallback((nextIdx: number) => {
    // 手动切题时清掉「自动进入下一题」的倒计时，避免连跳两题
    if (gapTimerRef.current) { clearTimeout(gapTimerRef.current); gapTimerRef.current = null; }
    if (gapTickRef.current) { clearInterval(gapTickRef.current); gapTickRef.current = null; }
    setGapLeft(0);
    if (nextIdx < 0 || nextIdx >= questions.length) { onClose(); return; }
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    tokenRef.current += 1;
    setIdx(nextIdx);
    setMarked(false);
    setPlaying(true);
  }, [questions.length, onClose]);

  const jumpScene = useCallback((delta: number) => {
    if (!script) return;
    const next = Math.min(Math.max(sceneIdx + delta, 0), script.scenes.length - 1);
    if (next === sceneIdx) return;
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    tokenRef.current += 1;
    setSceneIdx(next);
    setSentenceIdx(0);
  }, [script, sceneIdx]);

  // 逐句朗读：云端优先，失败回落本机
  useEffect(() => {
    if (!playing || loading || !script || !scene || sentences.length === 0) return;
    const text = sentences[sentenceIdx];
    if (text == null) return;

    const token = ++tokenRef.current;
    let cancelled = false;
    const advance = () => {
      if (cancelled || token !== tokenRef.current) return;
      if (sentenceIdx < sentences.length - 1) setSentenceIdx(sentenceIdx + 1);
      else if (sceneIdx < script.scenes.length - 1) { setSceneIdx(sceneIdx + 1); setSentenceIdx(0); }
      else {
        if (current) markExplained(current.id);
        if (idx < questions.length - 1) {
          // 按设置的「题间隔」停留一会儿再进下一题，倒计时显示在底部
          setGapLeft(gapSec);
          if (gapTickRef.current) clearInterval(gapTickRef.current);
          gapTickRef.current = setInterval(() => setGapLeft((g) => Math.max(0, g - 1)), 1000);
          if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
          gapTimerRef.current = setTimeout(() => {
            if (gapTickRef.current) { clearInterval(gapTickRef.current); gapTickRef.current = null; }
            gapTimerRef.current = null;
            setGapLeft(0);
            goQuestion(idx + 1);
          }, Math.max(0, gapSec) * 1000);
        } else {
          setPlaying(false);
        }
      }
    };

    const speakLocal = () => {
      if (!window.speechSynthesis) { advance(); return; }
      const u = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) u.voice = voiceRef.current;
      u.lang = 'zh-CN';
      u.rate = rate;
      u.onend = () => { if (!cancelled && token === tokenRef.current) advance(); };
      u.onerror = () => {
        if (!cancelled && token === tokenRef.current) setTimeout(advance, 2000);
      };
      window.speechSynthesis.speak(u);
    };

    (async () => {
      if (cloudReady) {
        try {
          const blob = await getBlob(text);
          if (cancelled || token !== tokenRef.current) return;
          await playBlob(blob);
          advance();
          return;
        } catch {
          setDegraded(true); // 额度/网络/音色未开通 → 回落本机，不打断讲课
        }
      }
      if (!cancelled && token === tokenRef.current) speakLocal();
    })();

    return () => {
      cancelled = true;
      window.speechSynthesis?.cancel();
      try { audioRef.current?.pause(); } catch { /* ignore */ }
    };
  }, [playing, loading, script, scene, sentences, sentenceIdx, sceneIdx, rate, idx, current, questions.length, cloudReady, getBlob, playBlob, markExplained, goQuestion, gapSec]);

  // 键盘：空格暂停、左右切场景、Esc 退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); return; }
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); jumpScene(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); jumpScene(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jumpScene, onClose]);

  const optionList = useMemo(() => parseOptions(current?.options), [current?.options]);
  const answerSet = useMemo(() => correctnessKeys(current?.answers), [current?.answers]);
  const answerTexts = useMemo(
    () => (current?.type === 'composite' ? [] : extractAnswerTexts(current?.answers)),
    [current?.type, current?.answers]
  );
  const topic = script?.topic || current?.cluster_id || '';
  const ratePct = current?.total_attempts
    ? Math.round(((current.wrong_count || 0) / current.total_attempts) * 100)
    : null;
  const s = fontScale;
  const currentStyle = styleList.find((st) => st.style_key === styleKey);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-50" style={{ fontSize: `${s}rem` }}>
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-indigo-600 px-3 py-1 text-sm font-medium text-white">AI 语音讲解</span>
          <span className="text-base font-semibold text-gray-800">{title}</span>
          {skipNote && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700" title="连续讲解自动跳过不适合语音讲解的题型">
              <i className="fa-solid fa-circle-info mr-1"></i>{skipNote}
            </span>
          )}
          <span className="text-sm text-gray-500">
            第 {idx + 1} / {questions.length} 题
            {ratePct !== null && <span className="ml-2 text-rose-600">错误率 {ratePct}%</span>}
            {current?.wrong_count ? <span className="ml-2 text-gray-400">错 {current.wrong_count} 次</span> : null}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {/* 音色：仅云端可用时显示 */}
          {cloudReady && ttsConfig && ttsConfig.voices.length > 0 && (
            <select
              value={voice || '__custom__'}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__custom__') {
                  // 讯飞没有「列出发音人」接口 → 允许手填控制台里看到的 vcn
                  const input = window.prompt('填讯飞控制台 → 语音合成 → 发音人管理 里显示的参数值，例如 x4_xxx / vixm', voice || '');
                  const vcn = (input || '').trim();
                  if (!/^[A-Za-z0-9_]{1,40}$/.test(vcn)) return; // 取消或格式不对就保持原音色
                  setVoice(vcn);
                  setDegraded(false);
                  return;
                }
                setVoice(v);
                setDegraded(false);
              }}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              title="切换发音人"
            >
              {/* 系统设置里填的自定义发音人：直接把参数值显示出来，别再逼老师重填一遍 */}
              {voice && !ttsConfig.voices.some((v) => v.id === voice) && (
                <option value={voice}>自定义：{voice}</option>
              )}
              {Array.from(new Set(ttsConfig.voices.map((v) => v.group || '其他'))).map((g) => (
                <optgroup key={g} label={g}>
                  {ttsConfig.voices.filter((v) => (v.group || '其他') === g).map((v) => (
                    <option key={v.id} value={v.id}>{v.name}{v.note ? `（${v.note}）` : ''}</option>
                  ))}
                </optgroup>
              ))}
              {/* 列表外的发音人：讯飞没有列出发音人的接口，后台开通了但这里没有很正常 */}
              <option value="__custom__">{voice ? '换一个自定义发音人…' : '自定义发音人…'}</option>
            </select>
          )}
          {!cloudReady && (
            <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-500" title="在系统配置 → AI设置 里填讯飞密钥可换成自然音色">
              本机语音
            </span>
          )}
          {degraded && <span className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-700">已回落本机语音</span>}

          {/* 题间隔：讲完一题停留多久再进下一题 */}
          <div className="flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs">
            <span className="text-gray-500">题间隔</span>
            <select
              value={gapSec}
              onChange={(e) => setGapSec(Number(e.target.value))}
              className="bg-transparent text-xs outline-none"
              title="讲完一题后停留多久进入下一题"
            >
              {[0, 1, 2, 3, 5, 8, 10].map((v) => (
                <option key={v} value={v}>{v} 秒</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-gray-300 px-1 py-0.5">
            <span className="px-1 text-xs text-gray-500">字号</span>
            <button onClick={() => setFontScale((v) => Math.max(0.8, +(v - 0.1).toFixed(2)))} className="h-6 w-6 rounded hover:bg-gray-100" title="缩小">A-</button>
            <span className="w-10 text-center text-xs text-gray-600">{Math.round(s * 100)}%</span>
            <button onClick={() => setFontScale((v) => Math.min(2, +(v + 0.1).toFixed(2)))} className="h-6 w-6 rounded hover:bg-gray-100" title="放大">A+</button>
          </div>
          <button onClick={() => setRate(rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">{rate}×</button>
          <button onClick={() => setShowSubtitle((v) => !v)} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">字幕{showSubtitle ? '开' : '关'}</button>
          <button onClick={onClose} className="rounded-lg bg-gray-800 px-4 py-1.5 text-white hover:bg-gray-900">结束讲解</button>
        </div>
      </div>

      {/* 讲解风格：就地切换（后端按 题目 × 风格 缓存，切过去不重复生成） */}
      {styleList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-6 py-2">
          <span className="shrink-0 text-xs text-gray-500">讲解风格</span>
          {styleList.map((st) => (
            <button
              key={st.style_key}
              onClick={() => {
                if (st.style_key === styleKey) return;
                window.speechSynthesis?.cancel();
                audioRef.current?.pause();
                tokenRef.current += 1;
                setStyleKey(st.style_key);
                setPlaying(true);
              }}
              title={st.summary || ''}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                st.style_key === styleKey ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {st.name}
            </button>
          ))}
          {currentStyle?.max_chars ? (
            <span className="ml-auto shrink-0 text-xs text-gray-400">这段讲解约 {currentStyle.max_chars} 字以内</span>
          ) : null}
        </div>
      )}

      {/* 主体：左题目 / 右讲解 */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-4">
        <div className="flex min-h-0 flex-col overflow-y-auto rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
              {current?.type === 'choice' ? '单选题'
                : current?.type === 'fill_blank' || current?.type === 'fill' ? '填空题'
                : current?.type === 'composite' ? '复合题'
                : current?.type === 'wps_op' || current?.type === 'access_op' ? '操作题'
                : current?.type || '题目'}
            </span>
            {topic && <span className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{topic}</span>}
          </div>
          <div
            className="question-rich-content leading-relaxed text-gray-900"
            style={{ fontSize: `${1.35 * s}rem` }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(current?.content || '') }}
          />
          {optionList.length > 0 && (
            <div className="mt-5 space-y-2">
              {optionList.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const isCorrect = answerSet.has(letter);
                const compareOpt = scene?.kind === 'compare' ? scene.options?.find((o) => o.key === letter) : undefined;
                const dim = scene?.kind === 'compare' && compareOpt && compareOpt.verdict === 'wrong';
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-3 rounded-lg px-3 py-2 ${
                      isCorrect ? 'bg-emerald-50 text-emerald-800' : dim ? 'bg-gray-50 text-gray-400' : 'text-gray-700'
                    }`}
                    style={{ fontSize: `${1.1 * s}rem` }}
                  >
                    <span className={`font-semibold ${isCorrect ? 'text-emerald-600' : ''}`}>{letter}</span>
                    <span className="question-rich-content flex-1" dangerouslySetInnerHTML={{ __html: sanitizeHtml(opt) }} />
                    {isCorrect && <i className="fa-solid fa-check mt-1.5 text-emerald-600"></i>}
                    {dim && <i className="fa-solid fa-xmark mt-1.5 text-rose-400"></i>}
                  </div>
                );
              })}
            </div>
          )}

          {/* 填空题：没有选项，题干下面直接给出正确答案 */}
          {optionList.length === 0 && answerTexts.length > 0 && (
            <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="mb-1 text-xs font-medium text-emerald-700">正确答案</p>
              {answerTexts.map((t, i) => (
                <p key={i} className="break-words font-medium text-emerald-900" style={{ fontSize: `${1.2 * s}rem` }}>
                  {answerTexts.length > 1 ? `${i + 1}. ` : ''}{t}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col overflow-y-auto rounded-xl border border-gray-200 bg-white p-5">
          {loading && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
              <i className="fa-solid fa-wand-magic-sparkles fa-beat text-3xl text-indigo-500"></i>
              <p>AI 正在备课…</p>
            </div>
          )}
          {!loading && error && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-rose-600">{error}</p>
              <button onClick={() => loadScript(current)} className="rounded-lg bg-indigo-600 px-4 py-2 text-white">重试</button>
            </div>
          )}
          {!loading && !error && scene && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs text-white">{sceneIdx + 1}/{script!.scenes.length}</span>
                <span className="font-semibold text-gray-800" style={{ fontSize: `${1.25 * s}rem` }}>{scene.title}</span>
              </div>

              <div className="min-h-0 flex-1">
                {scene.kind === 'compare' && scene.options && (
                  <div className="space-y-2">
                    {scene.options.map((o) => (
                      <div key={o.key} className={`rounded-lg border-l-4 px-3 py-2 ${o.verdict === 'correct' ? 'border-emerald-500 bg-emerald-50' : 'border-rose-400 bg-rose-50'}`}>
                        <p className="font-medium text-gray-800" style={{ fontSize: `${1.05 * s}rem` }}>
                          <span className={o.verdict === 'correct' ? 'text-emerald-600' : 'text-rose-600'}>{o.verdict === 'correct' ? '✓ ' : '✗ '}</span>
                          {o.key}. {o.text}
                        </p>
                        {o.reason && <p className="mt-0.5 text-gray-600" style={{ fontSize: `${0.95 * s}rem` }}>{o.reason}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {scene.kind === 'chart' && scene.chart && (
                  <div>
                    {scene.chart.unit && <p className="mb-2 text-gray-500" style={{ fontSize: `${0.9 * s}rem` }}>单位：{scene.chart.unit}</p>}
                    <div className="space-y-2">
                      {(() => {
                        const max = Math.max(...scene.chart!.items.map((i) => Math.abs(i.value)), 1);
                        return scene.chart!.items.map((it, i) => (
                          <div key={i} className="flex items-center gap-3">
                            <span className="w-24 shrink-0 text-right text-gray-600" style={{ fontSize: `${0.9 * s}rem` }}>{it.label}</span>
                            <div className="h-7 flex-1 overflow-hidden rounded bg-gray-100">
                              <div className="flex h-full items-center justify-end rounded bg-indigo-500 px-2 text-white" style={{ width: `${Math.max(8, (Math.abs(it.value) / max) * 100)}%`, fontSize: `${0.85 * s}rem` }}>
                                {it.value}
                              </div>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                {(scene.kind === 'point' || scene.kind === 'memory') && (
                  <div className={`space-y-2 ${scene.kind === 'memory' ? 'rounded-lg bg-amber-50 p-3' : ''}`}>
                    {(scene.bullets || []).map((b, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <i className={`fa-solid ${scene.kind === 'memory' ? 'fa-lightbulb text-amber-500' : 'fa-circle text-[6px] text-indigo-400'} mt-2`}></i>
                        <p className="leading-relaxed text-gray-700" style={{ fontSize: `${1.05 * s}rem` }}>{b}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {showSubtitle && sentences.length > 0 && (
                <div className="mt-4 border-t border-gray-200 pt-3">
                  <p className="text-center leading-relaxed" style={{ fontSize: `${1.1 * s}rem` }}>
                    {sentences.map((sen, i) => (
                      <span key={i} className={i === sentenceIdx ? 'rounded bg-yellow-100 px-1 font-medium text-gray-900' : 'text-gray-500'}>
                        {sen}
                      </span>
                    ))}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 底部控制条 */}
      <div className="border-t border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => jumpScene(-1)} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">上一段</button>
          <button onClick={() => setPlaying((p) => !p)} className="rounded-lg bg-indigo-600 px-5 py-1.5 font-medium text-white hover:bg-indigo-700">
            {playing ? '暂停' : '继续'}
          </button>
          <button onClick={() => jumpScene(1)} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">下一段</button>
          <span className="mx-2 text-gray-300">|</span>
          <button onClick={() => goQuestion(idx - 1)} disabled={idx === 0} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40">上一题</button>
          <button onClick={() => goQuestion(idx + 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">
            {idx === questions.length - 1 ? '完成' : '下一题'}
          </button>
          {audience === 'teacher' && (
            <button
              onClick={() => current && markExplained(current.id)}
              className={`ml-auto rounded-lg px-3 py-1.5 ${marked ? 'bg-emerald-50 text-emerald-700' : 'border border-gray-300 hover:bg-gray-50'}`}
            >
              {marked ? '✓ 已标记讲解' : '标记已讲'}
            </button>
          )}
          {gapLeft > 0 && (
            <span className="rounded-lg bg-indigo-50 px-2 py-1 text-indigo-700">
              {gapLeft} 秒后进入下一题
            </span>
          )}
          <span className="text-xs text-gray-400">空格暂停 · ←→ 切段 · Esc 退出</span>
        </div>
      </div>
    </div>
  );
};
