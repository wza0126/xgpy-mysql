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
 * 编程填空题 · AI 语音讲解（学生端全屏）。
 *
 * 设计要点（吴老的要求）：
 *  - **全程显示题目**：左侧代码面板常驻，任何一步都不隐藏题目。
 *  - **填空处高亮**：所有空都是琥珀色虚线框；讲到哪个空，那个空变成实心高亮并放大。
 *  - **尤其是填的答案**：讲到某空时，**正确答直接显示在空里**；学生自己填的答案
 *    以「你填：xxx ✗」贴在旁边，一眼看出差在哪。
 *
 * ⛔ 正确答案来自后端（题库 blank_answers），不是模型写的：这题一个字符错就零分。
 * ⛔ 必须 portal 到 document.body：桌面端窗口带 transform，全屏层会被任务栏压住。
 */
const PLACEHOLDER_CHARS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const VOICE_KEY = 'xgpy_fillblank_voice';

interface ScriptBlank {
  index: number;
  char?: string;
  answers: string[];
  line: string;
  why: string;
  tip: string;
}

interface Script {
  intro: string;
  blanks: ScriptBlank[];
  summary: string;
}

interface Props {
  taskId: string;
  title: string;
  description?: string;
  template: string;
  /** 学生当前填的答案（按空顺序）；没填就是空串 */
  studentAnswers: string[];
  onClose: () => void;
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

type Step = { kind: 'intro' } | { kind: 'blank'; idx: number } | { kind: 'summary' };

function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[。！？；!?;])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 朗读前的符号规整：代码原样念出来会变成「三点一四星号星号二」这种，
 * 学生听不懂。只在**送去合成**的文本上做替换，字幕仍显示原样代码。
 * ⛔ 只处理这几种高频符号，别做通用代码翻译 —— 猜错了比念错更糟。
 */
function speechify(text: string): string {
  return String(text || '')
    .replace(/\*\*2\b/g, ' 的平方 ')
    .replace(/\*\*3\b/g, ' 的立方 ')
    .replace(/\*\*/g, ' 的乘方 ')
    .replace(/!=/g, ' 不等于 ')
    .replace(/==/g, ' 等于 ')
    .replace(/<=/g, ' 小于等于 ')
    .replace(/>=/g, ' 大于等于 ')
    .replace(/\*/g, ' 乘 ')
    .replace(/\//g, ' 除以 ')
    .replace(/%/g, ' 取余 ')
    .replace(/\+/g, ' 加 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const FillBlankExplainPlayer: React.FC<Props> = ({
  taskId, title, description, template, studentAnswers, onClose,
}) => {
  const [script, setScript] = useState<Script | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [degradedScript, setDegradedScript] = useState(false);

  const [stepIdx, setStepIdx] = useState(0);
  const [sentenceIdx, setSentenceIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);

  const [ttsConfig, setTtsConfig] = useState<TtsConfig | null>(null);
  const [voice, setVoice] = useState('');
  const [choice, setChoice] = useState('');
  const [voiceChoices, setVoiceChoices] = useState<VoiceChoice[]>([]);
  const [sysVoices, setSysVoices] = useState<{ edge: SpeechSynthesisVoice[]; local: SpeechSynthesisVoice[] }>({ edge: [], local: [] });

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
      try {
        const res = await fetch('/api/student/explain/fill-blank', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ task_id: taskId }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error((json && json.error) || `生成讲解失败（${res.status}）`);
        if (!alive) return;
        setScript(json.data.script as Script);
        setDegradedScript(!!json.data.degraded);
      } catch (e) {
        if (alive) setLoadErr((e as Error).message || '生成讲解失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [taskId]);

  // ---------- 语音配置 ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/student/explain/tts/config', { headers: authHeaders() });
        const json = await res.json().catch(() => null);
        if (json?.data) {
          setTtsConfig(json.data as TtsConfig);
          setVoice(json.data.voice || 'xiaoyan');
        }
      } catch {
        setTtsConfig({ configured: false, voices: [], voice: '', speed: 50 });
      }
    })();
  }, []);

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

  const picked = useMemo(() => parseChoice(choice), [choice]);
  const cloudReady = !!ttsConfig?.configured;
  const xfyunVcn = picked.engine === 'xfyun' ? picked.id : voice;
  const edgeVoice = picked.engine === 'edge' ? (sysVoices.edge.find((v) => v.name === picked.id) || null) : null;
  const localVoice = sysVoices.local.find((v) => /Huihui|Yaoyao|Kangkang/i.test(v.name)) || sysVoices.local[0] || null;

  // ---------- 步骤 ----------
  const steps: Step[] = useMemo(() => {
    if (!script) return [];
    return [
      { kind: 'intro' as const },
      ...script.blanks.map((_, i) => ({ kind: 'blank' as const, idx: i })),
      { kind: 'summary' as const },
    ];
  }, [script]);

  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const activeBlank = step && step.kind === 'blank' ? script?.blanks[step.idx] : null;

  const narration = useMemo(() => {
    if (!script || !step) return '';
    if (step.kind === 'intro') return script.intro;
    if (step.kind === 'summary') return `最后小结一下。${script.summary}`;
    const b = script.blanks[step.idx];
    if (!b) return '';
    const answer = b.answers[0] || '空';
    const alt = b.answers.length > 1 ? `也可以写成 ${b.answers.slice(1, 3).join('，或者')}。` : '';
    return `第 ${b.index} 空填 ${answer}。${alt}${b.why}${b.tip ? `　记住：${b.tip}` : ''}`;
  }, [script, step]);

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
    const res = await fetch('/api/student/explain/tts', {
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
  }, [xfyunVcn, rate]);

  const playBlob = useCallback((blob: Blob) => new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('音频播放失败')); };
    audio.play().catch((e) => { URL.revokeObjectURL(url); reject(e); });
  }), []);

  // 逐句朗读；一句读完跳下一句，一讲讲完自动进下一步
  useEffect(() => {
    if (!playing || !sentences.length) return;
    const text = sentences[sentenceIdx];
    if (text == null) return;
    // 送去合成的文本做符号规整；字幕仍用原句
    const spoken = speechify(text);
    const token = ++tokenRef.current;
    let cancelled = false;

    const advance = () => {
      if (cancelled || token !== tokenRef.current) return;
      if (sentenceIdx < sentences.length - 1) { setSentenceIdx(sentenceIdx + 1); return; }
      if (stepIdx < steps.length - 1) {
        nextTimerRef.current = window.setTimeout(() => {
          if (token === tokenRef.current) goStep(stepIdx + 1);
        }, 900);
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
  }, [playing, stepIdx, sentenceIdx, sentences, steps.length, edgeVoice, localVoice, cloudReady, rate, getBlob, playBlob, goStep]);

  // 预取下一句（讯飞有网络往返，预取听感更连贯）
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

  // ---------- 代码渲染：空位高亮 ----------
  const codeView = useMemo(() => {
    const lines = String(template || '').split('\n');
    let counter = 0;
    return lines.map((line, li) => {
      const nodes: React.ReactNode[] = [];
      let plain = '';
      const flush = (key: string) => {
        if (!plain) return;
        nodes.push(<span key={key}>{plain}</span>);
        plain = '';
      };
      for (let ci = 0; ci < line.length; ci += 1) {
        const ch = line[ci];
        const pos = PLACEHOLDER_CHARS.indexOf(ch);
        if (pos < 0) { plain += ch; continue; }
        flush(`t-${li}-${ci}`);
        const blankNo = counter;
        counter += 1;
        const b = script?.blanks[blankNo];
        const isActive = !!(step && step.kind === 'blank' && step.idx === blankNo);
        const mine = String(studentAnswers[blankNo] || '').trim();
        const right = b?.answers?.[0] || '';
        const wrong = !!mine && !!right && !b?.answers?.some((a) => a.replace(/\s+/g, '') === mine.replace(/\s+/g, ''));

        nodes.push(
          <span key={`b-${li}-${ci}`} className="relative inline-block align-baseline">
            {isActive && (
              <span className="absolute -top-6 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-amber-400 px-1.5 py-0.5 text-[0.6em] font-bold text-amber-950 shadow">
                第 {blankNo + 1} 空
              </span>
            )}
            <span
              className={`mx-0.5 inline-block rounded px-1.5 py-0.5 font-mono transition-all ${
                isActive
                  ? 'scale-105 bg-amber-300 text-[0.95em] font-bold text-amber-950 shadow-lg ring-4 ring-amber-400/50'
                  : 'border border-dashed border-amber-400/70 bg-amber-400/10 text-amber-200'
              }`}
            >
              {/* 讲到这个空 → 直接把正确答案显示在空里；没讲到 → 学生填的，没填就显示序号 */}
              {isActive ? (right || `${blankNo + 1}`) : (mine || ch)}
            </span>
            {isActive && wrong && (
              <span className="ml-1 inline-block rounded bg-rose-500/20 px-1 py-0.5 text-[0.62em] text-rose-300 line-through">
                你填{mine}
              </span>
            )}
          </span>,
        );
      }
      flush(`e-${li}`);
      return (
        <div key={`line-${li}`} className="whitespace-pre leading-[1.9]">
          {nodes.length ? nodes : <span>&nbsp;</span>}
        </div>
      );
    });
  }, [template, script, step, studentAnswers]);

  const total = steps.length || 1;
  const cur = Math.min(stepIdx + 1, total);

  const body = (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-950 text-slate-100">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-full bg-amber-500 px-3 py-1 text-sm font-semibold text-amber-950">
            <i className="fa-solid fa-wand-magic-sparkles mr-1.5"></i>AI 讲解 · 编程填空
          </span>
          <span className="truncate text-base font-semibold" title={title}>{title}</span>
          <span className="shrink-0 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
            第 {cur} / {total} 步
          </span>
          {degradedScript && (
            <span className="shrink-0 rounded bg-amber-900/60 px-2 py-0.5 text-xs text-amber-300" title="AI 暂时不可用，已改用基础讲解">
              基础讲解
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {voiceChoices.length > 0 && (
            <select
              value={choice}
              onChange={(e) => { setChoice(e.target.value); engineLockRef.current = null; }}
              className="max-w-[10rem] rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
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
            <option value="0.8">0.8×</option>
            <option value="1">1.0×</option>
            <option value="1.15">1.15×</option>
            <option value="1.3">1.3×</option>
          </select>
          <button onClick={onClose} className="rounded-lg px-2.5 py-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100" title="退出（Esc）">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
          <i className="fa-solid fa-spinner fa-spin mb-3 text-2xl"></i>
          <p>AI 正在备课，先看一遍这道题…</p>
        </div>
      ) : loadErr ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <i className="fa-solid fa-circle-exclamation text-2xl text-rose-400"></i>
          <p className="text-rose-300">{loadErr}</p>
          <button onClick={onClose} className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">关闭</button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* 左：题目（全程显示） */}
          <div className="flex min-w-0 flex-[3] flex-col border-r border-slate-800">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-1.5 text-xs text-slate-400">
              <i className="fa-solid fa-file-code"></i>题目
              <span className="ml-auto text-slate-500">琥珀色是空位 · 讲到哪个空，那个空就亮起来</span>
            </div>
            {description && (
              <div className="max-h-32 shrink-0 overflow-auto border-b border-slate-800 px-4 py-2 text-sm leading-6 text-slate-300">
                {description}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto px-5 py-5 font-mono text-[1.05rem] text-slate-100">
              {codeView}
            </div>
          </div>

          {/* 右：讲解卡 */}
          <div className="flex w-[26rem] shrink-0 flex-col bg-slate-900">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-1.5 text-xs text-slate-400">
              <span><i className="fa-solid fa-chalkboard mr-1"></i>讲解</span>
              <span>{step?.kind === 'blank' ? `第 ${(step.idx + 1)} 空 / 共 ${script?.blanks.length} 空` : step?.kind === 'intro' ? '先看整体' : '小结'}</span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
              {step?.kind === 'blank' && activeBlank ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-amber-400">正确答案</p>
                  <p className="mt-1 break-all rounded-xl bg-amber-400/15 px-4 py-3 font-mono text-2xl font-bold text-amber-300 ring-1 ring-amber-400/40">
                    {activeBlank.answers[0] || '（题库未配置）'}
                  </p>
                  {activeBlank.answers.length > 1 && (
                    <p className="mt-2 text-xs text-slate-400">
                      也可以写成：<span className="font-mono text-slate-300">{activeBlank.answers.slice(1, 4).join('  或  ')}</span>
                    </p>
                  )}
                  {(() => {
                    const mine = String(studentAnswers[step.idx] || '').trim();
                    if (!mine) return <p className="mt-2 text-xs text-slate-500">你这一空还没填</p>;
                    const ok = activeBlank.answers.some((a) => a.replace(/\s+/g, '') === mine.replace(/\s+/g, ''));
                    return (
                      <p className={`mt-2 text-xs ${ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                        你填的：<span className="font-mono line-through">{mine}</span> {ok ? '✓ 对' : '✗ 不对'}
                      </p>
                    );
                  })()}

                  <p className="mt-5 text-xs uppercase tracking-wide text-slate-500">为什么这么填</p>
                  <p className="mt-1 text-[1.02rem] leading-7 text-slate-200">{activeBlank.why}</p>

                  {activeBlank.tip && (
                    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <p className="text-xs font-medium text-amber-400"><i className="fa-solid fa-triangle-exclamation mr-1"></i>易错</p>
                      <p className="mt-0.5 text-sm leading-6 text-amber-200">{activeBlank.tip}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {step?.kind === 'intro' ? '这道题考什么' : '小结'}
                  </p>
                  <p className="mt-2 text-[1.05rem] leading-8 text-slate-200">
                    {step?.kind === 'intro' ? script?.intro : script?.summary}
                  </p>
                  {step?.kind === 'intro' && script && (
                    <div className="mt-5 space-y-1.5">
                      {script.blanks.map((b, i) => (
                        <button
                          key={i}
                          onClick={() => goStep(i + 1)}
                          className="flex w-full items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-left text-sm text-slate-300 hover:border-amber-500/50 hover:text-amber-200"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[11px] font-bold text-amber-300">{b.index}</span>
                          <span className="truncate">{b.line.trim() || '（这一行只有空）'}</span>
                          <i className="fa-solid fa-chevron-right ml-auto text-[10px] text-slate-500"></i>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 字幕：当前句高亮 */}
            <div className="shrink-0 border-t border-slate-800 bg-slate-950/60 px-4 py-3">
              <p className="text-sm leading-7">
                {sentences.map((s, i) => (
                  <span key={i} className={i === sentenceIdx ? 'rounded bg-amber-400/25 px-0.5 font-medium text-amber-200' : i < sentenceIdx ? 'text-slate-600' : 'text-slate-400'}>
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
          className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-amber-950 hover:bg-amber-400"
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
              title={s.kind === 'intro' ? '开场' : s.kind === 'summary' ? '小结' : `第 ${(s as any).idx + 1} 空`}
              className={`h-2 rounded-full transition-all ${i === stepIdx ? 'w-6 bg-amber-400' : 'w-2 bg-slate-700 hover:bg-slate-500'}`}
            />
          ))}
        </div>

        <span className="ml-auto text-xs text-slate-500">空格暂停 · ←→ 上下步 · Esc 退出</span>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};

export default FillBlankExplainPlayer;
