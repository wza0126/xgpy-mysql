/**
 * 练习池口径（唯一来源，2026-11-11）
 *
 * 「已掌握题数」必须在**当前允许练习的题目集合**里数：
 * 题池会随老师开关 practice_enabled 变化（比如 1000 → 800），
 * 若掌握数按历史做过的题算，就会出现「已掌握 1000 / 可练 800」这种不协调。
 *
 * 两个形态：
 *   · SQL_PRACTICE_SCOPE —— 裸列名，拼在 `WHERE practice_enabled = 1 AND cluster_id ...` 之后
 *   · PRACTICE_POOL_ON_Q —— 带 q. 前缀，专供 `JOIN questions q` 的统计 SQL
 *
 * ⛔ 任何「已掌握 / 掌握率 / 掌握数」的统计都必须引用这里，不要各自手写条件。
 *    2026-11-11 之前 index.js 与 ai-analysis.js 就各写了一份，一个排除 composite、一个没排除，
 *    同一份数据在不同页面差 30 题。
 */
const SQL_PRACTICE_SCOPE = " AND type NOT IN ('wps_op','access_op','composite')";

const PRACTICE_POOL_ON_Q = "q.practice_enabled = 1 AND q.cluster_id IS NOT NULL AND q.cluster_id <> '' AND q.type NOT IN ('wps_op','access_op','composite')";

module.exports = { SQL_PRACTICE_SCOPE, PRACTICE_POOL_ON_Q };
