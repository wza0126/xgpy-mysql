-- 学习模块「已看记录」加固（v2.5.2）
--
-- 背景：learn_visited_records.question_key 原为 VARCHAR(50)，注释写明格式是
--       "sectionIndex-questionIndex"（如 "0-0"、"13-0"）。
--       学习模块改版后（v2.5.0）键格式变为 `章名::selftest::序号`
--       （如 "信息系统的支撑技术::selftest::12"），最长可达 40+ 字符；
--       将来若章名变长或增加段位，极易超过 50 被 MySQL **静默截断**（非严格模式）
--       或直接报错（严格模式），导致进度记录丢失且难以排查。
--
-- 本次改动：
--   1) 加宽 question_key 到 VARCHAR(80)，留足余量；
--   2) 补一条格式说明注释，避免后来者再按老格式写入。
--
-- 注：历史脏数据（老格式 "0-0" / "py-0-0"）的清理与迁移见 083 同批的
--     scripts/debug/migrate_learn_visited_keys.cjs（不在迁移里做，因为需要 JS 逻辑映射章名）。
ALTER TABLE `learn_visited_records`
  MODIFY COLUMN `question_key` VARCHAR(80) NOT NULL
  COMMENT '问题唯一标识；当前格式 "章名::selftest::序号"（历史格式 "sectionIndex-questionIndex" / "模块-节-题"）';
