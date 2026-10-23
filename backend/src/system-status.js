/**
 * 教师端「系统仪表台」的数据采集。
 *
 * 设计原则：
 *  - 只读采集：不写库、不改任何业务状态。
 *  - 采集失败一律降级为 null，绝不因为「拿不到磁盘信息」让页面报错。
 *  - 系统 CPU 使用率必须两次采样求差（os.cpus 给的是累计 tick），
 *    因此模块内缓存上一次的值，且 1 秒内重复读取直接复用，避免互相踩基准。
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

let versionInfo = { version: '', commit: '', buildTime: '' };
try {
  // 生产由 gen-version.js 生成；开发环境可能没有，忽略即可
  versionInfo = require('./version');
} catch { /* ignore */ }

// ---------------- 系统 CPU ----------------
let lastTimes = null;   // { idle, total }
let lastAt = 0;
let cachedPct = null;

function systemCpuPercent() {
  const now = Date.now();
  // 1 秒内重复调用直接复用：多个教师同时打开仪表台时不至于互相把基准抢走
  if (cachedPct !== null && now - lastAt < 1000) return cachedPct;

  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  const prev = lastTimes;
  const prevAt = lastAt;
  lastTimes = { idle, total };
  lastAt = now;

  if (!prev || now - prevAt < 800) return cachedPct;  // 首次没有基准
  const idleDiff = idle - prev.idle;
  const totalDiff = total - prev.total;
  if (totalDiff <= 0) return cachedPct;

  cachedPct = Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
  return cachedPct;
}

// ---------------- 磁盘 ----------------
function diskOf(dir) {
  try {
    const st = fs.statfsSync(dir);
    const bsize = Number(st.bsize) || 0;
    const total = Number(st.blocks) * bsize;
    const free = Number(st.bavail) * bsize;   // 普通用户可用
    if (!total) return null;
    return {
      totalGb: Number((total / 1073741824).toFixed(1)),
      freeGb: Number((free / 1073741824).toFixed(1)),
      usedGb: Number(((total - free) / 1073741824).toFixed(1)),
      percent: Math.round(((total - free) / total) * 100),
    };
  } catch {
    return null;
  }
}

// ---------------- 历史趋势（读 metrics.log 尾） ----------------
const TAIL_BYTES = 24 * 1024;

/** 只读文件尾部，避免每次点开仪表台都读整个 5MB 日志 */
function readTail(file, bytes = TAIL_BYTES) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

/**
 * 解析最近 N 分钟的采样行，供前端画趋势。
 * 兼容两种格式：老格式用空格分隔 top 项、新格式用 ' | '；这里只用行首的通用字段。
 */
function readHistory(logFile, minutes = 30) {
  const text = readTail(logFile);
  if (!text) return [];
  const lines = text.split('\n').filter((l) => l.includes('req='));
  // 第一行可能是被截断的半行，丢掉
  if (lines.length && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(lines[0].trim())) lines.shift();

  const rows = [];
  for (const l of lines) {
    const m = l.match(/^(\S+ \S+)/);
    const req = l.match(/req=(\d+)/);
    if (!m || !req) continue;
    rows.push({
      t: m[1],
      req: Number(req[1]),
      rss: Number((l.match(/rss=(\d+)MB/) || [])[1] || 0),
      cpu: Number((l.match(/cpu=(\d+)%/) || [])[1] || 0),
      p99: Number((l.match(/elu p99=(\d+)ms/) || [])[1] || 0),
      slow: Number((l.match(/slow>1s=(\d+)/) || [])[1] || 0),
      errors: Number((l.match(/5xx=(\d+)/) || [])[1] || 0),
    });
  }
  return rows.slice(-minutes);
}

// ---------------- 数据库连接池 ----------------
/**
 * mysql2 的连接池没有公开统计接口，这里读内部字段。
 * 注意：PromisePool 包了一层，真实计数在 pool.pool 上；且新版里 _allConnections 是 Set 不是数组。
 * 读不到就返回 null，不影响页面。
 */
function poolStats(pool) {
  try {
    const inner = pool && pool.pool ? pool.pool : pool;
    const sizeOf = (v) => {
      if (v == null) return null;
      if (typeof v.length === 'number') return v.length;     // 数组 / Denque（mysql2 的队列）
      if (typeof v.size === 'number') return v.size;         // Set / Map
      if (typeof v.size === 'function') { try { return v.size(); } catch { /* ignore */ } }
      return null;
    };
    return {
      total: sizeOf(inner._allConnections),
      free: sizeOf(inner._freeConnections),
      queued: sizeOf(inner._connectionQueue),
      limit: Number(process.env.DB_CONNECTION_LIMIT) || 100,
    };
  } catch {
    return null;
  }
}

/**
 * 组装一份完整快照。
 * @param {object} opts { metrics: 埋点快照, pool, logFile, installDir }
 */
function collect({ metricsSnapshot, pool, logFile, installDir }) {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const procMem = process.memoryUsage();
  const cpus = os.cpus();

  let uptimeSec = 0;
  try { uptimeSec = Math.round(process.uptime()); } catch { /* ignore */ }

  return {
    serverTime: new Date().toISOString(),
    app: {
      version: versionInfo.version || '',
      commit: versionInfo.commit || '',
      buildTime: versionInfo.buildTime || '',
      pid: process.pid,
      uptimeSec,
      rssMb: Math.round(procMem.rss / 1048576),
      heapUsedMb: Math.round(procMem.heapUsed / 1048576),
      heapTotalMb: Math.round(procMem.heapTotal / 1048576),
      nodeVersion: process.versions.node,
    },
    system: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      cpuModel: (cpus[0] && cpus[0].model ? cpus[0].model : '').trim(),
      cpuCount: cpus.length,
      cpuPercent: systemCpuPercent(),
      memTotalMb: Math.round(totalMem / 1048576),
      memFreeMb: Math.round(freeMem / 1048576),
      memUsedMb: Math.round((totalMem - freeMem) / 1048576),
      memPercent: totalMem ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0,
      disk: diskOf(installDir || path.dirname(process.execPath)),
      osUptimeSec: Math.round(os.uptime()),
    },
    traffic: metricsSnapshot || null,
    pool: poolStats(pool),
    history: readHistory(logFile),
  };
}

module.exports = { collect, readHistory };
