-- 102_dedup_student_pets.sql
-- 清理「一个学生多条宠物行」的脏数据，并给 student_pets 加上「一人一行」的唯一约束。
--
-- 背景（2026-10-14 实测）：
--   · 老师明确口径：**领养概念已废除**，新学生账号启用时**自动随机选一只**；
--     宠物等级是**学生级的唯一值**（不存在「几只不同等级的宠物」，所有宠物等级一样），
--     只有「形态」（想显示第几阶段的形状）是按宠物选的，存在 display_level 列。
--   · 但历史上「没有就随机插一只」的逻辑**散落在两处** ——
--     frontend/src/components/student/PetModule.tsx 的 fetchData 与
--     frontend/src/components/common/DesktopPet.tsx 的 fetchPetData，
--     桌面宠物先挂载、萌宠窗口后打开时两者并发，各插一行（随机挑的 pet_id 不同，
--     所以并不违反既有的 idx_student_pet_unique(student_id, pet_id)）。
--   · 实测：7 个养宠学生里 **3 人中招，共 11 行**（应为 7 行）。
--   · 这两处已改成调用幂等端点 POST /api/business/ensure-pet，
--     本迁移负责：① 清掉既有脏数据；② 用数据库约束兜底，杜绝再犯。
--
-- ⚠️ 影响说明（务必知情）：
--   新增的 `uk_student_pet (student_id)` 表示**一个学生只能有一只宠物**。
--   schema 早先留下过 UNIQUE(student_id, pet_id)（允许多宠），
--   但当前产品口径是「一人一只、换养走 删除+插入」，
--   所以这里收紧为 UNIQUE(student_id)；将来若要支持「同时养多只」，
--   必须先 DROP 掉 uk_student_pet。
--
-- 去重保留规则：等级最高 → adopted_at 最早 → id 最小（即最早那只、且不带错等级）。
-- 幂等：二次执行删不到任何行；索引已存在时迁移器会跳过（ADD UNIQUE INDEX IF NOT EXISTS 由 migrate.js 翻译）。

-- 1) 去重：删除「存在更优同学生行」的所有多余行
DELETE sp FROM `student_pets` sp
  JOIN `student_pets` keep
    ON keep.`student_id` = sp.`student_id`
   AND (
        keep.`growth_level` > sp.`growth_level`
     OR (keep.`growth_level` = sp.`growth_level`
         AND IFNULL(keep.`adopted_at`, '9999-12-31 00:00:00') < IFNULL(sp.`adopted_at`, '9999-12-31 00:00:00'))
     OR (keep.`growth_level` = sp.`growth_level`
         AND IFNULL(keep.`adopted_at`, '9999-12-31 00:00:00') = IFNULL(sp.`adopted_at`, '9999-12-31 00:00:00')
         AND keep.`id` < sp.`id`)
   );

-- 2) 唯一约束：一人一行（缺省时记 1 行；NULL 不受唯一约束限制，student_id 非空即可）
ALTER TABLE `student_pets` ADD UNIQUE INDEX IF NOT EXISTS `uk_student_pet` (`student_id`);
