/**
 * 学情分析表格的排序工具（纯函数，便于独立验证；不依赖 React / DOM）
 *
 * 两张表：
 *  - 「学生详细数据」→ DetailSortKey / detailSortValue / sortStudentRows
 *  - 「章节掌握进度」→ MasterySortKey / masteryRate / sortMasteryRows
 */

/** 「学生详细数据」表可排序的字段 */
export type DetailSortKey =
  | 'label'
  | 'current_points'
  | 'max_points'
  | 'total_answers'
  | 'accuracy'
  | 'total_mastered'
  | 'pet_level';

export interface SortableStudent {
  username?: string | null;
  real_name?: string | null;
  current_points?: number | null;
  max_points?: number | null;
  total_answers?: number | null;
  accuracy?: number | null;
  total_mastered?: number | null;
  has_pet?: boolean;
  pet_level?: number | null;
}

/** 取某字段用于比较的值；账号 姓名按字符串比，其余按数字比（未领养萌宠视为最低） */
export function detailSortValue(s: SortableStudent, key: DetailSortKey): number | string {
  switch (key) {
    case 'label':
      // 「按姓名排序」实际按前面的账号排（同名同姓也能稳定区分）
      return String(s.username || s.real_name || '');
    case 'current_points':
      return s.current_points || 0;
    case 'max_points':
      return s.max_points || 0;
    case 'total_answers':
      return s.total_answers || 0;
    case 'accuracy':
      return s.accuracy || 0;
    case 'total_mastered':
      return s.total_mastered || 0;
    case 'pet_level':
      // 未领养记 -1：降序（最常用）时排在最后
      return s.has_pet ? s.pet_level || 0 : -1;
    default:
      return 0;
  }
}

/**
 * 按指定字段排序「学生详细数据」表。
 * 不改原数组；**同值时恒定按账号升序**（与升降序方向无关，保证表格可预期）。
 */
export function sortStudentRows<T extends SortableStudent>(
  list: T[],
  sort: { key: DetailSortKey; asc: boolean }
): T[] {
  const arr = list.slice();
  arr.sort((a, b) => {
    const va = detailSortValue(a, sort.key);
    const vb = detailSortValue(b, sort.key);
    let cmp: number;
    if (typeof va === 'string' || typeof vb === 'string') {
      cmp = String(va).localeCompare(String(vb));
    } else {
      cmp = (va as number) - (vb as number);
    }
    const primary = sort.asc ? cmp : -cmp;
    if (primary !== 0) return primary;
    return String(a.username || '').localeCompare(String(b.username || ''));
  });
  return arr;
}

/** 「章节掌握进度」表的排序方式 */
export type MasterySortKey = 'name' | 'mastered' | 'rate';

export interface SortableMasteryStudent {
  username?: string | null;
  real_name?: string | null;
  total_mastered?: number | null;
}

/** 掌握率（%）= 已掌握题数 ÷ 章节总题量（分母为 0 时返回 0） */
export function masteryRate(s: SortableMasteryStudent, totalQuestions: number): number {
  if (!(totalQuestions > 0)) return 0;
  return Math.round(((s.total_mastered || 0) / totalQuestions) * 100);
}

/** 按指定方式排序「章节掌握进度」表（不改原数组；同值时按账号稳定排序） */
export function sortMasteryRows<T extends SortableMasteryStudent>(
  list: T[],
  key: MasterySortKey,
  totalQuestions: number,
  onlyStarted = false
): T[] {
  const arr = (onlyStarted ? list.filter((s) => (s.total_mastered || 0) > 0) : list).slice();
  const byAccount = (a: T, b: T) =>
    String(a.username || a.real_name || '').localeCompare(String(b.username || b.real_name || ''));
  if (key === 'mastered') {
    arr.sort((a, b) => (b.total_mastered || 0) - (a.total_mastered || 0) || byAccount(a, b));
  } else if (key === 'rate') {
    arr.sort(
      (a, b) =>
        masteryRate(b, totalQuestions) - masteryRate(a, totalQuestions) ||
        (b.total_mastered || 0) - (a.total_mastered || 0) ||
        byAccount(a, b)
    );
  } else {
    arr.sort(byAccount);
  }
  return arr;
}
