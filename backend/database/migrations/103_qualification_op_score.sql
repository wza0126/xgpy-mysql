-- 普通测试 / 试卷PK 资格验证新增两项：WPS 操作题累计得分、Access 操作题累计得分
--
-- 口径与「任务中心 → 成就殿堂 → 累计操作题得分」**完全一致**（同一个指标 total_op_score，
-- 见 src/game-task-metrics.js 的 getOpScore）：
--   SUM(wps_op_submissions.score_obtained) WHERE student_id=? AND kind=?
--   kind = 'wps'（WPS 操作题）/ 'access'（Access 操作题）
--
-- 两项与原有的「做对题数」「已掌握题数」是 **AND 关系**：四项同时满足才可参加。
-- 任一阈值为 NULL / 0 即视为该条件不启用（不影响通过）。
--
-- 与迁移 085 的写法保持一致：两张表各自加同名列。
ALTER TABLE `tests`
ADD COLUMN IF NOT EXISTS `qualification_wps_op_score` INT DEFAULT NULL COMMENT '所需 WPS 操作题累计得分，NULL表示不限制',
ADD COLUMN IF NOT EXISTS `qualification_access_op_score` INT DEFAULT NULL COMMENT '所需 Access 操作题累计得分，NULL表示不限制';

ALTER TABLE `pk_battle_configs`
ADD COLUMN IF NOT EXISTS `qualification_wps_op_score` INT DEFAULT NULL COMMENT '所需 WPS 操作题累计得分，NULL表示不限制',
ADD COLUMN IF NOT EXISTS `qualification_access_op_score` INT DEFAULT NULL COMMENT '所需 Access 操作题累计得分，NULL表示不限制';
