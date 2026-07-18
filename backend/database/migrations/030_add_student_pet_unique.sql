-- 为 student_pets 添加唯一索引，防止同一学生重复领养同一宠物
-- 先删除可能存在的重复记录（保留最早的一条）
DELETE sp1 FROM student_pets sp1
INNER JOIN student_pets sp2
ON sp1.student_id = sp2.student_id
AND sp1.pet_id = sp2.pet_id
AND sp1.adopted_at > sp2.adopted_at;

-- 添加唯一索引
ALTER TABLE student_pets ADD UNIQUE INDEX IF NOT EXISTS idx_student_pet_unique (student_id, pet_id);
