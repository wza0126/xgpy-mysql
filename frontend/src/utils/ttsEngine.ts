/**
 * 语音引擎工具（三级降级）：Edge 在线自然音色 → 讯飞云端 → 浏览器本机。
 *
 * 背景（2026-10-22 实测）：Edge 的 `speechSynthesis.getVoices()` 里带一批
 * `Microsoft 晓晓 Online (Natural) - Chinese ...` 音色，就是 Azure 神经网络语音，
 * 走 Edge 自带朗读通道，**免费、无额度、也不需要 API key**；Chrome 只有系统 SAPI
 * 的三个老音色（Huihui / Kangkang / Yaoyao），一个 Online 音色都没有。
 *
 * 所以「优先 Edge、没有 Edge 用讯飞、再不行用本机」这条链，判定依据就是
 * getVoices() 里有没有 Online (Natural) 音色 —— 不需要服务端任何配合。
 *
 * ⛔ 该路径的固有短板（UI 上不要承诺做不到的事）：
 *   · 拿不到音频文件 → 不能预合成、不能缓存、只能靠 onend 推进；
 *   · 首包延迟 200~500ms；
 *   · 断网时 Edge 可能**静默**换成系统音色且不触发 onerror，程序感知不到。
 */

export type TtsEngine = 'edge' | 'xfyun' | 'local';

export interface VoiceChoice {
  /** `edge::<voice.name>` | `xfyun::<vcn>` | `local::<voice.name>` */
  value: string;
  label: string;
  group: string;
  engine: TtsEngine;
  /** engine 为 edge/local 时是 voice.name，xfyun 时是 vcn */
  id: string;
  /** action = 下拉里的操作项（「更多发音人…」），不是真音色，别拿去合成 */
  kind?: 'voice' | 'action';
}

export interface XfyunVoice {
  id: string;
  name: string;
  group?: string;
  note?: string;
}

const EDGE_NATURAL_RE = /Online\s*\(Natural\)/i;

/**
 * 粤语音色一律排除。
 * ⛔ 2026-11-02 事故：学生机 Edge 在内网拿不到在线音色时降级到本机，
 *    而 `listZhVoices()` 用 `/^zh/` 把 `zh-HK`（粤语：曉曼/雲龍/曉佳）也算成中文，
 *    系统装了中文(香港)语音包的机器上粤语排最前 → 整节课用粤语念，学生完全听不懂。
 * ⛔ 不能只看 lang：有的环境把粤语音色的 lang 也报成 zh-CN，名字也必须拦。
 */
const CANTONESE_RE = /Cantonese|zh[-_]?hk|HiuMaan|WanLung|HiuGaai|曉曼|雲龍|曉佳/i;
export function isCantoneseVoice(v: { name?: string; lang?: string }): boolean {
  return CANTONESE_RE.test(String(v.lang || '') + ' ' + String(v.name || ''));
}

/** 系统里所有**普通话**音色（Edge 在线 + 本机 SAPI 都会返回；粤语已剔除） */
export function listZhVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  const all = window.speechSynthesis.getVoices() || [];
  return all.filter((v) => {
    if (isCantoneseVoice(v)) return false;
    return /^zh([-_]|$)/i.test(v.lang || '') || /Chinese/i.test(v.name || '');
  });
}

/** 是否 Edge 的在线自然音色（Azure Neural） */
export function isEdgeNaturalVoice(v: SpeechSynthesisVoice): boolean {
  return EDGE_NATURAL_RE.test(v.name || '');
}

/** 把中文音色拆成「Edge 在线」与「本机」两组 */
export function splitVoices(list: SpeechSynthesisVoice[]): {
  edge: SpeechSynthesisVoice[];
  local: SpeechSynthesisVoice[];
} {
  const edge: SpeechSynthesisVoice[] = [];
  const local: SpeechSynthesisVoice[] = [];
  list.forEach((v) => (isEdgeNaturalVoice(v) ? edge : local).push(v));
  return { edge, local };
}

/** `Microsoft 晓晓 Online (Natural) - Chinese (Mandarin, Simplified)` → `晓晓` */
export function shortVoiceLabel(name: string): string {
  return String(name || '')
    .replace(/^Microsoft\s+/i, '')
    .replace(/\s*Online\s*\(Natural\)\s*/i, ' ')
    .replace(/\s*-\s*Chinese.*$/i, '')
    .trim();
}

/** 默认 Edge 音色：优先「云健」，其次「晓晓」，再不行用第一个在线音色 */
export function pickEdgeVoice(
  edge: SpeechSynthesisVoice[],
  prefer = '云健',
): SpeechSynthesisVoice | null {
  if (!edge.length) return null;
  const fallback = ['云健', '晓晓', '云希'];
  for (const name of [prefer, ...fallback]) {
    const hit = edge.find((v) => (v.name || '').includes(name));
    if (hit) return hit;
  }
  return edge[0];
}

/** 下拉里「更多发音人…」的哨兵值（不是真音色，选中它只是展开列表） */
export const VOICE_MORE = '__more__';
/** 「自定义讯飞发音人…」哨兵值（AI 讲解播放器里手填 vcn 用） */
export const VOICE_CUSTOM = '__custom__';

/**
 * Edge 在线音色默认只摆这几个（其余收进「更多」）。
 * ⛔ 实测 Edge 有 11 个普通话在线音色，全铺开和讯飞的十几项加起来就是二十多项，
 *    课堂上要从里面找「云健」很费劲 —— 这是老师明确提过的「选择成本」。
 * ⛔ 2026-11-02：原清单里的「晓辰」Edge 根本没有（只有 6 个标准 + 晓北/晓妮 + 3 个台湾），
 *    白占一个名额；已换成真实存在的 8 个，并把「云健」排到第一（默认发音人）。
 */
const EDGE_COMPACT = ['云健', '晓晓', '云希', '晓伊', '云扬', '云夏', '晓北', '晓妮'];
const EDGE_COMPACT_MAX = 8;

/** 收藏的 vcn 归一化：去空、去重、限量（后端也会截，这里是前端兜底） */
export function normalizeFavorites(list?: unknown, max = 8): string[] {
  const arr = Array.isArray(list)
    ? list
    : typeof list === 'string'
      ? String(list).split(/[,，\s]+/)
      : [];
  const out: string[] = [];
  arr.forEach((v) => {
    const id = String(v || '').trim();
    if (!/^[A-Za-z0-9_]{1,40}$/.test(id)) return;
    if (out.includes(id)) return;
    if (out.length >= max) return;
    out.push(id);
  });
  return out;
}

/** 名字类收藏（Edge 音色是「晓晓」「云希」这种短名，不是 vcn，不能用 VCN_RE） */
export function normalizeNameList(list?: unknown, max = 8): string[] {
  const arr = Array.isArray(list)
    ? list
    : typeof list === 'string'
      ? String(list).split(/[,，;；]+/)
      : [];
  const out: string[] = [];
  arr.forEach((v) => {
    const name = String(v || '').trim();
    if (!name || name.length > 60) return;
    if (out.includes(name)) return;
    if (out.length >= max) return;
    out.push(name);
  });
  return out;
}

export interface BuildVoiceOpts {
  /** 系统设置里勾的「课堂常用发音人」（讯飞 vcn，按勾选顺序优先展示） */
  favoriteIds?: unknown;
  /** 系统设置里勾的「Edge 常用音色」（短名，如 晓晓 / 云希） */
  edgeFavoriteIds?: unknown;
  /** 系统默认发音人：永远保留，否则设置页选了却在播放器里找不到 */
  keepId?: string;
  /** 当前选中的 Edge 短名：勾选变动后也别让它消失 */
  keepEdge?: string;
  /** 点过「更多发音人…」→ 展开全部 */
  showAll?: boolean;
}

/** 音色名归一化：不同 Edge 版本/语言给的名字在空格、括号、大小写上会差一点点 */
function normLabel(s: string): string {
  return String(s || '').replace(/[\s_\-()（）·,，.。]/g, '').toLowerCase();
}

/** 内置的最常用 Edge 音色（最多 6 个）：老师没勾、或勾的名字全对不上时用它 */function pickCompactEdge(edge: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  if (edge.length <= EDGE_COMPACT_MAX) return edge;
  const picked: SpeechSynthesisVoice[] = [];
  EDGE_COMPACT.forEach((want) => {
    if (picked.length >= EDGE_COMPACT_MAX) return;
    const hit = edge.find((v) => (v.name || '').includes(want) && !picked.includes(v));
    if (hit) picked.push(hit);
  });
  for (const v of edge) {
    if (picked.length >= EDGE_COMPACT_MAX) break;
    if (!picked.includes(v)) picked.push(v);
  }
  return picked;
}

/**
 * 构造下拉选项：Edge 在前（默认要用的），讯飞其次，本机兜底。
 * 没有 Edge 音色时列表里自然就没有 Edge 组 —— 降级是「检测不到」而不是「配置开关」。
 *
 * 紧凑模式（默认）：Edge 只留老师勾的（没勾则内置最常用的 6 个）、讯飞只留老师勾的收藏，
 * 被折叠的收进一条「更多发音人…」，把几十项压到十来项。
 */
export function buildVoiceChoices(
  edge: SpeechSynthesisVoice[],
  xfyun: XfyunVoice[],
  local: SpeechSynthesisVoice[],
  opts: BuildVoiceOpts = {},
): VoiceChoice[] {
  const showAll = !!opts.showAll;
  const out: VoiceChoice[] = [];

  // ---- Edge：优先按老师勾的短名；没勾 / 勾的全对不上 → 内置最常用的 6 个 ----
  const edgeFav = normalizeNameList(opts.edgeFavoriteIds);
  let edgeShown = edge;
  if (!showAll) {
    if (edgeFav.length) {
      const byLabel = new Map(edge.map((v) => [normLabel(shortVoiceLabel(v.name)), v]));
      const picked: SpeechSynthesisVoice[] = [];
      edgeFav.forEach((name) => {
        // 先把「大小写/空格/括号」抹平再比：不同 Edge 版本给的名字会差一点点
        const key = normLabel(name);
        let hit = byLabel.get(key);
        // 英文界面存的是 Xiaoxiao、中文界面存的是「晓晓」→ 再兜一层「全名包含」
        if (!hit) hit = edge.find((v) => normLabel(v.name).includes(key));
        if (hit && !picked.includes(hit)) picked.push(hit);
      });
      // 当前正在用的那个（老师手动切过的）别因为没勾就消失
      const keep = String(opts.keepEdge || '').trim();
      if (keep && !picked.some((v) => shortVoiceLabel(v.name) === keep)) {
        const k = byLabel.get(keep);
        if (k) picked.unshift(k);
      }
      // 一个都匹配不上（换了机器 / 语言包不同）→ 退回内置常用，别给 14 项全量
      edgeShown = picked.length ? picked : pickCompactEdge(edge);
    } else {
      edgeShown = pickCompactEdge(edge);
    }
  }
  edgeShown.forEach((v) => out.push({
    value: 'edge::' + v.name,
    label: shortVoiceLabel(v.name),
    group: 'Edge 在线（免费）',
    engine: 'edge',
    id: v.name,
  }));

  // ---- 讯飞：只留收藏（没勾过就保持全量，兼容老配置）----
  const fav = normalizeFavorites(opts.favoriteIds);
  const keepId = String(opts.keepId || '').trim();
  let xfShown = xfyun;
  if (fav.length && !showAll) {
    const byId = new Map(xfyun.map((v) => [v.id, v]));
    const picked = fav
      .map((id) => byId.get(id) || { id, name: `自定义：${id}` })
      .filter(Boolean) as XfyunVoice[];
    // 系统默认不在收藏里 → 补到最前面（否则默认值回显不出来）
    if (keepId && !picked.some((v) => v.id === keepId)) {
      picked.unshift(byId.get(keepId) || { id: keepId, name: `自定义：${keepId}` });
    }
    // 收藏全都不在清单里（老师在别的应用里勾过）→ 退回全量，别给个空列表
    xfShown = picked.length ? picked : xfyun;
  } else if (keepId && !xfShown.some((v) => v.id === keepId)) {
    xfShown = [{ id: keepId, name: `自定义：${keepId}` }, ...xfShown];
  }
  xfShown.forEach((v) => out.push({
    value: 'xfyun::' + v.id,
    label: v.name,
    group: '讯飞云端（按量计费）',
    engine: 'xfyun',
    id: v.id,
  }));

  // ---- 被折叠的项：一条「更多发音人…」兜住 ----
  const folded = (edge.length - edgeShown.length) + (xfyun.length - xfShown.length);
  if (!showAll && folded > 0) {
    out.push({
      value: VOICE_MORE,
      label: `更多发音人（还有 ${folded} 个）…`,
      group: '更多',
      engine: 'xfyun',
      id: '',
      kind: 'action',
    });
  }
  local.forEach((v) => out.push({
    value: 'local::' + v.name,
    label: shortVoiceLabel(v.name),
    group: '本机（兜底）',
    engine: 'local',
    id: v.name,
  }));
  return out;
}

/** 解析下拉值，非法值一律当 local（宁可出声，也别把课卡住） */
export function parseChoice(value: string): { engine: TtsEngine; id: string } {
  const m = /^(edge|xfyun|local)::(.*)$/.exec(String(value || ''));
  if (!m) return { engine: 'local', id: '' };
  return { engine: m[1] as TtsEngine, id: m[2] };
}

/**
 * 默认选项：Edge 晓晓 → 讯飞系统默认音色 → 本机。
 * `saved` 是上次记住的选择；它已经不在了（例如换了电脑/换了浏览器）就回到默认。
 * ⛔ 「本机」是最低级兜底，**不继承**：上次因为 Edge 没就绪/讯飞没配成而落的 local，
 *    下次只要有了 Edge 或讯飞就要自动升级回来（否则用过一次 Chrome 就永远听不到好声音）。
 */
export function pickDefaultChoice(
  choices: VoiceChoice[],
  saved: string,
  opts: { preferEdge?: string; xfyunDefaultId?: string } = {},
): string {
  const savedChoice = choices.find((c) => c.value === saved);
  const hasHigher = choices.some((c) => c.engine === 'edge' || c.engine === 'xfyun');
  if (savedChoice && !(savedChoice.engine === 'local' && hasHigher)) return saved;

  const prefer = opts.preferEdge || '云健';
  const edge = choices.filter((c) => c.engine === 'edge');
  if (edge.length) {
    return (edge.find((c) => c.label.includes(prefer)) || edge[0]).value;
  }
  const wantXfyun = opts.xfyunDefaultId || '';
  const xf = choices.filter((c) => c.engine === 'xfyun');
  if (xf.length) {
    const hit = xf.find((c) => c.id === wantXfyun);
    if (hit) return hit.value;
    // 系统里配的是清单外的自定义 vcn（老师手填的）→ 照样要回显，别悄悄换成小燕
    if (wantXfyun) return 'xfyun::' + wantXfyun;
    return xf[0].value;
  }
  const localFirst = choices.find((c) => c.engine === 'local');
  return localFirst ? localFirst.value : '';
}

/** Edge / 本机音色按名字找对象（voice 对象不能跨会话保存，只能存名字再查） */
export function findVoiceByName(list: SpeechSynthesisVoice[], name: string): SpeechSynthesisVoice | null {
  if (!name) return null;
  return list.find((v) => v.name === name) || null;
}

/**
 * 用浏览器语音播一句（Promise 化）。
 * 注意：切页/暂停时我们主动 `speechSynthesis.cancel()`，会以 `interrupted` / `canceled`
 * 触发 onerror —— 这属于「我们自己的取消」，按成功 resolve，由调用方用 token 判断要不要继续。
 */
export function speakUtterance(
  text: string,
  voice: SpeechSynthesisVoice | null,
  rate = 1,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const syn = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!syn) { reject(new Error('当前浏览器不支持语音合成')); return; }
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || 'zh-CN';
    u.rate = Math.max(0.5, Math.min(2, Number(rate) || 1));
    let settled = false;
    u.onend = () => { if (!settled) { settled = true; resolve(); } };
    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      if (settled) return;
      settled = true;
      const err = String((e && (e as any).error) || '');
      if (err === 'interrupted' || err === 'canceled') { resolve(); return; }
      reject(new Error(err || '浏览器语音合成失败'));
    };
    syn.speak(u);
  });
}
