// 键盘星域 · 共享数据（词表 / 键位 / 随机序列）
import { KEYWORDS } from '../code-realm/CodeRealmData';

export interface GalaxyWord {
  id: string;
  text: string;          // 输入文本（小写）
  zh: string;            // 中文释义
  type: 'keyword' | 'builtin';
  chapter: number;
}

// 36 项词表：与代码秘境完全一致
export const GALAXY_WORDS: GalaxyWord[] = KEYWORDS.map(k => ({
  id: k.id,
  text: k.name.replace(/[()]/g, ''),
  zh: k.desc,
  type: k.type,
  chapter: k.chapter,
}));

// ==================== 指法分区 ====================
export type Finger = 'lp' | 'lr' | 'lm' | 'li' | 'ri' | 'rm' | 'rr' | 'rp' | 'thumb';

export const FINGER_LABEL: Record<Finger, string> = {
  lp: '左手小指', lr: '左手无名指', lm: '左手中指', li: '左手食指',
  ri: '右手食指', rm: '右手中指', rr: '右手无名指', rp: '右手小指', thumb: '拇指',
};

export const FINGER_COLOR: Record<Finger, string> = {
  lp: '#4d6bd9', lr: '#3f9bd9', lm: '#d98f3f', li: '#5bc269',
  ri: '#5bc269', rm: '#d98f3f', rr: '#3f9bd9', rp: '#4d6bd9', thumb: '#b06bd9',
};

export const FINGER_CLASS: Record<Finger, string> = {
  lp: 'k-pinky', lr: 'k-ring', lm: 'k-mid', li: 'k-index',
  ri: 'k-index-r', rm: 'k-mid-r', rr: 'k-ring-r', rp: 'k-pinky-r', thumb: 'k-thumb',
};

// 单字符 → 手指（标准盲打指法）
const FINGER_OF_CHAR: Record<string, Finger> = {
  '`': 'lp', '1': 'lp', 'q': 'lp', 'a': 'lp', 'z': 'lp',
  '2': 'lr', 'w': 'lr', 's': 'lr', 'x': 'lr',
  '3': 'lm', 'e': 'lm', 'd': 'lm', 'c': 'lm',
  '4': 'li', '5': 'li', 'r': 'li', 't': 'li', 'f': 'li', 'g': 'li', 'v': 'li', 'b': 'li',
  '6': 'ri', '7': 'ri', 'y': 'ri', 'u': 'ri', 'h': 'ri', 'j': 'ri', 'n': 'ri', 'm': 'ri',
  '8': 'rm', 'i': 'rm', 'k': 'rm', ',': 'rm',
  '9': 'rr', 'o': 'rr', 'l': 'rr', '.': 'rr',
  '0': 'rp', 'p': 'rp', ';': 'rp', '/': 'rp', '-': 'rp', '[': 'rp', ']': 'rp', "'": 'rp', '=': 'rp',
  ' ': 'thumb',
};

export function fingerOfChar(ch: string): Finger {
  return FINGER_OF_CHAR[ch.toLowerCase()] || 'lp';
}

// 单词 → 下一字符提示的手指（用于键位图高亮）
export function fingerOfNext(text: string, typed: number): Finger | null {
  const ch = text[typed];
  if (!ch) return null;
  return fingerOfChar(ch);
}

// ==================== 3D 键位布局 ====================
export interface KeyDef {
  label: string;
  finger: Finger;
  width?: number;
  home?: boolean;   // f/j 基准键凸点
}

export const KEY_ROWS: KeyDef[][] = [
  [
    { label: '`', finger: 'lp' }, { label: '1', finger: 'lp' }, { label: '2', finger: 'lr' },
    { label: '3', finger: 'lm' }, { label: '4', finger: 'li' }, { label: '5', finger: 'li' },
    { label: '6', finger: 'ri' }, { label: '7', finger: 'ri' }, { label: '8', finger: 'rm' },
    { label: '9', finger: 'rr' }, { label: '0', finger: 'rp' }, { label: '-', finger: 'rp' },
    { label: '=', finger: 'rp', width: 1.6 },
  ],
  [
    { label: 'q', finger: 'lp' }, { label: 'w', finger: 'lr' }, { label: 'e', finger: 'lm' },
    { label: 'r', finger: 'li' }, { label: 't', finger: 'li' }, { label: 'y', finger: 'ri' },
    { label: 'u', finger: 'ri' }, { label: 'i', finger: 'rm' }, { label: 'o', finger: 'rr' },
    { label: 'p', finger: 'rp' }, { label: '[', finger: 'rp' }, { label: ']', finger: 'rp' },
  ],
  [
    { label: 'a', finger: 'lp' }, { label: 's', finger: 'lr' }, { label: 'd', finger: 'lm' },
    { label: 'f', finger: 'li', home: true }, { label: 'g', finger: 'li' },
    { label: 'h', finger: 'ri' }, { label: 'j', finger: 'ri', home: true }, { label: 'k', finger: 'rm' },
    { label: 'l', finger: 'rr' }, { label: ';', finger: 'rp' }, { label: "'", finger: 'rp' },
  ],
  [
    { label: 'z', finger: 'lp' }, { label: 'x', finger: 'lr' }, { label: 'c', finger: 'lm' },
    { label: 'v', finger: 'li' }, { label: 'b', finger: 'li' }, { label: 'n', finger: 'ri' },
    { label: 'm', finger: 'ri' }, { label: ',', finger: 'rm' }, { label: '.', finger: 'rr' },
    { label: '/', finger: 'rp' },
  ],
  [
    { label: 'Space', finger: 'thumb', width: 5 },
  ],
];

// ==================== 可复现随机（双人同词序） ====================
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: T[], seed: string): T[] {
  const rand = seededRandom(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
