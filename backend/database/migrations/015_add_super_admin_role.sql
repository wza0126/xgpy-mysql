-- 添加超级管理员角色到 profiles 表的 role 字段
ALTER TABLE profiles MODIFY COLUMN role ENUM('student', 'teacher', 'super_admin') NOT NULL DEFAULT 'student';
