/**
 * 题目展示数据的归一化工具
 *
 * 背景：`questions.options` / `questions.answers` 在库里存的是**包裹对象**，不是裸数组：
 *   options = {"options":["A. 变量值可修改","B. 变量使用前必须赋值"]}
 *   answers = {"answers":["C"]}        或  {"answers":["a,b=b,a"]}
 *
 * 若不做拆包，直接渲染会得到：
 *   - 选项：空数组 → 界面显示「本题无选项」
 *   - 答案：`String({...})` → 显示 "[object Object]"
 *
 * 这些口径同时被「教师端 PK 高频错题榜」(PKStatsTab) 与「学生端 PK 结算逐题复盘」
 * (PKResult) 使用，故抽到此处作为**唯一实现**，避免多份副本漂移。
 */

export interface NormalizedOption {
  key: string;
  text: string;
}

/** 选项自带的前缀，如 "A. " / "B、" / "C．" / "D:" / "A)" */
const OPTION_PREFIX_RE = /^\s*([A-Za-z])[.、．:：)]\s*/;

/**
 * 把后端下发的选项统一成 `[{key,text}]`。
 * 兼容：包裹对象 `{options:[...]}` / 裸数组 / JSON 字符串 / `[{label,text}]` / `['A. 文字']`
 */
export const normalizeOptions = (raw: unknown): NormalizedOption[] => {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof arr === 'string') {
    const s = arr;
    try {
      arr = JSON.parse(s);
    } catch {
      return [{ key: '', text: s }];
    }
  }
  // 拆包：{options:[...]} / {items:[...]} / {data:[...]} 等包裹对象
  if (arr && !Array.isArray(arr) && typeof arr === 'object') {
    const o = arr as Record<string, unknown>;
    const inner = o.options ?? o.items ?? o.data ?? o.list ?? o.choices;
    if (inner !== undefined) arr = inner;
  }
  if (typeof arr === 'string') {
    // 拆包后仍是 JSON 字符串（双重编码）
    const s = arr;
    try {
      arr = JSON.parse(s);
    } catch {
      return [{ key: '', text: s }];
    }
  }
  if (Array.isArray(arr)) {
    return arr.map((item, i) => {
      if (typeof item === 'string') {
        // 库里的选项常自带前缀（"A. 变量值可修改"）——剥掉，
        // 否则页面上 key 再拼一次会显示成「A. A. 变量值可修改」。
        const keyMatch = item.match(OPTION_PREFIX_RE);
        return {
          key: keyMatch ? keyMatch[1].toUpperCase() : String.fromCharCode(65 + i),
          text: item.replace(OPTION_PREFIX_RE, ''),
        };
      }
      const o = (item || {}) as Record<string, unknown>;
      const key = String(o.label ?? o.key ?? o.option ?? String.fromCharCode(65 + i));
      const rawText = String(o.text ?? o.content ?? o.value ?? '');
      const text = rawText.replace(
        new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.、．:：)]\\s*`),
        ''
      );
      return { key, text };
    });
  }
  return [];
};

/**
 * 把正确答案统一成字符串数组。
 * 兼容：包裹对象 `{answers:[...]}` / 裸数组 / JSON 字符串 / `"A,B"` / 纯字符串 / `[{text}]`
 */
export const normalizeAnswers = (raw: unknown): string[] => {
  if (raw == null) return [];
  let v: unknown = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      // 普通字符串：可能是 "A" 或 "A,B" 或 "AB"
      return String(raw).split(/[,，\s]+/).filter(Boolean);
    }
  }
  // 拆包：后端 questions.answers 同样存包裹对象 `{"answers":["C"]}`，
  // 不拆包会直接把对象 String() 成 "[object Object]"。
  if (v && !Array.isArray(v) && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const inner = o.answers ?? o.answer ?? o.items ?? o.data ?? o.value;
    if (inner !== undefined) v = inner;
  }
  if (typeof v === 'string') {
    return v.split(/[,，\s]+/).filter(Boolean);
  }
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x == null) return '';
        if (typeof x === 'object') {
          const o = x as Record<string, unknown>;
          return String(o.text ?? o.value ?? o.key ?? o.label ?? '');
        }
        return String(x);
      })
      .filter(Boolean);
  }
  return [String(v)];
};

/** 题型 → 中文标签 */
export const questionTypeLabel = (type: string | null | undefined): string => {
  switch (type) {
    case 'choice':
      return '选择题';
    case 'judge':
      return '判断题';
    case 'fill':
    case 'fill_blank':
      return '填空题';
    default:
      return type || '题目';
  }
};
