-- 键盘星域：双人对战赛制与奖励升级
-- 1. 房间表增加 WPM 记录（分数相同时按 WPM 判定胜负）
ALTER TABLE typing_rooms
  ADD COLUMN p1_wpm INT NOT NULL DEFAULT 0 COMMENT '左座WPM',
  ADD COLUMN p2_wpm INT NOT NULL DEFAULT 0 COMMENT '右座WPM';

-- 2. 更新应用默认配置：赛制时长、双人速度密度基准、入座门槛、奖励档位
UPDATE apps SET config = JSON_OBJECT(
  'tables', 6,
  'difficulty', 'standard',
  'duel_seconds', 180,
  'duel_speed', 85,
  'duel_spawn_ms', 1800,
  'duel_step_pct', 20,
  'duel_min_wpm', 40,
  'rewards', JSON_ARRAY(
    JSON_OBJECT('score', 150, 'points', 20, 'equipment_id', ''),
    JSON_OBJECT('score', 300, 'points', 50, 'equipment_id', '')
  )
) WHERE id = 'app_typing_trainer';
