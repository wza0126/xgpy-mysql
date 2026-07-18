ALTER TABLE exchange_records ADD COLUMN IF NOT EXISTS prize_name VARCHAR(200) NULL COMMENT '奖品名称（冗余存储，避免奖品被删除后无法显示）';

UPDATE exchange_records er
JOIN prizes p ON er.prize_id = p.id
SET er.prize_name = p.name
WHERE er.prize_name IS NULL OR er.prize_name = '';
