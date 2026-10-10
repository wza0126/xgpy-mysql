/**
 * 操作题题型判定（WPS / Access）
 * ============================================================
 * 操作题（type='wps_op' | 'access_op'）**不走普通作答链路**：
 *   · 没有 options / answers，普通练习 UI 渲染不了；
 *   · 判分是"传文件 → 服务端逐评分点判"，学生端入口 = 桌面「操作题」。
 *
 * ⛔ 因此凡"抽题池 / 题库浏览 / 试卷组卷"的地方都要把它们排除。
 *    以前只判 'wps_op'，加了 Access 之后**必须**改成用这里的 OPERATION_TYPES，
 *    否则 Access 操作题会漏进练习/测试/随堂习题里（页面渲染报错）。
 *
 * 服务端也有一层兜底（/api/tables/questions 对学生强制排除），但教师端接口不过那层，
 * 所以前端这一份仍然必须同步。
 */

export const OPERATION_TYPES = ['wps_op', 'access_op'] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

/** 是不是操作题（WPS / Access 任一） */
export function isOperationType(type?: string | null): boolean {
  return !!type && (OPERATION_TYPES as readonly string[]).includes(type);
}

/** 操作题的题型显示名 */
export function operationTypeLabel(type?: string | null): string {
  if (type === 'wps_op') return 'WPS操作题';
  if (type === 'access_op') return 'Access操作题';
  return '';
}
