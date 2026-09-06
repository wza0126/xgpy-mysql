-- 班级级 "Python 编程" 快捷开关（与应用中心/兑换/上网开关同模式）
-- classes.python_enabled：班级是否允许该班学生使用桌面 Python 编程模块
-- profiles.python_enabled：同步到学生个人，学生端双击/已打开窗口据此拦截与关闭
-- 创建时间: 2026-09-06

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS python_enabled TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '是否允许该班级学生使用Python编程（同步 profiles.python_enabled）';

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS python_enabled TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '是否允许使用Python编程（由班级快捷开关同步）';

-- 存量学生行按所在班级补齐一次（默认均为 1；若个别班级历史已设为 0 则一并同步）
UPDATE profiles p
  JOIN classes c ON p.class_id = c.id
SET p.python_enabled = c.python_enabled
WHERE p.role = 'student' AND p.python_enabled <> c.python_enabled;
