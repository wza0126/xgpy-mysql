/**
 * 登录故障只读自检（diagnose_login.cjs）
 *
 * 用途：判断"导入成功但登录不了"到底属于哪一种：
 *   甲、当前连接的库里没有可登录账号（如空库/新库）
 *   乙、导入的备份包本身不含账号域（profiles/classes/user_roles）
 *   丙、备份包含账号域但 profiles 是 0 行（覆盖导入会把目标库账号清空）
 *
 * 全程只读，不写任何数据、不改任何文件。
 *
 * 用法：
 *   1) 看备份包：
 *      node scripts/debug/diagnose_login.cjs --pkg "D:\path\to\xxx.xgpybak"
 *   2) 看当前 .env 指向的库：
 *      node scripts/debug/diagnose_login.cjs
 *   3) 看其它库（不改 .env）：
 *      DB_HOST=127.0.0.1 DB_NAME=xgpy_test node scripts/debug/diagnose_login.cjs
 */
const fs = require('fs');
const path = require('path');

// ---- 读取 .env（优先 backend/.env，其次根目录 .env）----
function loadEnv() {
  const candidates = [
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '..', '..', '.env'),
  ];
  const out = {};
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    break;
  }
  return out;
}

async function inspectPackage(pkgPath) {
  const yauzl = require('yauzl');
  console.log('\n================ 备份包检查 ================');
  console.log('包路径:', pkgPath);
  if (!fs.existsSync(pkgPath)) { console.log('✘ 文件不存在'); return; }
  console.log('包大小:', (fs.statSync(pkgPath).size / 1048576).toFixed(1) + 'MB');

  return new Promise((resolve) => {
    yauzl.open(pkgPath, { lazyEntries: true }, (err, zip) => {
      if (err) { console.log('✘ 打不开:', err.message); return resolve(); }
      const dataFiles = [];
      let manifest = null;
      zip.readEntry();
      zip.on('entry', (en) => {
        if (en.fileName === 'manifest.json') {
          zip.openReadStream(en, (e2, rs) => {
            const b = [];
            rs.on('data', d => b.push(d));
            rs.on('end', () => {
              try { manifest = JSON.parse(Buffer.concat(b).toString('utf8')); } catch { /* ignore */ }
              zip.readEntry();
            });
          });
        } else {
          if (en.fileName.startsWith('data/') && en.uncompressedSize > 0) dataFiles.push(en.fileName);
          zip.readEntry();
        }
      });
      zip.on('end', () => {
        if (!manifest) { console.log('✘ 包内没有 manifest.json，不是有效的 .xgpybak'); return resolve(); }
        console.log('格式:', manifest.format, '| 平台版本:', manifest.platform_version, '| 文件模式:', manifest.file_mode);
        console.log('导出时间:', manifest.exported_at);
        const domains = manifest.domains || [];
        console.log('包内数据域数量:', domains.length, '| data/*.json 条目:', dataFiles.length);
        let accountsDomain = null;
        let profilesRows = null;
        for (const d of domains) {
          const tables = d.tables || [];
          const rows = tables.reduce((s, t) => s + (t.rows || 0), 0);
          console.log(`  · ${d.id}（${d.name}）：${tables.length} 张表 / ${rows} 行`);
          if (d.id === 'accounts') {
            accountsDomain = d;
            const p = tables.find(t => t.table === 'profiles');
            profilesRows = p ? p.rows : null;
          }
        }
        console.log('-------------------------------------------');
        if (!accountsDomain) {
          console.log('✘ 结论：这个包里【没有账号域 accounts】。');
          console.log('  用它做导入，目标库的 profiles/classes/user_roles 一个字节都不会变。');
          console.log('  若目标库是新建的空库（迁移只建表不建账号），导入后必然无法登录。');
        } else if (!profilesRows) {
          console.log('✘ 结论：这个包【含账号域，但 profiles 是 0 行】。');
          console.log('  覆盖模式会先把目标库 profiles 清空再插 0 行 —— 导入会"显示成功"，但账号也被清空了。');
        } else {
          console.log(`✔ 结论：包内含 profiles ${profilesRows} 行，可用于恢复账号。`);
        }
        resolve();
      });
      zip.on('error', (e) => { console.log('✘ 读取错误:', e.message); resolve(); });
    });
  });
}

async function inspectDb(env) {
  const mysql = require('mysql2/promise');
  const cfg = {
    host: process.env.DB_HOST || env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || env.DB_PORT || 3306),
    user: process.env.DB_USER || env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME || env.DB_NAME || 'xgpy',
    connectTimeout: 5000,
  };
  console.log('\n================ 数据库检查 ================');
  console.log(`连接 ${cfg.user}@${cfg.host}:${cfg.port} → 库「${cfg.database}」`);
  let c;
  try {
    c = await mysql.createConnection(cfg);
  } catch (e) {
    console.log('✘ 连不上:', e.code, e.message);
    console.log('  （若这里的目标是学校服务器，请先确认本机在校内网段）');
    return;
  }
  const q = async (sql, a) => { try { const [r] = await c.query(sql, a); return r; } catch (e) { return { ERR: e.message }; } };

  const t = await q('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE()');
  console.log('表数量:', t.ERR ? t.ERR : t[0].n);
  const byRole = await q('SELECT role, COUNT(*) n FROM profiles GROUP BY role');
  if (byRole.ERR) { console.log('✘ 读 profiles 失败:', byRole.ERR); }
  else {
    console.log('profiles 账号分布:', byRole.map(r => `${r.role}=${r.n}`).join(', ') || '（空表）');
    const cnt = (await q("SELECT COUNT(*) n FROM profiles WHERE role IN ('teacher','super_admin') AND LENGTH(IFNULL(password_hash,''))=64") || [{ n: '?' }])[0];
    console.log('可登录的教师/管理员账号数:', cnt.n);
    if (Number(cnt.n) === 0) {
      console.log('✘ 结论：这个库里没有任何可登录的教师账号 —— 登录必然失败，且 recordFailedLogin 会刷 1048。');
    } else {
      console.log('✔ 结论：这个库里有可登录账号。若仍登录失败，请确认你连的是不是同一个库。');
    }
    const names = await q("SELECT username FROM profiles WHERE role IN ('teacher','super_admin') ORDER BY username");
    if (!names.ERR) console.log('教师账号:', names.map(r => r.username).join(', '));
  }
  const lh = await q('SELECT id, user_id, login_status, failure_reason, login_time FROM login_history ORDER BY id DESC LIMIT 5');
  if (!lh.ERR) { console.log('最近登录历史:'); lh.forEach(r => console.log('  ', r.id, r.user_id, r.login_status, r.failure_reason || '', r.login_time)); }
  await c.end();
}

(async () => {
  const env = loadEnv();
  const pkgIdx = process.argv.indexOf('--pkg');
  const pkg = pkgIdx > -1 ? process.argv[pkgIdx + 1] : null;
  if (pkg) await inspectPackage(pkg);
  else await inspectDb(env);
})();
