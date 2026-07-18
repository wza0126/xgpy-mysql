-- 为 system_license 表设置初始试用期到期时间
-- 创建时间: 2026-06-24
-- 说明: 设置默认试用期到 2027-06-01，确保所有系统都有正确的初始到期时间

-- 更新默认记录，设置试用期到期时间为 2027-06-01
-- 仅在 is_activated = FALSE 且 expires_at 为 NULL 时更新，避免覆盖已有激活数据
UPDATE system_license 
SET expires_at = '2027-06-01 00:00:00' 
WHERE id = 1 
  AND is_activated = FALSE 
  AND expires_at IS NULL;
