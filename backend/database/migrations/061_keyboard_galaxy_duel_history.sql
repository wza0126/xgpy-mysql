-- 键盘星域：双人战绩表增加桌号字段（用于教师端历史对战记录展示）
-- 旧记录无桌号，显示为 '—'，不影响新对局
ALTER TABLE typing_duel_records ADD COLUMN IF NOT EXISTS table_no INT DEFAULT NULL COMMENT '桌号';
