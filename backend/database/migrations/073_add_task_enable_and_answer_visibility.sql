-- 备课工作台：课堂任务启用/停止开关 + 随堂练习答案解析可见性开关
-- is_active：任务是否启用。停止后学生端「课堂任务」列表不再显示该任务，教师端仍可管理
-- show_answer：学生提交随堂练习后是否可查看「解析」与「正确答案」
-- 创建时间: 2026-09-15

ALTER TABLE task_class
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '是否启用：0停止（学生端不显示）/1启用'
    AFTER status,
  ADD COLUMN IF NOT EXISTS show_answer TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '完成随堂练习后是否可查看解析与正确答案：0隐藏/1显示'
    AFTER pass_reward_points;
