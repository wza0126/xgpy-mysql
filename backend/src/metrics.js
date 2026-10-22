/**
 * 轻量运行时埋点。
 *
 * 目的：以后再出现「莫名卡死」，能直接从日志看出是谁在打服务器，而不是靠猜。
 * 每分钟往 logs/metrics.log 写一行，内容：
 *   - 请求总数 / 慢请求数（>1s）
 *   - 请求量 Top 10 的接口（含次数、平均耗时、最大耗时）
 *   - 事件循环延迟（p99 / max）：这是判断「卡」最直接的指标
 *   - CPU 占用、RSS、堆内存、当前连接数
 *
 * 开关：环境变量 XGPY_METRICS=0 可关闭（默认开启）。
 * 为什么用内存计数 + 定时落盘：零依赖、开销可忽略（一次 Map 自增），
 * 绝不能因为埋点本身把服务器拖慢。
 */
const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay, performance } = require('perf_hooks');

const MAX_KEYS = 300;        // 接口种类上限，防止异常路径把 Map 撑爆
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function createMetrics({ app, getConnections, logDir }) {
  if (process.env.XGPY_METRICS === '0') {
    return { middleware: (req, res, next) => next(), stop: () => {} };
  }

  const dir = logDir || path.join(path.dirname(process.execPath), 'logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const logFile = path.join(dir, 'metrics.log');

  let bucket = new Map();      // key -> { n, sumMs, maxMs }
  let total = 0;
  let slow = 0;
  let errors = 0;
  let windowStart = Date.now();

  // 事件循环延迟直方图：p99 超过 200ms 基本就能感觉到卡
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();

  const lastCpu = process.cpuUsage();
  let lastCpuAt = Date.now();
  let lastElu = { p99: 0, max: 0 };

  /** 把具体 id 归一化，避免 /api/x/123 和 /api/x/456 各占一行 */
  function normalize(req) {
    let p = req.originalUrl.split('?')[0];
    p = p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
    p = p.replace(/\/\d+(?=\/|$)/g, '/:n');
    p = p.replace(/\/local_[A-Za-z0-9_]+/g, '/:qid');
    const parts = p.split('/').filter(Boolean);
    if (parts.length > 4) p = '/' + parts.slice(0, 4).join('/') + '/…';
    return (req.method === 'GET' ? '' : req.method + ' ') + p;
  }

  const middleware = (req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      const ms = performance.now() - started;
      const key = normalize(req);
      const cur = bucket.get(key) || { n: 0, sumMs: 0, maxMs: 0 };
      cur.n += 1;
      cur.sumMs += ms;
      if (ms > cur.maxMs) cur.maxMs = ms;
      bucket.set(key, cur);
      total += 1;
      if (ms > 1000) slow += 1;
      if (res.statusCode >= 500) errors += 1;
      if (bucket.size > MAX_KEYS) {
        // 超限就淘汰最小的 20 个，保持内存有界
        const sorted = [...bucket.entries()].sort((a, b) => a[1].n - b[1].n).slice(0, 20);
        sorted.forEach(([k]) => bucket.delete(k));
      }
    });
    next();
  };

  function writeLine() {
    const now = Date.now();
    const secs = Math.max(1, (now - windowStart) / 1000);

    // CPU：process.cpuUsage 是累计微秒，取窗口差值
    const cpu = process.cpuUsage(lastCpu);
    const wall = now - lastCpuAt;
    const cpuPct = wall > 0 ? Math.round(((cpu.user + cpu.system) / 1000) / wall * 100) : 0;
    lastCpuAt = now;

    // 事件循环延迟（纳秒），取完即重置
    const eluP99 = Math.round(h.percentile(99) / 1e6);
    const eluMax = Math.round(h.max / 1e6);
    h.reset();

    const mem = process.memoryUsage();
    const top = [...bucket.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 10)
      .map(([k, v]) => `${k}×${v.n}(${Math.round(v.sumMs / v.n)}ms,max${Math.round(v.maxMs)}ms)`)
      .join(' ');

    let conns = 0;
    try { conns = typeof getConnections === 'function' ? getConnections() : 0; } catch { /* ignore */ }

    const line =
      `${new Date(now).toLocaleString('zh-CN', { hour12: false })} | ` +
      `req=${total} (${(total / secs).toFixed(1)}/s, slow>1s=${slow}, 5xx=${errors}) | ` +
      `elu p99=${eluP99}ms max=${eluMax}ms | ` +
      `cpu=${cpuPct}% rss=${Math.round(mem.rss / 1048576)}MB heap=${Math.round(mem.heapUsed / 1048576)}MB | ` +
      `conns=${conns} | top: ${top || '(无)'}`;

    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > LOG_MAX_BYTES) {
        fs.renameSync(logFile, logFile + '.1');
      }
      fs.appendFileSync(logFile, line + '\n');
    } catch { /* 日志写不了也不能影响服务 */ }

    bucket = new Map();
    total = 0;
    slow = 0;
    errors = 0;
    windowStart = now;
  }

  const timer = setInterval(writeLine, 60 * 1000);
  if (timer.unref) timer.unref();

  return {
    middleware,
    stop: () => { clearInterval(timer); try { h.disable(); } catch { /* ignore */ } },
  };
}

module.exports = { createMetrics };
