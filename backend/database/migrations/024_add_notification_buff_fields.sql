-- 通知系统添加Buff支持
-- 允许教师在发送通知时附带临时暴击率Buff

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS has_buff BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否附带buff',
  ADD COLUMN IF NOT EXISTS buff_type VARCHAR(50) DEFAULT NULL COMMENT 'Buff类型: teacher_crit/teacher_debuff',
  ADD COLUMN IF NOT EXISTS buff_modifier DECIMAL(5,2) DEFAULT NULL COMMENT '暴击率修正值(%)',
  ADD COLUMN IF NOT EXISTS buff_duration INT DEFAULT NULL COMMENT 'Buff持续时间(分钟)';
