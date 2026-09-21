import React from 'react';

/**
 * AI 聚类筛选器（可复用）
 *
 * 口径与 ExamManager 完全一致：
 *   - cluster_id 形如 "一级类目/二级类目"，无斜杠时只有一级；
 *   - 一级之间是 OR，二级之间是 OR；
 *   - 只选一级 → 命中该一级下的全部题目（含仅挂一级的题）；
 *   - 选了二级 → 必须精确命中该 "一级/二级"。
 *
 * 用法：把 cluster_id 列表传进来，组件内部自建一棵树并维护选中态，
 * 通过 onChange 把 (一级选中[], 二级选中[]) 回吐给父组件。
 */

export type ClusterTree = Record<string, Set<string>>;

/** 把 cluster_id 拆成 [一级, 二级]；无斜杠时二级为空串 */
export const splitCluster = (clusterId: string | null | undefined): [string, string] | null => {
  if (!clusterId || typeof clusterId !== 'string') return null;
  const trimmed = clusterId.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf('/');
  if (idx < 0) return [trimmed, ''];
  const primary = trimmed.slice(0, idx).trim();
  const secondary = trimmed.slice(idx + 1).trim();
  return primary ? [primary, secondary] : null;
};

/** 从 cluster_id 列表构建 一级 → 二级集合 的树（已排序） */
export const buildClusterTree = (clusterIds: (string | null | undefined)[]): ClusterTree => {
  const raw: ClusterTree = {};
  clusterIds.forEach((cid) => {
    const parts = splitCluster(cid);
    if (!parts) return;
    const [primary, secondary] = parts;
    if (!raw[primary]) raw[primary] = new Set();
    if (secondary) raw[primary].add(secondary);
  });
  const sorted: ClusterTree = {};
  Object.keys(raw).sort().forEach((p) => {
    sorted[p] = new Set(Array.from(raw[p]).sort());
  });
  return sorted;
};

/** 判断某道题的 cluster_id 是否命中当前选中条件（与 ExamManager 逻辑保持一致） */
export const matchClusterFilter = (
  clusterId: string | null | undefined,
  selectedPrimary: string[],
  selectedSecondary: string[],
): boolean => {
  if (selectedPrimary.length === 0 && selectedSecondary.length === 0) return true;
  const parts = splitCluster(clusterId);
  if (!parts) return false;
  const [primary, secondary] = parts;
  if (selectedPrimary.length > 0 && !selectedPrimary.includes(primary)) return false;
  if (selectedSecondary.length > 0) {
    if (!secondary) return false;
    return selectedSecondary.includes(`${primary}/${secondary}`);
  }
  return true;
};

interface ClusterFilterProps {
  /** 参与筛选的 cluster_id 集合（通常是当前可用于考试的题目） */
  clusterTree: ClusterTree;
  selectedPrimary: string[];
  selectedSecondary: string[];
  onChange: (primary: string[], secondary: string[]) => void;
  /** 左侧标题，默认「AI 聚类筛选」 */
  label?: string;
  /** 每块高度上限（px），默认 130 / 150 */
  primaryMaxHeight?: number;
  secondaryMaxHeight?: number;
  /** 紧凑模式：用于侧栏 */
  compact?: boolean;
}

export const ClusterFilter: React.FC<ClusterFilterProps> = ({
  clusterTree,
  selectedPrimary,
  selectedSecondary,
  onChange,
  label = 'AI 聚类筛选',
  primaryMaxHeight = 130,
  secondaryMaxHeight = 150,
  compact = false,
}) => {
  const primaries = Object.keys(clusterTree);
  if (primaries.length === 0) return null;

  const togglePrimary = (primary: string) => {
    if (selectedPrimary.includes(primary)) {
      const prefix = `${primary}/`;
      onChange(
        selectedPrimary.filter((p) => p !== primary),
        selectedSecondary.filter((s) => !s.startsWith(prefix)),
      );
    } else {
      onChange([...selectedPrimary, primary], selectedSecondary);
    }
  };

  const toggleSecondary = (fullKey: string) => {
    onChange(
      selectedPrimary,
      selectedSecondary.includes(fullKey)
        ? selectedSecondary.filter((s) => s !== fullKey)
        : [...selectedSecondary, fullKey],
    );
  };

  // 已选一级下的二级列表（去重）
  const secondaryList: { fullKey: string; label: string }[] = [];
  const seen = new Set<string>();
  selectedPrimary.forEach((p) => {
    Array.from(clusterTree[p] || []).forEach((s) => {
      const fullKey = `${p}/${s}`;
      if (seen.has(fullKey)) return;
      seen.add(fullKey);
      secondaryList.push({ fullKey, label: s });
    });
  });

  const btnCls = compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';

  return (
    <div>
      <p className="text-sm text-gray-600 mb-2">
        {label}：
        {(selectedPrimary.length > 0 || selectedSecondary.length > 0) && (
          <span className="ml-2 text-violet-600">
            一级 {selectedPrimary.length} / 二级 {selectedSecondary.length}
          </span>
        )}
      </p>
      <div className="space-y-3">
        <div className="border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-500 mb-2 font-semibold">一级类目</div>
          <div
            className="flex flex-wrap gap-1.5 overflow-y-auto pr-1"
            style={{ maxHeight: primaryMaxHeight }}
          >
            {primaries.map((primary) => {
              const active = selectedPrimary.includes(primary);
              const secondaryCount = (clusterTree[primary] || new Set()).size;
              return (
                <button
                  key={primary}
                  type="button"
                  onClick={() => togglePrimary(primary)}
                  className={`${btnCls} rounded-full transition-all ${
                    active
                      ? 'bg-violet-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  title={secondaryCount > 0 ? `${secondaryCount} 个二级类目` : '仅一级'}
                >
                  {primary}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-3">
          <div className="text-xs text-gray-500 mb-2 font-semibold">
            二级类目
            <span className="ml-1 text-gray-400">
              {selectedPrimary.length === 0 ? '（先选一级）' : '（已选一级下）'}
            </span>
          </div>
          <div
            className="flex flex-wrap gap-1.5 min-h-[32px] overflow-y-auto pr-1"
            style={{ maxHeight: secondaryMaxHeight }}
          >
            {selectedPrimary.length === 0 ? (
              <span className="text-xs text-gray-400 self-center">未选一级类目</span>
            ) : secondaryList.length === 0 ? (
              <span className="text-xs text-gray-400 self-center">所选一级下无二级类目</span>
            ) : (
              secondaryList.map((item) => {
                const active = selectedSecondary.includes(item.fullKey);
                return (
                  <button
                    key={item.fullKey}
                    type="button"
                    onClick={() => toggleSecondary(item.fullKey)}
                    className={`${btnCls} rounded-full transition-all ${
                      active
                        ? 'bg-indigo-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
      {(selectedPrimary.length > 0 || selectedSecondary.length > 0) && (
        <button
          type="button"
          onClick={() => onChange([], [])}
          className="mt-2 text-xs text-gray-500 hover:text-gray-700"
        >
          清除聚类筛选
        </button>
      )}
    </div>
  );
};
