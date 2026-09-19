// 数据导入导出模块（.xgpybak 备份包：manifest + data/*.json + files/uploads）
// 设计要点：
//  - 数据按"域"分组，未登记的表自动落入"其他"域，视图/迁移表/授权表不导出
//  - 导出流式写 zip（archiver），导入流式解压（yauzl），内存不随包大小增长
//  - 严格覆盖 = 整表 DELETE + INSERT（事务内，期间关闭外键检查）；追加 = INSERT IGNORE
//  - 文件域"增改不删"：包内文件写入并覆盖同名，本地多出的文件保留
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const archiver = require('archiver');
const yauzl = require('yauzl');

const MANIFEST_NAME = 'manifest.json';
const DATA_PREFIX = 'data/';
const FILES_PREFIX = 'files/';

// 永不导出的表：迁移记录由启动代码负责、授权表绑定机器
const SKIP_TABLES = new Set(['schema_migrations', 'system_license']);

// 域定义：order 即导入拓扑顺序（班级/账号→题库→测试→答题→其余）
const DOMAIN_DEFS = [
  { id: 'accounts', name: '学生账号', tables: ['classes', 'profiles', 'user_roles'] },
  { id: 'questions', name: '题库', tables: ['questions', 'knowledge_points'] },
  { id: 'tests', name: '测试与考试', tables: ['tests', 'test_records', 'exam_records', 'exam_progress'] },
  { id: 'answers', name: '答题记录', tables: ['student_answers', 'wrong_questions', 'question_explained_marks'] },
  { id: 'points', name: '积分与游戏化', tables: ['point_transactions', 'pets', 'pet_config', 'pet_foods', 'student_pets', 'student_equipments', 'student_skins', 'student_buffs', 'equipments', 'prizes', 'prize_class_visibility', 'exchange_records', 'pet_tips', 'internet_codes'] },
  { id: 'tasks', name: '课堂任务', tables: ['task_resource', 'task_question', 'task_class', 'task_study_log', 'notes'] },
  { id: 'learning', name: '学习活动', tables: ['word_list', 'student_word_progress', 'learn_visited_records', 'studious_checkins', 'keyboard_lesson_progress', 'typing_rooms', 'typing_scores', 'typing_duel_records', 'roll_call_layout', 'roll_call_seating', 'roll_call_attendance'] },
  { id: 'ai', name: 'AI与编程', tables: ['ai_qa_history', 'ai_qa_knowledge_base', 'ai_works', 'ai_workshop_config', 'ai_work_purchases', 'ai_work_ratings', 'ai_work_reviews', 'ai_work_versions', 'python_tasks', 'python_submissions', 'python_drafts', 'python_gradings', 'python_wrong_problems', 'python_magic_progress', 'code_realm_progress', 'code_snippets'] },
  { id: 'pk', name: 'PK对战', tables: ['pk_rooms', 'pk_room_players', 'pk_match_answers', 'pk_battle_configs'] },
  { id: 'system', name: '系统配置', tables: ['system_config', 'apps', 'app_reviews', 'app_visibility', 'desktop_backgrounds', 'proxy_sites', 'proxy_pending_domains', 'notifications', 'notification_recipients', 'security_settings', 'student_messages', 'backup_records'] },
  { id: 'logs', name: '运行日志', tables: ['proxy_cache_files', 'proxy_access_log', 'login_history', 'login_sessions', 'python_run_logs', 'student_app_usage', 'app_usage_logs', 'mental_health_chat_history', 'mental_health_access', 'mental_health_alerts'], defaultOff: true },
];

function fmtDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 行序列化：Date → 'YYYY-MM-DD HH:MM:SS'，Buffer → base64 标记
function serializeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (v instanceof Date) { out[k] = fmtDateTime(v); continue; }
    if (Buffer.isBuffer(v)) { out[k] = { __buffer_b64: v.toString('base64') }; continue; }
    out[k] = v;
  }
  return out;
}

function deserializeValue(colType, v) {
  if (v === null || v === undefined) return null;
  if (v && typeof v === 'object') {
    if (v.__buffer_b64 !== undefined) return Buffer.from(v.__buffer_b64, 'base64');
    if (colType === 'json') return JSON.stringify(v);
  }
  return v;
}

// 读取表结构：区分可写列与生成列（STORED/VIRTUAL GENERATED 不能显式赋值）
// 生成列若被显式 INSERT，MariaDB 会报 3105（覆盖模式中断导入；追加模式的 INSERT IGNORE 会静默降级成 warning）
async function getTableColumns(conn, table) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
  const generated = cols.filter(c => /GENERATED/i.test(String(c.Extra || ''))).map(c => c.Field);
  const generatedSet = new Set(generated);
  return {
    all: cols.map(c => c.Field),
    generated,
    writable: cols.map(c => c.Field).filter(f => !generatedSet.has(f)),
    types: Object.fromEntries(cols.map(c => [c.Field, String(c.Type).toLowerCase()])),
  };
}

// 递归列出目录下所有文件（相对路径、大小、mtime）
function walkFiles(dir, baseDir, excludedDirs, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(baseDir, full).split(path.sep).join('/');
    if (ent.isDirectory()) {
      if (excludedDirs.includes(ent.name) && path.dirname(rel) === '.') continue; // 仅排除第一级目录
      walkFiles(full, baseDir, excludedDirs, out);
    } else if (ent.isFile()) {
      const st = fs.statSync(full);
      out.push({ path: rel, size: st.size, mtime: Math.floor(st.mtimeMs) });
    }
  }
  return out;
}

// 从 information_schema 构建实际注册表：域内表 + 未覆盖表归入"其他"
async function buildRegistry(pool) {
  const [rows] = await pool.query(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
  );
  const allTables = rows.map(r => r.t).filter(t => !SKIP_TABLES.has(t));
  const claimed = new Set();
  const domains = DOMAIN_DEFS.map(d => ({ ...d, tables: d.tables.filter(t => allTables.includes(t)) }));
  domains.forEach(d => d.tables.forEach(t => claimed.add(t)));
  const other = allTables.filter(t => !claimed.has(t));
  if (other.length > 0) {
    domains.push({ id: 'other', name: '其他', tables: other, defaultOff: true });
  }
  // 过滤掉库里已不存在的域（空域也保留，便于界面显示）
  return domains.filter(d => d.id === 'files' || d.tables.length > 0);
}

async function getExportMeta(pool, uploadsDir) {
  const domains = await buildRegistry(pool);
  const meta = [];
  for (const d of domains) {
    const tables = [];
    let rows = 0;
    for (const t of d.tables) {
      const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      tables.push({ table: t, rows: r.n });
      rows += r.n;
    }
    meta.push({ id: d.id, name: d.name, defaultOff: !!d.defaultOff, tables, total_rows: rows });
  }
  const fileList = walkFiles(uploadsDir, uploadsDir, []);
  const filesSize = fileList.reduce((s, f) => s + f.size, 0);
  const fileDomains = {
    id: 'files', name: '文件资源（uploads）', files: false,
    file_count: fileList.length, file_size: filesSize,
    subdirs: [...new Set(fileList.map(f => f.path.split('/')[0]))].filter(p => fileList.some(f => f.path.startsWith(p + '/'))),
  };
  return { domains: meta, files: fileDomains };
}

// 把备份包写入 target（可写流）。opts: { domainIds, fileMode:'full'|'manifest', excludeDirs }
async function writeBackup(pool, uploadsDir, appBaseDir, opts, target) {
  const registry = await buildRegistry(pool);
  const selectedDomains = registry.filter(d => opts.domainIds.includes(d.id));
  const excludeDirs = Array.isArray(opts.excludeDirs) ? opts.excludeDirs : [];
  const includeFiles = opts.domainIds.includes('files');
  const fileMode = includeFiles ? (opts.fileMode === 'manifest' ? 'manifest' : 'full') : 'none';

  // manifest 先算好（含文件清单与行数）
  const manifest = {
    format: 'xgpybak',
    version: 1,
    platform_version: require('../package.json').version || 'unknown',
    exported_at: new Date().toISOString(),
    file_mode: fileMode,
    exclude_dirs: excludeDirs,
    domains: [],
    files: [],
  };
  const [migRows] = await pool.query('SELECT MAX(id) AS maxv FROM schema_migrations').catch(() => [[{ maxv: null }]]);
  manifest.schema_migrations_max = migRows[0]?.maxv ?? null;

  for (const d of selectedDomains) {
    const entry = { id: d.id, name: d.name, tables: [] };
    for (const t of d.tables) {
      const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      entry.tables.push({ table: t, rows: r.n });
    }
    manifest.domains.push(entry);
  }
  if (includeFiles) {
    manifest.files = walkFiles(uploadsDir, uploadsDir, excludeDirs);
  }

  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 1 } }); // 图片/视频压缩收益极低，用低级别换速度
    target.on('close', () => resolve({ bytes: archive.pointer() }));
    archive.on('error', reject);
    target.on('error', reject);
    archive.pipe(target);
    archive.append(JSON.stringify(manifest, null, 1), { name: MANIFEST_NAME });

    (async () => {
      try {
        const BATCH = 500;
        for (const d of selectedDomains) {
          for (const t of d.tables) {
            let offset = 0;
            let total = 0;
            // 显式列出可写列，剔除生成列（生成列由目标库自行计算，写入即报错）
            const { writable } = await getTableColumns(pool, t);
            const selectCols = writable.length > 0 ? writable.map(c => `\`${c}\``).join(',') : 'NULL';
            // 【重要】整表只能有一个 zip 条目。
            // 历史上这里每批 500 行都用同一个 name（data/<table>.json）append 一次，
            // zip 允许多个同名条目、但解压时只有最后一条生效 —— 结果 >500 行的表被静默截断成"最后一批"，
            // 覆盖导入后行数骤减（如 questions 1107 → 107）。必须把各批拼成同一个 JSON 数组后再写一次。
            const chunks = [];
            for (;;) {
              const [rows] = await pool.query(`SELECT ${selectCols} FROM \`${t}\` LIMIT ? OFFSET ?`, [BATCH, offset]);
              if (rows.length === 0) break;
              total += rows.length;
              chunks.push(JSON.stringify(rows.map(serializeRow)).slice(1, -1)); // 去掉 [ ]
              offset += BATCH;
              if (rows.length < BATCH) break;
            }
            archive.append(total === 0 ? '[]' : `[${chunks.join(',')}]`, { name: `${DATA_PREFIX}${t}.json` });
            chunks.length = 0;
          }
        }
        if (includeFiles && fileMode === 'full') {
          archive.directory(uploadsDir, `${FILES_PREFIX}uploads`, (entry) => {
            const rel = entry.name; // 相对 uploadsDir
            if (excludeDirs.some(d => rel === d || rel.startsWith(d + '/'))) return false;
            return entry;
          });
        }
        await archive.finalize();
      } catch (e) {
        reject(e);
      }
    })();
  });
}

// 导出为 HTTP 响应下载
async function exportToResponse(pool, uploadsDir, appBaseDir, opts, res) {
  const ts = fmtDateTime(new Date()).replace(/[-: ]/g, '').slice(0, 14);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="xgpy-backup-${ts}.xgpybak"`);
  res.setHeader('Transfer-Encoding', 'chunked');
  const result = await writeBackup(pool, uploadsDir, appBaseDir, opts, res);
  return result;
}

// 导出为本地快照文件（导入前自动备份）
// 可通过环境变量调节（生产 uploads 很大时，含文件的快照会迅速吃掉磁盘）：
//   DB_SNAPSHOT_INCLUDE_FILES=0  快照只备份数据库表，不含 uploads（省空间；但恢复时文件回不来）
//   DB_SNAPSHOT_KEEP=5           保留最近多少份（默认 5）
async function createSnapshot(pool, uploadsDir, backupsDir) {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const ts = fmtDateTime(new Date()).replace(/[-: ]/g, '').slice(0, 14);
  const file = path.join(backupsDir, `snapshot-${ts}.xgpybak`);
  // 是否把 uploads 一起打进快照。默认含文件（行为与 2.3.0~2.3.3 一致，保证可整库还原）；
  // 显式设为 0/false/no/off 时改为"只备份数据表"，快照体积从 uploads 量级降到数据量级。
  const includeFiles = !['0', 'false', 'no', 'off'].includes(
    String(process.env.DB_SNAPSHOT_INCLUDE_FILES ?? '1').trim().toLowerCase()
  );
  const keep = Math.max(1, Number.parseInt(process.env.DB_SNAPSHOT_KEEP, 10) || 5);
  // 快照 = 全部域全量，是否含 files/uploads 由开关决定，不排除任何目录
  const registry = await buildRegistry(pool);
  // 注意：注册表里没有 files 域（它不是一个表域），必须显式补上，否则快照 file_mode 会是 none、不含任何文件
  const allIds = includeFiles ? [...registry.map(d => d.id), 'files'] : registry.map(d => d.id);
  const out = fs.createWriteStream(file);
  const result = await writeBackup(pool, uploadsDir, path.dirname(backupsDir), { domainIds: allIds, fileMode: 'full', excludeDirs: [] }, out);
  // 只保留最近 keep 份（按 mtime，避免同秒多份时排序失效）
  pruneSnapshots(backupsDir, keep);
  return { file, bytes: result.bytes, include_files: includeFiles };
}

// 清理超出保留份数的旧快照。
// 必须按 mtime 排序而不是文件名：同一秒内可能生成多份（文件名时间戳只到秒），
// 按名字排序在时间戳相同时顺序未定义，会导致"保留 5 份"失效、目录无限膨胀。
function pruneSnapshots(backupsDir, keep) {
  if (!fs.existsSync(backupsDir)) return 0;
  const items = fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.xgpybak'))
    .map(f => {
      const full = path.join(backupsDir, f);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch { /* 忽略 */ }
      return { f, full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime); // 新的在前
  let removed = 0;
  for (const it of items.slice(keep)) {
    try { fs.unlinkSync(it.full); removed++; } catch { /* 忽略 */ }
  }
  return removed;
}

function listSnapshots(backupsDir) {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.xgpybak'))
    .map(f => {
      const full = path.join(backupsDir, f);
      let st = { size: 0, mtime: new Date(0) };
      try { st = fs.statSync(full); } catch { /* 忽略 */ }
      // 读出 manifest 的 file_mode，让界面能区分"含文件的快照"与"仅数据表的快照"
      let fileMode = 'unknown';
      try {
        const raw = readZipEntrySync(full, MANIFEST_NAME);
        if (raw) fileMode = JSON.parse(raw.toString('utf8')).file_mode || 'none';
      } catch { /* 读不出就留 unknown，不影响列表 */ }
      return { name: f, size: st.size, created_at: st.mtime.toISOString(), file_mode: fileMode };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at)); // 新的在前
}

// 同步读 zip 内单个 entry（用于列表这种小读取；包内 manifest 很小）
function readZipEntrySync(zipPath, entryName) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const tailLen = Math.min(stat.size, 66 * 1024); // EOCD 定位：从尾部回扫
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, stat.size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const cdCount = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    let p = 0;
    for (let n = 0; n < cdCount && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      if (name === entryName) {
        // 读本地头拿到真实数据起点
        const lh = Buffer.alloc(30);
        fs.readSync(fd, lh, 0, 30, localOffset);
        const lNameLen = lh.readUInt16LE(26);
        const lExtraLen = lh.readUInt16LE(28);
        const dataStart = localOffset + 30 + lNameLen + lExtraLen;
        const raw = Buffer.alloc(compSize);
        fs.readSync(fd, raw, 0, compSize, dataStart);
        if (method === 0) return raw;
        if (method === 8) return zlib.inflateRawSync(raw);
        return null;
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// yauzl 读取 zip 内单个 entry
function readZipEntry(zipPath, entryName) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.on('error', reject);
      zipfile.on('entry', (entry) => {
        if (entry.fileName === entryName) {
          zipfile.openReadStream(entry, (e2, rs) => {
            if (e2) return reject(e2);
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', () => { zipfile.close(); resolve(Buffer.concat(chunks)); });
            rs.on('error', reject);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => { zipfile.close(); reject(new Error(`包内缺少 ${entryName}`)); });
      zipfile.readEntry();
    });
  });
}

// yauzl 解压整个包到目录（防路径穿越）
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) return reject(err);
      let pending = 0;
      let failed = false;
      zipfile.on('error', (e) => { failed = true; reject(e); });
      zipfile.on('entry', (entry) => {
        const name = entry.fileName;
        if (name.includes('..') || path.isAbsolute(name)) return zipfile.readEntry();
        const dest = path.join(destDir, name);
        if (name.endsWith('/')) {
          fs.mkdirSync(dest, { recursive: true });
          return zipfile.readEntry();
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        pending++;
        zipfile.openReadStream(entry, (e2, rs) => {
          if (e2) { failed = true; return reject(e2); }
          const ws = fs.createWriteStream(dest);
          rs.pipe(ws);
          ws.on('finish', () => { pending--; if (pending === 0 && !failed) resolve(); });
          ws.on('error', (e3) => { failed = true; reject(e3); });
        });
        zipfile.readEntry();
      });
      zipfile.on('end', () => { if (pending === 0 && !failed) resolve(); });
      zipfile.readEntry();
    });
  });
}

// 导入预览：只解析 manifest，与当前库对比
async function previewImport(pool, uploadsDir, zipPath) {
  const raw = await readZipEntry(zipPath, MANIFEST_NAME);
  const manifest = JSON.parse(raw.toString('utf8'));
  if (manifest.format !== 'xgpybak') throw new Error('不是有效的 XGPY 备份包');

  const registry = await buildRegistry(pool);
  const tableDomain = {};
  registry.forEach(d => d.tables.forEach(t => { tableDomain[t] = d; }));

  const domains = [];
  for (const d of manifest.domains || []) {
    const tables = [];
    for (const t of d.tables || []) {
      let current = 0;
      try {
        const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t.table}\``);
        current = r.n;
      } catch { current = null; } // 表在本库不存在（schema 更旧）
      tables.push({ table: t.table, package_rows: t.rows, current_rows: current, empty_overwrite: (t.rows || 0) === 0 && current > 0 });
    }
    domains.push({ id: d.id, name: d.name, tables, total_package: tables.reduce((s, t) => s + (t.package_rows || 0), 0) });
  }
  // 包里有、当前库没有的表也列出来（导入时会自动建？不，直接报错跳过）
  const currentFiles = includeFilesInManifest(manifest) ? walkFiles(uploadsDir, uploadsDir, []) : [];
  const pkgFiles = manifest.files || [];
  const curMap = new Map(currentFiles.map(f => [f.path, f]));
  const filesDiff = includeFilesInManifest(manifest) ? {
    package_count: pkgFiles.length,
    local_count: currentFiles.length,
    new_files: pkgFiles.filter(f => !curMap.has(f.path)).length,
    changed_files: pkgFiles.filter(f => curMap.has(f.path) && curMap.get(f.path).size !== f.size).length,
  } : null;

  return {
    manifest,
    domains,
    files: filesDiff,
    warnings: [
      ...(manifest.platform_version !== require('../package.json').version ? [`备份来自版本 ${manifest.platform_version}，当前 ${require('../package.json').version}`] : []),
      ...(manifest.file_mode === 'manifest' ? ['该包为"仅清单"模式，不含文件本体，导入时只做差异报告'] : []),
    ],
  };
}

function includeFilesInManifest(manifest) {
  return (manifest.file_mode === 'full' || manifest.file_mode === 'manifest') && Array.isArray(manifest.files);
}

// 执行导入。plan: { modes: {domainId: 'overwrite'|'append'|'skip'}, files_mode 同上 }
async function runImport(pool, uploadsDir, backupsDir, zipPath, plan) {
  const tmpDir = path.join(path.dirname(zipPath), `extract-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const raw = await readZipEntry(zipPath, MANIFEST_NAME);
    const manifest = JSON.parse(raw.toString('utf8'));
    const report = { snapshot: null, tables: [], files: null, warnings: [] };

    // 防呆（放在快照之前，避免白做一份 60MB 快照）：
    // 覆盖模式 + 包内该表 0 行 + 目标库该表有数据 → 默认阻止。
    // 否则会出现"导入显示成功"，但账号/业务数据被静默清空（典型后果：导入后系统无法登录）。
    if (plan.allowEmptyOverwrite !== true) {
      const blockList = [];
      for (const d of manifest.domains || []) {
        if (plan.modes[d.id] !== 'overwrite' || d.id === 'files') continue;
        for (const t of (d.tables || [])) {
          if ((t.rows || 0) !== 0) continue;
          try {
            const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t.table}\``);
            if (r.n > 0) blockList.push(`${t.table}（包内 0 行，覆盖将清空当前库 ${r.n} 行）`);
          } catch { /* 表在本库不存在，无需防呆 */ }
        }
      }
      if (blockList.length > 0) {
        const err = new Error('已阻止导入：' + blockList.join('、') + '。'
          + '覆盖模式会把目标库这些表清空成 0 行。若确认要清空，请勾选"允许清空包内为 0 行的表"后重试。');
        err.code = 'EMPTY_OVERWRITE_BLOCKED';
        throw err;
      }
    }

    const snapshot = await createSnapshot(pool, uploadsDir, backupsDir);
    report.snapshot = { name: path.basename(snapshot.file), size: snapshot.bytes, include_files: snapshot.include_files };
    if (!snapshot.include_files) {
      report.warnings.push('本次导入前快照未包含 uploads 文件资源（DB_SNAPSHOT_INCLUDE_FILES=0），'
        + '该快照可还原数据表，但无法还原已上传的图片/视频等文件。');
    }

    // 只解压被选中域需要的 data/*.json；有文件域时全包解压
    const needed = new Set();
    for (const d of manifest.domains || []) {
      const mode = plan.modes[d.id];
      if (!mode || mode === 'skip') continue;
      if (d.id === 'files') continue;
      (d.tables || []).forEach(t => needed.add(`${DATA_PREFIX}${t.table}.json`));
    }
    const wantFiles = plan.modes.files === 'overwrite' || plan.modes.files === 'append';
    await extractZip(zipPath, tmpDir);

    // 旧包数据截断检测：
    // 2.3.2 及更早的导出把每批 500 行用同一个 zip 条目名写入，解压后只剩最后一批
    // （manifest 里记的是真实总行数）。这里逐表比对"manifest 声明行数 vs 解出文件实际行数"：
    //   - 追加模式：只提示（INSERT IGNORE 不会删本地数据，最多是少进一些行）
    //   - 覆盖模式：直接阻止（DELETE 会先把本地整表清掉，再只插回残缺的一批 → 灾难性丢数据）
    const truncationBlocked = [];
    for (const d of manifest.domains || []) {
      if (d.id === 'files') continue;
      const mode = plan.modes[d.id];
      if (!mode || mode === 'skip') continue;
      for (const t of (d.tables || [])) {
        const declared = t.rows || 0;
        if (declared <= 500) continue; // 未跨批次，老包也是完整的
        const file = path.join(tmpDir, DATA_PREFIX + t.table + '.json');
        if (!fs.existsSync(file)) continue;
        let actual = -1;
        try { actual = JSON.parse(fs.readFileSync(file, 'utf8')).length; } catch { actual = -1; }
        if (actual >= 0 && actual < declared) {
          const lost = declared - actual;
          const msg = `${t.table}：备份包声明 ${declared} 行，包内实际只有 ${actual} 行（少了 ${lost} 行）`;
          if (mode === 'overwrite') {
            truncationBlocked.push(msg);
          } else {
            report.warnings.push(`【包数据不完整】${msg}。该包由 2.3.3 之前的版本导出，`
              + `超过 500 行的表被错误截断；追加模式下不影响本地已有数据，但只能补进这 ${actual} 行。`);
          }
        }
      }
    }
    if (truncationBlocked.length > 0) {
      const err = new Error('已阻止导入：备份包内以下表的数据不完整——' + truncationBlocked.join('；')
        + '。这些包来自 2.3.3 之前的版本，导出时超过 500 行的表被错误截断，'
        + '用"覆盖"方式导入会把当前库的整表清空成残缺内容。'
        + '请用 2.3.3 及以上版本重新导出该库后再导入；'
        + '若只想补充数据而不清空本地，请改用"追加"模式。');
      err.code = 'TRUNCATED_PACKAGE_BLOCKED';
      throw err;
    }

    const conn = await pool.getConnection();
    let importedFiles = null;
    let txOpen = false; // 事务是否已开启：失败时必须回滚，绝不能让"持锁的未结束事务"跟着连接回到连接池
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      // 撞锁时尽快失败，别按默认 50s 挂死（可用 DB_IMPORT_LOCK_WAIT_TIMEOUT 覆盖，冒烟测试用它压到几秒）
      const lockWait = Number.parseInt(process.env.DB_IMPORT_LOCK_WAIT_TIMEOUT, 10) || 30;
      await conn.query(`SET SESSION innodb_lock_wait_timeout = ${Number.isFinite(lockWait) && lockWait > 0 ? lockWait : 30}`);
      await conn.query(`SET SESSION lock_wait_timeout = ${Number.isFinite(lockWait) && lockWait > 0 ? lockWait : 30}`);
      await conn.beginTransaction();
      txOpen = true;
      for (const d of manifest.domains || []) {
        const mode = plan.modes[d.id];
        if (!mode || mode === 'skip') continue;
        if (d.id === 'files') continue; // 文件域单独处理
        for (const t of (d.tables || [])) {
          const file = path.join(tmpDir, DATA_PREFIX + t.table + '.json');
          if (!fs.existsSync(file)) {
            report.tables.push({ table: t.table, mode, status: 'missing', package_rows: t.rows, deleted: 0, inserted: 0 });
            continue;
          }
          let rows;
          try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { rows = []; }
          // 当前库的可写列：包若来自更新版本，多余列跳过；生成列必须剔除，否则 INSERT 直接报 3105
          const { writable, generated, types: colTypes } = await getTableColumns(conn, t.table);
          const writableSet = new Set(writable);
          const useCols = rows.length > 0 ? Object.keys(rows[0]).filter(k => writableSet.has(k)) : [];
          if (rows.length > 0) {
            const dropped = generated.filter(g => Object.prototype.hasOwnProperty.call(rows[0], g));
            if (dropped.length > 0) report.warnings.push(`${t.table}：包内的生成列 ${dropped.join('、')} 已跳过，由目标库自行计算`);
          }

          let deleted = 0;
          let inserted = 0;
          if (mode === 'overwrite') {
            const [dr] = await conn.query(`DELETE FROM \`${t.table}\``);
            deleted = dr.affectedRows || 0;
          }
          for (let i = 0; i < rows.length; i += 200) {
            const batch = rows.slice(i, i + 200);
            if (useCols.length === 0) break;
            const values = batch.map(r => useCols.map(c => deserializeValue(colTypes[c], r[c])));
            const placeholders = batch.map(() => `(${useCols.map(() => '?').join(',')})`).join(',');
            const sql = mode === 'overwrite'
              ? `INSERT INTO \`${t.table}\` (${useCols.map(c => `\`${c}\``).join(',')}) VALUES ${placeholders}`
              : `INSERT IGNORE INTO \`${t.table}\` (${useCols.map(c => `\`${c}\``).join(',')}) VALUES ${placeholders}`;
            const [ir] = await conn.query(sql, values.flat());
            inserted += ir.affectedRows || 0;
          }
          report.tables.push({ table: t.table, mode, status: 'ok', package_rows: rows.length, deleted, inserted, skipped: Math.max(0, rows.length - inserted) });
        }
      }
      await conn.commit();
      txOpen = false;
      await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      // 导入后自检：库里必须还有可登录的教师/管理员账号。
      // 否则系统会"登录不了"，而且导入功能本身需要登录才能用——等于把自救的路也堵死了。
      try {
        const [[n]] = await conn.query(
          "SELECT COUNT(*) AS n FROM profiles WHERE role IN ('teacher','super_admin') AND LENGTH(IFNULL(password_hash,'')) = 64"
        );
        if (Number(n.n) === 0) {
          report.account_warning = '当前库已没有任何可登录的教师/管理员账号，系统将无法登录（导入功能也需要登录，无法在页面上自救）。'
            + '请确认 .env 的 DB_NAME 指向的库是否正确，或通过 SQL / 快照恢复账号。';
        }
      } catch { /* profiles 表不存在则跳过 */ }
    } catch (e) {
      if (txOpen) {
        try { await conn.rollback(); } catch { /* 回滚失败也要继续复位并归还连接 */ }
        txOpen = false;
      }
      await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      if (e && (e.errno === 1205 || e.errno === 1213)) {
        const hint = new Error(`目标库存在未结束的事务/锁（${e.errno === 1205 ? '等待锁超时' : '死锁'}），本次导入已整体回滚，数据保持原样。`
          + `请重启后端服务或等持锁事务结束后再试。原始错误：${e.message}`);
        hint.errno = e.errno;
        throw hint;
      }
      throw e;
    } finally {
      conn.release();
    }

    // 文件域：增改不删
    if (wantFiles && manifest.file_mode === 'full') {
      const srcRoot = path.join(tmpDir, FILES_PREFIX, 'uploads');
      let added = 0, overwritten = 0;
      if (fs.existsSync(srcRoot)) {
        const walk = (dir, base) => {
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            const rel = path.relative(base, full);
            if (ent.isDirectory()) { walk(full, base); continue; }
            const dest = path.join(uploadsDir, rel);
            const existed = fs.existsSync(dest);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(full, dest);
            existed ? overwritten++ : added++;
          }
        };
        walk(srcRoot, srcRoot);
      }
      importedFiles = { mode: plan.modes.files, added, overwritten, deleted: 0 };
    } else if (wantFiles && manifest.file_mode === 'manifest') {
      importedFiles = { mode: 'manifest-only', note: '该包不含文件本体，仅做差异报告' };
    }
    report.files = importedFiles;
    return report;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 清理临时目录：孤儿解压目录 + 超期上传包（导入被中断/预览后没执行时会残留）
// 只清理超过 maxAgeMs 的，避免打断正在进行的导入
function cleanupTemp(tmpDir, maxAgeMs = 6 * 60 * 60 * 1000) {
  const removed = { dirs: 0, files: 0 };
  if (!fs.existsSync(tmpDir)) return removed;
  for (const name of fs.readdirSync(tmpDir)) {
    const full = path.join(tmpDir, name);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs <= maxAgeMs) continue;
      if (name.startsWith('extract-') && fs.statSync(full).isDirectory()) {
        fs.rmSync(full, { recursive: true, force: true });
        removed.dirs++;
      } else if (name.startsWith('import-') && name.endsWith('.xgpybak')) {
        fs.unlinkSync(full);
        removed.files++;
      }
    } catch { /* 单个文件失败不影响整体 */ }
  }
  return removed;
}

module.exports = {
  buildRegistry,
  getExportMeta,
  exportToResponse,
  writeBackup,
  createSnapshot,
  listSnapshots,
  pruneSnapshots,
  previewImport,
  runImport,
  cleanupTemp,
  getTableColumns,
  SKIP_TABLES,
};
