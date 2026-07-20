-- 课堂点名 - IP 绑定与登录限制
-- roll_call_seating 增加绑定的学生机 IP；classes 增加 IP 登录限制开关

ALTER TABLE roll_call_seating
ADD COLUMN IF NOT EXISTS bound_ip VARCHAR(45) DEFAULT NULL COMMENT '绑定的学生机IP';

ALTER TABLE classes
ADD COLUMN IF NOT EXISTS ip_login_restriction TINYINT(1) NOT NULL DEFAULT 0 COMMENT '开启后学生须从绑定IP登录';
