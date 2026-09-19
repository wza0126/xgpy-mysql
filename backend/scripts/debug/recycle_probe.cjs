/**
 * 只读诊断：解析 D 盘回收站中的 .xgpybak 元数据（原始路径/大小/删除时间）
 * 用于复盘"某次导入用的是哪个包"，不修改任何文件。
 */
const fs = require('fs');
const path = require('path');

const RECYCLE_DIR = 'D:\\$RECYCLE.BIN\\S-1-5-21-3134716550-3442111575-1948537162-1001';

function parseItem(dir, f) {
  const b = fs.readFileSync(path.join(dir, f));
  const size = Number(b.readBigUInt64LE(8));
  const ft = b.readBigUInt64LE(16);
  const ms = Number(ft / 10000n) - 11644473600000;
  const nameLen = b.readUInt32LE(24);
  const name = b.toString('utf16le', 28, 28 + nameLen * 2).replace(/\0+$/, '');
  return { meta: f, size, ms, name, body: '$R' + f.slice(2) };
}

const items = fs.readdirSync(RECYCLE_DIR)
  .filter(f => /^\$I.*\.xgpybak$/.test(f))
  .map(f => parseItem(RECYCLE_DIR, f));

items.sort((a, b) => b.ms - a.ms);

console.log('=== 回收站中的 .xgpybak（按删除时间倒序）===');
for (const o of items.slice(0, 30)) {
  const bodyExists = fs.existsSync(path.join(RECYCLE_DIR, o.body));
  console.log(
    new Date(o.ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    '|', (o.size / 1048576).toFixed(1) + 'MB',
    '| 实体' + (bodyExists ? '在' : '无'),
    '|', o.name,
    '|', o.body
  );
}
console.log('合计:', items.length, '个');
