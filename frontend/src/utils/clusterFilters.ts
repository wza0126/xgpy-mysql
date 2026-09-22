/**
 * AI 聚类筛选：DB 存储格式（tests.cluster_filters）的解析与匹配
 *
 * 存储格式（与 backend/database/migrations/084_add_test_cluster_filters.sql 一致）：
 *   [{ primary: '一级类目', secondary: '二级类目' }, { primary: '一级类目', secondary: '' }]
 *   secondary 为空串 = 该一级下全部题目（含只挂一级的题）。
 *
 * ⚠️ 匹配口径必须与后端 submit-test 里的 hitClusterFilter() 完全一致：
 *   前端负责抽题、服务端负责算分母，两套口径不一致就会出现
 *   「抽到的题不在所选类目里」或「分母与实抽题数对不上」。
 *   规则：一级按 primary 分组（组间 OR），组内若有指定二级则二级 OR；
 *         某一级只填了 primary（secondary 为空）→ 该一级下全收。
 */

export interface DbClusterFilter {
  primary: string;
  secondary: string;
}

/** 解析 tests.cluster_filters（兼容 JSON 字符串 / 已是数组 / null） */
export const parseDbClusterFilters = (raw: unknown): DbClusterFilter[] => {
  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c: any) => c && typeof c.primary === 'string' && c.primary)
    .map((c: any) => ({
      primary: c.primary,
      secondary: typeof c.secondary === 'string' ? c.secondary : '',
    }));
};

/** 某道题的 cluster_id 是否命中聚类筛选 */
export const matchDbClusterFilters = (
  clusterId: string | null | undefined,
  filters: DbClusterFilter[],
): boolean => {
  if (filters.length === 0) return true;
  if (!clusterId || typeof clusterId !== 'string') return false;
  const trimmed = clusterId.trim();
  if (!trimmed) return false;

  const idx = trimmed.indexOf('/');
  const primary = idx < 0 ? trimmed : trimmed.slice(0, idx).trim();
  const secondary = idx < 0 ? '' : trimmed.slice(idx + 1).trim();

  const primaries = new Set(filters.map((f) => f.primary));
  if (!primaries.has(primary)) return false;

  const secondaries = filters.filter((f) => f.primary === primary && f.secondary).map((f) => f.secondary);
  if (secondaries.length === 0) return true; // 该一级按整章筛 → 全收
  if (!secondary) return false;              // 题只挂一级，但筛选指定了二级 → 不命中
  return secondaries.includes(secondary);
};
