-- 082: 勤学好问 Buff 规则变更
--
-- 【规则变更】原规则「学习模块当天看满 10 题」已彻底废弃，改为：
--   当天 AI 答疑**成功提问**满 N 次即触发（每日限一次）。
--   加成 / 时长仍沿用 honor_studious_buff_crit / honor_studious_buff_minutes。
--
-- 新增可配置项 honor_studious_questions：触发所需的成功提问次数（默认 10）。
--
-- system_config 结构：id / config_key(唯一) / value(JSON {"value":...}) / updated_at
-- 幂等：ON DUPLICATE KEY UPDATE 保证重复执行不报错，且不覆盖教师已改过的值。

INSERT INTO system_config (id, config_key, value, updated_at)
VALUES ('config_honor_studious_questions', 'honor_studious_questions', '{"value": 10}', NOW())
ON DUPLICATE KEY UPDATE config_key = config_key;
