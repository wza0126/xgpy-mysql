/**
 * AI 语音讲解 · 连续讲解选题（错题排行「讲未讲解 · 前 20」）
 * ============================================================
 * ⛔ 综合题（type='composite'）**不进连续讲解**：
 *    一道大题里套好几个小题（往往还是不同知识点），分镜结构装不下，
 *    模型要么讲成一锅粥、要么只讲第一小题，学生听完更糊。
 *    操作题（wps_op / access_op）同理——没有选项可辨析，讲也讲不清。
 *    老师想讲这两类，可以在列表里勾选后走「讲勾选的」单独讲。
 *
 * ⛔ 过滤必须发生在 **截断到 20 之前**：
 *    先取前 20 再筛，会白白占掉名额（20 个里 5 个是综合题 → 实际只讲 15 道）。
 *
 * 抽成独立纯函数是为了能在回归脚本里直接喂构造数据断言（见
 * backend/scripts/debug/verify_wrong_type_filter.cjs）。
 */

import { isOperationType } from './questionType';

/** 不适合语音讲解的题型（连续讲解时自动跳过） */
export const NON_EXPLAINABLE_TYPES = ['composite'] as const;

export interface ExplainQueueCandidate {
  question_id: string;
  type?: string | null;
  wrong_count?: number | string | null;
  total_attempts?: number | string | null;
}

export interface PickExplainQueueResult {
  ids: string[];
  /** 因题型被跳过的题数（= 综合题 + 操作题） */
  skipped: number;
  skippedComposite: number;
  skippedOperation: number;
}

/** 综合题或操作题 → 不适合语音讲解 */
export function isNonExplainable(type?: string | null): boolean {
  if (!type) return false;
  if ((NON_EXPLAINABLE_TYPES as readonly string[]).includes(type)) return true;
  return isOperationType(type);
}

/**
 * 从「未讲解」错题里挑前 N 道连续讲。
 * @param items 后端 /wrong-questions?filter=unexplained&pageSize=100 返回的条目
 * @param mode  wrong=按错误次数（并列时看错误率）；rate=按错误率（并列时看错误次数）
 * @param limit 取多少道，默认 20
 */
export function pickExplainQueue(
  items: ExplainQueueCandidate[] | null | undefined,
  mode: 'wrong' | 'rate',
  limit = 20,
): PickExplainQueueResult {
  let skippedComposite = 0;
  let skippedOperation = 0;
  const scored: { id: string; wrong: number; rate: number }[] = [];

  for (const it of items || []) {
    if (!it || !it.question_id) continue;
    if (it.type === 'composite') {
      skippedComposite++;
      continue;
    }
    if (isOperationType(it.type)) {
      skippedOperation++;
      continue;
    }
    const wrong = Number(it.wrong_count) || 0;
    const attempts = Number(it.total_attempts) || 0;
    scored.push({ id: it.question_id, wrong, rate: attempts > 0 ? wrong / attempts : 0 });
  }

  scored.sort(
    mode === 'rate'
      ? (a, b) => b.rate - a.rate || b.wrong - a.wrong
      : (a, b) => b.wrong - a.wrong || b.rate - a.rate,
  );

  return {
    ids: scored.slice(0, Math.max(1, limit)).map((x) => x.id),
    skipped: skippedComposite + skippedOperation,
    skippedComposite,
    skippedOperation,
  };
}
