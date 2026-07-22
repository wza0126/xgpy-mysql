// ==============================================
// 代理上网模块（学生上网冲浪）
// 学生机不能上外网，本模块让服务端作为中转代理：
//   教师维护站点白名单 → 学生领取短期令牌 → iframe 内通过 /api/web-proxy 访问外网
// 路由分组：
//   /api/teacher/proxy/*  教师管理（站点白名单 / 待审域名 / 权限开关 / 访问记录）
//   /api/student/proxy/*  学生端（状态 / 站点列表 / 领取令牌）
//   /api/web-proxy/*      中转代理（不挂 authenticate，自验 HMAC 令牌）
// ==============================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

// 令牌有效期：2 小时
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
// HTML/CSS 改写时的响应体上限（视频等二进制不限）
const REWRITE_BODY_LIMIT = 10 * 1024 * 1024;
// 上游请求超时
const UPSTREAM_TIMEOUT_MS = 30 * 1000;
// 站点信息抓取超时
const FETCH_SITE_INFO_TIMEOUT_MS = 10 * 1000;

// ---------- 静态资源磁盘缓存 ----------
// 目录约定与 uploads 一致：开发环境 backend/cache/web-proxy，
// pkg 打包成 exe 后 __dirname 指向只读快照，缓存放 exe 同级 cache/web-proxy
const appBaseDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const CACHE_DIR = path.join(appBaseDir, 'cache', 'web-proxy');
// 单文件超过 200MB 不缓存（防一个视频吃掉配额）
const MAX_CACHE_FILE_BYTES = 200 * 1024 * 1024;
// 容量上限默认值（MB），可在教师端"上网管理-缓存设置"修改
const DEFAULT_CACHE_LIMIT_MB = 2048;

// 实例标识：多机房各教师机连同一个 MariaDB，缓存索引按 instance_id 隔离。
// 首次启动生成 UUID 持久化在 cache/instance.id（exe 同理放 exe 同级 cache/），
// 可用环境变量 PROXY_INSTANCE_ID 覆盖（测试/运维指定用）
function resolveInstanceId() {
    const fromEnv = String(process.env.PROXY_INSTANCE_ID || '').trim();
    if (fromEnv) return fromEnv.slice(0, 64);
    const idFile = path.join(appBaseDir, 'cache', 'instance.id');
    try {
        if (fs.existsSync(idFile)) {
            const existing = fs.readFileSync(idFile, 'utf8').trim();
            if (existing) return existing.slice(0, 64);
        }
        const id = crypto.randomUUID();
        fs.mkdirSync(path.dirname(idFile), { recursive: true });
        fs.writeFileSync(idFile, id, 'utf8');
        return id;
    } catch (error) {
        // 目录只读等异常：退化为内存 UUID（本进程内缓存隔离仍正确，重启后换 ID 旧索引成一次性孤儿）
        console.error('持久化代理缓存实例ID失败（本次用内存ID）:', error);
        return crypto.randomUUID();
    }
}
const INSTANCE_ID = resolveInstanceId();
console.log(`代理缓存实例ID: ${INSTANCE_ID}`);

// 缓存文件名带实例前缀：多实例共用目录时（开发/测试）也能按归属安全清理
function cacheFileName(hash) {
    return `${INSTANCE_ID}-${hash}`;
}

// 可缓存的静态资源 Content-Type（HTML/JSON/API 不匹配，自然绕过）
const CACHEABLE_TYPE_RE = /^(image\/|video\/|audio\/|font\/|text\/css|text\/javascript|application\/javascript|application\/x-javascript|application\/font|application\/x-font|application\/vnd\.ms-fontobject)/;

function isCacheableContentType(contentType) {
    return CACHEABLE_TYPE_RE.test(String(contentType || '').toLowerCase());
}

function ensureCacheDir() {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch (error) {
        console.error('创建代理缓存目录失败:', error);
    }
}

function cacheUrlHash(url) {
    return crypto.createHash('sha256').update(url).digest('hex');
}

// 缓存设置：内存缓存 10 秒（参考站点/权限缓存模式），教师修改后立即失效
let cacheSettingsMem = { value: null, exp: 0 };

async function getCacheSettings(pool) {
    const now = Date.now();
    if (cacheSettingsMem.value && cacheSettingsMem.exp > now) return cacheSettingsMem.value;
    let enabled = 1;
    let limitMb = DEFAULT_CACHE_LIMIT_MB;
    try {
        const [rows] = await pool.query(
            "SELECT config_key, value FROM system_config WHERE config_key IN ('proxy_cache_enabled', 'proxy_cache_limit_mb')"
        );
        for (const row of rows) {
            let v = row.value;
            if (typeof v === 'string') {
                try { v = JSON.parse(v); } catch { /* 非JSON原样用 */ }
            }
            const val = (v && typeof v === 'object' && 'value' in v) ? v.value : v;
            if (row.config_key === 'proxy_cache_enabled') {
                enabled = (val === 1 || val === '1' || val === true) ? 1 : 0;
            } else if (row.config_key === 'proxy_cache_limit_mb') {
                const n = parseInt(val, 10);
                if (Number.isFinite(n) && n > 0) limitMb = n;
            }
        }
    } catch (error) {
        console.error('读取代理缓存设置失败（用默认值）:', error);
    }
    const settings = { enabled, limitMb };
    cacheSettingsMem = { value: settings, exp: now + 10000 };
    return settings;
}

function invalidateCacheSettings() {
    cacheSettingsMem.exp = 0;
}

async function upsertSystemConfig(pool, key, val) {
    await pool.query(
        'INSERT INTO system_config (id, config_key, value, updated_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()',
        [`config_${key}`, key, JSON.stringify({ value: val })]
    );
}

// 淘汰：总大小超上限时按 last_accessed_at 最旧先删，降到上限 90% 以下
// 多机房隔离：统计与删除都只针对本机实例的记录和文件
async function evictCacheIfNeeded(pool) {
    try {
        const settings = await getCacheSettings(pool);
        const limitBytes = settings.limitMb * 1024 * 1024;
        const [sumRows] = await pool.query(
            'SELECT COALESCE(SUM(size_bytes), 0) AS total FROM proxy_cache_files WHERE instance_id = ?',
            [INSTANCE_ID]
        );
        let current = Number(sumRows[0].total) || 0;
        if (current <= limitBytes) return;
        const target = Math.floor(limitBytes * 0.9);
        const [rows] = await pool.query(
            'SELECT url_hash, file_name, size_bytes FROM proxy_cache_files WHERE instance_id = ? ORDER BY last_accessed_at ASC',
            [INSTANCE_ID]
        );
        let evicted = 0;
        for (const row of rows) {
            if (current <= target) break;
            fs.unlink(path.join(CACHE_DIR, row.file_name), () => {});
            await pool.query('DELETE FROM proxy_cache_files WHERE url_hash = ? AND instance_id = ?', [row.url_hash, INSTANCE_ID]);
            current -= Number(row.size_bytes) || 0;
            evicted++;
        }
        if (evicted > 0) {
            console.log(`代理缓存淘汰 ${evicted} 个文件，当前用量 ${(current / 1024 / 1024).toFixed(1)}MB`);
        }
    } catch (error) {
        console.error('代理缓存淘汰失败:', error);
    }
}

// 写缓存索引（文件已 rename 成正式文件后调用），记录归属本机实例
async function insertCacheIndex(pool, hash, url, sizeBytes, contentType) {
    const fileName = cacheFileName(hash);
    await pool.query(
        `INSERT INTO proxy_cache_files (url_hash, instance_id, url, file_name, size_bytes, content_type, created_at, last_accessed_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE size_bytes = VALUES(size_bytes), content_type = VALUES(content_type), last_accessed_at = NOW()`,
        [hash, INSTANCE_ID, url, fileName, sizeBytes, String(contentType || '').slice(0, 100)]
    );
}

// 整块内容写缓存（CSS 等小文件）：tmp 写完后 rename，避免半截文件被命中
async function writeBufferToCache(pool, url, buffer, contentType) {
    try {
        if (buffer.length === 0 || buffer.length > MAX_CACHE_FILE_BYTES) return;
        ensureCacheDir();
        const hash = cacheUrlHash(url);
        const fileName = cacheFileName(hash);
        const tmpPath = path.join(CACHE_DIR, `${fileName}.tmp`);
        const finalPath = path.join(CACHE_DIR, fileName);
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, finalPath);
        await insertCacheIndex(pool, hash, url, buffer.length, contentType);
        await evictCacheIfNeeded(pool);
    } catch (error) {
        console.error('写代理缓存失败:', error);
    }
}

// 缓存命中：从磁盘直接发送（支持 Range 切片返回 206）。返回 true 表示已响应
// 多机房隔离：只查本机实例的索引，其他机房的记录不命中也不误删
async function tryServeFromCache(pool, req, res, siteId, scheme, host, upstreamUrl) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const settings = await getCacheSettings(pool);
    if (!settings.enabled) return false;

    const hash = cacheUrlHash(upstreamUrl);
    const [rows] = await pool.query(
        'SELECT * FROM proxy_cache_files WHERE url_hash = ? AND instance_id = ?',
        [hash, INSTANCE_ID]
    );
    if (rows.length === 0) return false;

    const row = rows[0];
    const filePath = path.join(CACHE_DIR, row.file_name);
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        // 文件被手工清理但索引还在：删本机索引按未命中处理
        pool.query('DELETE FROM proxy_cache_files WHERE url_hash = ? AND instance_id = ?', [hash, INSTANCE_ID]).catch(() => {});
        return false;
    }

    const total = stat.size;
    const contentType = row.content_type || 'application/octet-stream';
    res.setHeader('content-type', contentType);
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('x-proxy-cache', 'HIT');
    // 更新命中时间（淘汰依据），不阻塞响应
    pool.query('UPDATE proxy_cache_files SET last_accessed_at = NOW() WHERE url_hash = ? AND instance_id = ?', [hash, INSTANCE_ID]).catch(() => {});

    // CSS 缓存的是上游原文，命中时要重新改写 url(...) 到代理命名空间
    if (contentType.toLowerCase().includes('text/css')) {
        try {
            const text = fs.readFileSync(filePath, 'utf8');
            res.setHeader('content-length', Buffer.byteLength(rewriteCss(text, siteId, scheme, host)));
            res.status(200);
            if (req.method === 'HEAD') { res.end(); return true; }
            res.send(rewriteCss(text, siteId, scheme, host));
        } catch (error) {
            console.error('读取CSS缓存失败:', error);
            res.status(500).end();
        }
        return true;
    }

    if (req.method === 'HEAD') {
        res.setHeader('content-length', total);
        res.status(200).end();
        return true;
    }

    // Range 切片（视频拖动）
    const range = req.headers.range;
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(String(range).trim()) : null;
    let start = 0;
    let end = total - 1;
    let partial = false;
    if (m && (m[1] !== '' || m[2] !== '')) {
        if (m[1] === '') {
            // bytes=-N：最后 N 字节
            start = Math.max(0, total - parseInt(m[2], 10));
            end = total - 1;
        } else {
            start = parseInt(m[1], 10);
            end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
        }
        if (start > end || start >= total) {
            res.setHeader('content-range', `bytes */${total}`);
            res.status(416).end();
            return true;
        }
        partial = true;
    }

    res.status(partial ? 206 : 200);
    if (partial) res.setHeader('content-range', `bytes ${start}-${end}/${total}`);
    res.setHeader('content-length', end - start + 1);
    try {
        await pipeline(fs.createReadStream(filePath, partial ? { start, end } : undefined), res);
    } catch (streamError) {
        // 学生中途断开：响应已发出，静默断开即可
        if (streamError && streamError.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
            console.error('缓存文件发送中断:', streamError);
        }
        res.destroy();
    }
    return true;
}

// 未命中且可缓存：流式透传的同时 tee 一份写临时文件，完整结束后 rename 入缓存；
// 上游超时/学生断开/写盘失败一律丢弃临时文件，绝不留 .tmp 垃圾、绝不冒泡流错误
function streamToClientWithCache(pool, source, res, upstreamUrl, contentType) {
    ensureCacheDir();
    const hash = cacheUrlHash(upstreamUrl);
    const fileName = cacheFileName(hash);
    const tmpPath = path.join(CACHE_DIR, `${fileName}.tmp`);
    const finalPath = path.join(CACHE_DIR, fileName);
    const fileStream = fs.createWriteStream(tmpPath);
    let written = 0;
    let fileBroken = false;
    let finished = false;

    const dropFile = () => {
        if (fileBroken) return;
        fileBroken = true;
        try { fileStream.destroy(); } catch { /* 忽略 */ }
        fs.unlink(tmpPath, () => {});
    };
    fileStream.on('error', (error) => {
        console.error('代理缓存写文件失败（该资源不入缓存）:', error);
        dropFile();
    });

    // 背压：文件/客户端任一写满都暂停源，各自只挂一个 drain 监听（防止快速流叠加监听告警），都排空才恢复
    let fileWaiting = false;
    let resWaiting = false;
    const maybeResume = () => {
        if (!fileWaiting && !resWaiting && !finished) {
            try { source.resume(); } catch { /* 忽略 */ }
        }
    };

    source.on('data', (chunk) => {
        written += chunk.length;
        if (!fileBroken) {
            if (written > MAX_CACHE_FILE_BYTES) {
                // content-length 未知、实际超过 200MB：停写文件，客户端照常透传
                dropFile();
            } else {
                const ok = fileStream.write(chunk);
                if (!ok && !fileWaiting) {
                    fileWaiting = true;
                    source.pause();
                    fileStream.once('drain', () => { fileWaiting = false; maybeResume(); });
                }
            }
        }
        const okRes = res.write(chunk);
        if (!okRes && !resWaiting) {
            resWaiting = true;
            source.pause();
            res.once('drain', () => { resWaiting = false; maybeResume(); });
        }
    });

    source.on('end', () => {
        finished = true;
        res.end();
        if (fileBroken) return;
        fileStream.end(() => {
            fs.rename(tmpPath, finalPath, (renameErr) => {
                if (renameErr) {
                    console.error('代理缓存改名失败:', renameErr);
                    fs.unlink(tmpPath, () => {});
                    return;
                }
                insertCacheIndex(pool, hash, upstreamUrl, written, contentType)
                    .then(() => evictCacheIfNeeded(pool))
                    .catch((error) => console.error('写代理缓存索引失败:', error));
            });
        });
    });

    source.on('error', (streamError) => {
        finished = true;
        dropFile();
        const name = streamError && streamError.name;
        if (name === 'AbortError' || name === 'TimeoutError') {
            console.warn(`代理流式转发超时中断（缓存已丢弃）: ${upstreamUrl}`);
        } else if (streamError && streamError.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
            console.error('代理流式转发中断:', streamError);
        }
        res.destroy();
    });

    // 学生端中途断开：停止拉流并丢弃半成品
    res.on('close', () => {
        if (!finished) {
            finished = true;
            try { source.destroy(); } catch { /* 忽略 */ }
            dropFile();
        }
    });
}


// ---------- 令牌签发/校验（无状态 HMAC，密钥复用 TOKEN_SECRET） ----------

function getSecret() {
    const secret = process.env.TOKEN_SECRET;
    if (!secret) {
        throw new Error('TOKEN_SECRET 未配置，无法签发代理令牌');
    }
    return secret;
}

function base64urlEncode(str) {
    return Buffer.from(str, 'utf8').toString('base64url');
}

// 签发令牌：payload = studentId.siteId.exp，sig = HMAC-SHA256(payload)
function signProxyToken(studentId, siteId) {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const payload = `${studentId}.${siteId}.${exp}`;
    const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
    return { token: base64urlEncode(`${payload}.${sig}`), expires_in: TOKEN_TTL_SECONDS };
}

// 校验令牌，失败返回 null
function verifyProxyToken(token) {
    try {
        const decoded = Buffer.from(String(token), 'base64url').toString('utf8');
        const parts = decoded.split('.');
        if (parts.length < 4) return null;
        const sig = parts.pop();
        const exp = parseInt(parts.pop(), 10);
        const siteId = parts.pop();
        const studentId = parts.join('.'); // 学生ID本身可能含点号，取剩余部分
        if (!studentId || !siteId || !Number.isFinite(exp)) return null;
        const payload = `${studentId}.${siteId}.${exp}`;
        const expect = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
        const a = Buffer.from(sig, 'utf8');
        const b = Buffer.from(expect, 'utf8');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
        if (exp < Math.floor(Date.now() / 1000)) return null;
        return { studentId, siteId: parseInt(siteId, 10), exp };
    } catch {
        return null;
    }
}

// ---------- 小工具 ----------

// 域名白名单匹配：前导点通配（.douyin.com 匹配 www.douyin.com 与 douyin.com），其余精确匹配
function domainAllowed(host, domains) {
    const h = String(host || '').toLowerCase();
    for (const raw of domains || []) {
        const d = String(raw).trim().toLowerCase();
        if (!d) continue;
        if (d.startsWith('.')) {
            if (h === d.slice(1) || h.endsWith(d)) return true;
        } else if (h === d) {
            return true;
        }
    }
    return false;
}

// 解析站点 allowed_domains（TEXT 里存 JSON 数组字符串）
function parseDomains(raw) {
    if (!raw) return [];
    try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter(d => typeof d === 'string') : [];
    } catch {
        return [];
    }
}

// 从 Cookie 头取指定名称的值
function getCookie(req, name) {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
    }
    return null;
}

// 转发上游前剥掉代理自身的令牌 Cookie（其余上游 Cookie 原样转发）
function stripTokenCookies(cookieHeader) {
    return (cookieHeader || '')
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('wpt_'))
        .join('; ');
}

// 改写上游 Set-Cookie：去掉 Domain/Secure/SameSite，Path 限定到本站点代理命名空间
function rewriteSetCookie(sc, siteId) {
    const parts = sc.split(';').map(s => s.trim()).filter(p => {
        const lower = p.toLowerCase();
        return lower !== 'secure'
            && !lower.startsWith('domain=')
            && !lower.startsWith('samesite=')
            && !lower.startsWith('path=');
    });
    parts.push(`Path=/api/web-proxy/p/${siteId}/`);
    return parts.join('; ');
}

// 把上游绝对 URL 改写到代理命名空间
// 支持协议相对 URL（//host/path），此时按 fallbackScheme（当前页面的 scheme）处理
function toProxyUrl(siteId, absoluteUrl, fallbackScheme = 'https') {
    try {
        let raw = absoluteUrl;
        if (raw.startsWith('//')) {
            raw = `${fallbackScheme}:${raw}`;
        }
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return absoluteUrl;
        return `/api/web-proxy/p/${siteId}/${u.protocol.replace(':', '')}/${u.host}${u.pathname}${u.search}${u.hash}`;
    } catch {
        return absoluteUrl;
    }
}

// 中文提示页
function tipPage(title, message) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:"Microsoft YaHei",sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;max-width:420px;padding:32px;background:#1e293b;border-radius:12px;border:1px solid #334155}
h1{font-size:20px;margin:0 0 12px;color:#38bdf8}p{font-size:14px;line-height:1.8;color:#94a3b8;margin:0}</style></head>
<body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

// 注入到 HTML 里的 shim 脚本：
// 1. 把 fetch/XHR/window.open 的绝对/协议相对/根相对 URL 改写到代理命名空间
//    （注意：根相对路径 /xxx 解析时浏览器会丢弃 <base> 的路径部分，必须显式改写）
// 2. 捕获阶段拦截链接点击：target=_blank 或未改写的 URL 一律在当前 iframe 内跳转，禁止弹真实浏览器窗口
// （WebSocket 本期不支持）
function shimScript(siteId, scheme, host) {
    return `<script>(function(){var P="/api/web-proxy/p/${siteId}/",S="${scheme}",H="${host}";
function rw(u){try{if(typeof u==="string"){var raw=u;
if(raw.indexOf("//")===0)raw=S+":"+raw;
if(/^https?:\\/\\//i.test(raw)){var a=new URL(raw);return P+a.protocol.replace(":","")+"/"+a.host+a.pathname+a.search+a.hash;}
if(raw.indexOf("/")===0&&raw.indexOf(P)!==0){return P+S+"/"+H+raw;}
}}catch(e){}return u;}
var of=window.fetch;if(of){window.fetch=function(u,o){try{if(typeof u==="string"){u=rw(u);}else if(u&&u.url){u=new Request(rw(u.url),u);}}catch(e){}return of.call(this,u,o);};}
var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var args=Array.prototype.slice.call(arguments);args[1]=rw(u);return oo.apply(this,args);};
// window.open 不弹新窗口，改为当前窗口内跳转（学生场景禁止逃出 iframe）
window.open=function(u){try{if(u){var r=rw(String(u));location.href=r;}}catch(e){}return window;};
// 捕获阶段拦截链接点击：覆盖 JS 动态生成的链接（含根相对路径兜底）
document.addEventListener("click",function(e){try{
var t=e.target;var a=t&&t.closest?t.closest("a[href]"):null;if(!a)return;
var href=a.getAttribute("href")||"";
var rwd=rw(href);
if(rwd!==href){e.preventDefault();location.href=rwd;return;}
if((a.getAttribute("target")||"").toLowerCase()==="_blank"){e.preventDefault();location.href=a.href;}
}catch(err){}},true);
})();</script>`;
}

// HTML 改写：注入 <base> + shim，并把属性里的绝对/协议相对 URL 改写到代理命名空间
function rewriteHtml(html, siteId, scheme, host, reqPath) {
    // base 取当前页面的目录，保证相对路径/根相对路径都落回代理命名空间
    const dir = reqPath.endsWith('/') ? reqPath : reqPath.slice(0, reqPath.lastIndexOf('/') + 1);
    const baseHref = `/api/web-proxy/p/${siteId}/${scheme}/${host}${dir}`;
    const baseTag = `<base href="${baseHref}">`;

    // 改写 src/href/action/poster/data-src 中的绝对 URL（https?://）与协议相对 URL（//host/...）
    html = html.replace(/\b(src|href|action|poster|data-src)\s*=\s*(["'])((?:https?:)?\/\/[^"']+)\2/gi,
        (m, attr, quote, url) => `${attr}=${quote}${toProxyUrl(siteId, url, scheme)}${quote}`);

    // 改写根相对路径（/zd/ids/ 形式）：浏览器解析根相对路径时只取 base 的协议+域名、丢弃路径，
    // 会逃出代理打到前端 SPA 路由上，必须显式改写到代理命名空间
    // 负向前瞻排除：// 协议相对（上一步已处理）、已改写的 /api/web-proxy/ 路径
    const proxyPrefix = `/api/web-proxy/p/${siteId}/${scheme}/${host}`;
    html = html.replace(/\b(src|href|action|poster|data-src)\s*=\s*(["'])(\/(?!\/|api\/web-proxy\/)[^"']*)\2/gi,
        (m, attr, quote, url) => `${attr}=${quote}${proxyPrefix}${url}${quote}`);

    // 改写 srcset 里的候选 URL（逗号分隔的 "url 描述符" 列表）
    html = html.replace(/\bsrcset\s*=\s*(["'])([^"']+)\1/gi, (m, quote, value) => {
        const rewritten = value.split(',').map(part => {
            const seg = part.trim();
            if (!seg) return seg;
            const spIdx = seg.search(/\s/);
            const url = spIdx < 0 ? seg : seg.slice(0, spIdx);
            const desc = spIdx < 0 ? '' : seg.slice(spIdx);
            if (/^(?:https?:)?\/\//i.test(url)) {
                return toProxyUrl(siteId, url, scheme) + desc;
            }
            // 根相对路径同样改写到代理命名空间
            if (url.startsWith('/') && !url.startsWith('/api/web-proxy/')) {
                return proxyPrefix + url + desc;
            }
            return seg;
        }).join(', ');
        return `srcset=${quote}${rewritten}${quote}`;
    });

    // 改写 JS/JSON 数据岛里的转义 URL（http:\/\/host\/path 形式）
    // 只匹配 http(s):\/\/ 开头的完整 URL；JS 字符串中 \/ 等价于 /，直接替换成普通代理路径是安全的
    html = html.replace(/(https?):\\\/\\\/((?:[a-zA-Z0-9.~!$&()*+,;=:@%?#_\-]|\\\/)+)/gi,
        (m, proto, rest) => {
            const unescaped = `${proto}://${rest.replace(/\\\//g, '/')}`;
            return toProxyUrl(siteId, unescaped, scheme);
        });

    // target=_blank（含大小写/单双引号/无引号变体）一律改为 _self，禁止弹真实浏览器窗口
    html = html.replace(/\btarget\s*=\s*(["'])_blank\1/gi, (m, quote) => `target=${quote}_self${quote}`);
    html = html.replace(/\btarget\s*=\s*_blank(?=[\s>])/gi, 'target="_self"');

    if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    } else {
        html = baseTag + html;
    }
    if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, `${shimScript(siteId, scheme, host)}</head>`);
    } else {
        html += shimScript(siteId, scheme, host);
    }
    return html;
}

// CSS 改写：url(...) 中的绝对/协议相对/根相对 URL 改写到代理命名空间
function rewriteCss(css, siteId, scheme = 'https', host = '') {
    css = css.replace(/url\(\s*(["']?)((?:https?:)?\/\/[^)"']+)\1\s*\)/gi,
        (m, quote, url) => `url(${quote}${toProxyUrl(siteId, url, scheme)}${quote})`);
    // 根相对路径 url(/xxx)：同样需要显式改写（host 为空时无法定位上游，跳过）
    if (host) {
        const proxyPrefix = `/api/web-proxy/p/${siteId}/${scheme}/${host}`;
        css = css.replace(/url\(\s*(["']?)(\/(?!\/|api\/web-proxy\/)[^)"']*)\1\s*\)/gi,
            (m, quote, url) => `url(${quote}${proxyPrefix}${url}${quote})`);
    }
    return css;
}

// ---------- 权限/站点缓存（10 秒，教师关闭后最迟 10 秒生效） ----------

const permCache = new Map();  // studentId -> { can, exp }
const siteCache = new Map();  // siteId -> { site, exp }

// 跳转循环熔断器：key(学生|站点|路径) -> 最近请求时间戳数组
const navLoopHits = new Map();
const NAV_LOOP_WINDOW_MS = 10 * 1000; // 统计窗口 10 秒
const NAV_LOOP_MAX_HITS = 6;          // 窗口内同一路径页面级请求上限

// 返回 true 表示命中熔断（同一路径在窗口内被反复请求，判定为反爬 reload 循环）
function hitNavLoopGuard(studentId, siteId, pathKey) {
    const now = Date.now();
    const key = `${studentId}|${siteId}|${pathKey}`;
    let hits = navLoopHits.get(key);
    if (!hits) {
        hits = [];
        navLoopHits.set(key, hits);
    }
    // 只保留窗口内的记录
    const fresh = hits.filter(t => now - t < NAV_LOOP_WINDOW_MS);
    fresh.push(now);
    navLoopHits.set(key, fresh);
    // 定期清理空 key，避免 Map 无限增长
    if (navLoopHits.size > 5000) {
        for (const [k, v] of navLoopHits) {
            if (v.every(t => now - t >= NAV_LOOP_WINDOW_MS)) navLoopHits.delete(k);
        }
    }
    return fresh.length > NAV_LOOP_MAX_HITS;
}

async function canStudentBrowse(pool, studentId) {
    const now = Date.now();
    const hit = permCache.get(studentId);
    if (hit && hit.exp > now) return hit.can;
    const [rows] = await pool.query('SELECT can_use_browser FROM profiles WHERE id = ?', [studentId]);
    const can = rows.length > 0 && (rows[0].can_use_browser === 1 || rows[0].can_use_browser === true);
    permCache.set(studentId, { can, exp: now + 10000 });
    return can;
}

async function getEnabledSite(pool, siteId) {
    const now = Date.now();
    const hit = siteCache.get(siteId);
    if (hit && hit.exp > now) return hit.site;
    const [rows] = await pool.query('SELECT * FROM proxy_sites WHERE id = ?', [siteId]);
    const site = rows.length > 0 && (rows[0].enabled === 1 || rows[0].enabled === true) ? rows[0] : null;
    siteCache.set(siteId, { site, exp: now + 10000 });
    return site;
}

// 记录未白名单域名（命中次数+1）
async function recordPendingDomain(pool, domain, siteId) {
    try {
        await pool.query(`
            INSERT INTO proxy_pending_domains (domain, site_id, hit_count, first_seen_at, last_seen_at)
            VALUES (?, ?, 1, NOW(), NOW())
            ON DUPLICATE KEY UPDATE hit_count = hit_count + 1, last_seen_at = NOW()
        `, [domain, siteId]);
    } catch (error) {
        console.error('记录待审核域名失败:', error);
    }
}

// 使上网权限缓存失效（通知/测试/考试开通权限后调用，即时生效；不传 studentId 则全清）
function invalidateProxyPerm(studentId) {
    if (studentId) {
        permCache.delete(studentId);
    } else {
        permCache.clear();
    }
}

// ---------- 路由注册 ----------

function registerWebProxy(app, pool, authenticate, requireTeacher, requireStudent) {

    // 校验班级归属当前教师，失败时已写响应并返回 false
    async function assertTeacherOwnsClass(req, res, classId) {
        const [classRows] = await pool.query('SELECT id, teacher_id FROM classes WHERE id = ?', [classId]);
        if (classRows.length === 0) {
            res.status(404).json({ data: null, error: '班级不存在' });
            return false;
        }
        if (classRows[0].teacher_id !== req.user.userId) {
            res.status(403).json({ data: null, error: '无权限访问该班级' });
            return false;
        }
        return true;
    }

    // ========== 中转代理路由（自验 HMAC 令牌，不挂 authenticate） ==========

    const proxyHandler = async (req, res) => {
        const siteId = parseInt(req.params.siteId, 10);
        const scheme = String(req.params.scheme || '').toLowerCase();
        const host = String(req.params.host || '');
        const rest = req.params[0] || '';

        // 基础参数校验
        if (!Number.isFinite(siteId) || (scheme !== 'http' && scheme !== 'https')
            || !/^[a-zA-Z0-9.-]+(:\d+)?$/.test(host) || host.includes('..')) {
            return res.status(400).send(tipPage('请求无效', '代理地址格式不正确。'));
        }

        try {
            // 1. 验令牌：优先 Cookie（按站点路径隔离），兼容 query 参数 pt
            const token = getCookie(req, `wpt_${siteId}`) || req.query.pt;
            const auth = token ? verifyProxyToken(token) : null;
            if (!auth || auth.siteId !== siteId) {
                return res.status(401).send(tipPage('登录状态已失效', '上网凭证无效或已过期，请回到站点导航页重新进入。'));
            }

            // 2. 每次请求都确认学生权限与站点启用状态（教师关闭即时生效，带 10 秒缓存）
            const [canBrowse, site] = await Promise.all([
                canStudentBrowse(pool, auth.studentId),
                getEnabledSite(pool, siteId),
            ]);
            if (!canBrowse) {
                return res.status(403).send(tipPage('上网权限已关闭', '老师已关闭你的上网权限，如有需要请联系老师开通。'));
            }
            if (!site) {
                return res.status(403).send(tipPage('站点已停用', '该站点已被老师停用或删除。'));
            }

            // 3. 域名白名单校验（不带端口比较）
            const hostname = host.split(':')[0];
            const allowedDomains = parseDomains(site.allowed_domains);
            if (!domainAllowed(hostname, allowedDomains)) {
                await recordPendingDomain(pool, hostname, siteId);
                return res.status(403).send(tipPage('域名未在白名单', `资源域名「${hostname}」不在本站点的允许列表中，已通知老师审核，通过后自动生效。`));
            }

            // 3.5 跳转循环熔断：头条等站点反爬挑战页会 JS 反复 reload 同一路径（query 变化），
            // 浏览器最终报"重定向次数过多"。对页面级 GET 按 学生+站点+路径 计 10 秒窗口内的次数，
            // 超过阈值直接回中文提示页，避免学生浏览器卡死循环
            {
                const dest = req.headers['sec-fetch-dest'] || '';
                const isDocumentGet = req.method === 'GET' && (dest === '' || dest === 'document' || dest === 'iframe');
                if (isDocumentGet && hitNavLoopGuard(auth.studentId, siteId, `${scheme}://${host}/${rest}`)) {
                    return res.status(200).send(tipPage('页面无法通过校园代理访问',
                        '该网站触发了反爬安全验证，页面在反复跳转。这类网站暂时无法通过校园代理打开，请回主页选择其他站点，或联系老师更换同类站点。'));
                }
            }

            // 4. 重建上游 URL（去掉 pt 参数，保留其余 query）
            let qs = '';
            const qIdx = req.originalUrl.indexOf('?');
            if (qIdx >= 0) {
                qs = req.originalUrl.slice(qIdx + 1)
                    .split('&')
                    .filter(p => p && !p.startsWith('pt='))
                    .join('&');
            }
            const upstreamUrl = `${scheme}://${host}/${encodeURI(rest)}${qs ? '?' + qs : ''}`;

            // 4.5 静态资源磁盘缓存：命中直接由磁盘返回（含 Range 切片），不再消耗外网带宽
            try {
                if (await tryServeFromCache(pool, req, res, siteId, scheme, host, upstreamUrl)) return;
            } catch (cacheError) {
                console.error('读取代理缓存失败（按未命中继续）:', cacheError);
            }

            // 5. 构造转发请求头（去掉hop-by-hop与身份相关头，Cookie 剥掉代理令牌，强制 identity 以便改写内容）
            const headers = {};
            for (const [key, value] of Object.entries(req.headers)) {
                const lower = key.toLowerCase();
                if (['host', 'connection', 'content-length', 'referer', 'origin', 'accept-encoding'].includes(lower)) continue;
                if (lower === 'cookie') {
                    const stripped = stripTokenCookies(value);
                    if (stripped) headers.cookie = stripped;
                    continue;
                }
                headers[key] = value;
            }
            headers['accept-encoding'] = 'identity';

            // 6. 请求体：express.json 已消耗的用缓存的 rawBody，未被解析的直接 pipe 流
            const fetchOptions = {
                method: req.method,
                headers,
                redirect: 'manual',
                signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            };
            if (!['GET', 'HEAD'].includes(req.method)) {
                if (req.rawBody && req.rawBody.length > 0) {
                    fetchOptions.body = req.rawBody;
                } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
                    fetchOptions.body = JSON.stringify(req.body);
                } else {
                    fetchOptions.body = req;
                    fetchOptions.duplex = 'half';
                }
            }

            const upstream = await fetch(upstreamUrl, fetchOptions);

            // 7. 3xx 重定向：改写 Location 到代理命名空间
            if (upstream.status >= 300 && upstream.status < 400) {
                const location = upstream.headers.get('location');
                if (location) {
                    const absolute = new URL(location, upstreamUrl).toString();
                    res.setHeader('location', toProxyUrl(siteId, absolute));
                }
                res.status(upstream.status).end();
                upstream.body?.cancel().catch(() => {});
                return;
            }

            const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
            const isHtml = contentType.includes('text/html');
            const isCss = contentType.includes('text/css');

            // 8. 响应头：strip 安全/分帧相关头，CORS 放开，Set-Cookie 按站点路径隔离
            const stripHeaders = new Set([
                'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
                'te', 'trailer', 'transfer-encoding', 'upgrade',
                'content-security-policy', 'content-security-policy-report-only',
                'x-frame-options', 'content-length', 'set-cookie',
            ]);
            for (const [key, value] of upstream.headers.entries()) {
                if (stripHeaders.has(key)) continue;
                res.setHeader(key, value);
            }
            res.setHeader('access-control-allow-origin', '*');
            const setCookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
            for (const sc of setCookies) {
                res.append('set-cookie', rewriteSetCookie(sc, siteId));
            }

            // 可缓存响应的公共判定：请求侧 GET 且无 Range（带 Range 的首次请求不缓存，绕过直通）；
            // 响应侧 200 + 无 Set-Cookie + Cache-Control 未带 no-store/no-cache/private
            const responseCacheable = req.method === 'GET' && !req.headers.range
                && upstream.status === 200
                && setCookies.length === 0
                && !/(no-store|no-cache|private)/i.test(upstream.headers.get('cache-control') || '');
            const cacheSettings = responseCacheable ? await getCacheSettings(pool) : null;
            const mayWriteCache = responseCacheable && cacheSettings && cacheSettings.enabled === 1;

            // 9. HTML：注入 base + shim + 改写绝对 URL；主文档写访问记录
            if (isHtml) {
                const text = await upstream.text();
                const limited = text.length > REWRITE_BODY_LIMIT ? text.slice(0, REWRITE_BODY_LIMIT) : text;
                const reqPath = '/' + rest;
                const rewritten = rewriteHtml(limited, siteId, scheme, host, reqPath);

                // 仅记录页面级访问（主文档/iframe 文档，XHR 不记）
                const dest = req.headers['sec-fetch-dest'] || '';
                if (req.method === 'GET' && (dest === '' || dest === 'document' || dest === 'iframe')) {
                    pool.query(
                        'INSERT INTO proxy_access_log (student_id, site_id, url, created_at) VALUES (?, ?, ?, NOW())',
                        [auth.studentId, siteId, upstreamUrl.slice(0, 1000)]
                    ).catch(err => console.error('写代理访问记录失败:', err));
                }

                res.status(upstream.status).send(rewritten);
                return;
            }

            // 10. CSS：改写 url(...) 绝对/协议相对地址
            if (isCss) {
                const text = await upstream.text();
                const limited = text.length > REWRITE_BODY_LIMIT ? text.slice(0, REWRITE_BODY_LIMIT) : text;
                // 上游原文入缓存（命中时重新改写）；被截断的超大 CSS 不缓存
                if (mayWriteCache && text.length <= REWRITE_BODY_LIMIT) {
                    res.setHeader('x-proxy-cache', 'MISS');
                    writeBufferToCache(pool, upstreamUrl, Buffer.from(text, 'utf8'), contentType)
                        .catch((e) => console.error('CSS写代理缓存失败:', e));
                } else {
                    res.setHeader('x-proxy-cache', 'BYPASS');
                }
                res.status(upstream.status).send(rewriteCss(limited, siteId, scheme, host));
                return;
            }

            // 11. 其余（图片/视频/JS/字体等）：流式透传，Range/206 自然生效
            const upstreamLen = upstream.headers.get('content-length');
            if (upstreamLen) res.setHeader('content-length', upstreamLen);
            res.status(upstream.status);
            if (!upstream.body) {
                res.end();
                return;
            }
            // 可缓存静态资源：透传的同时 tee 一份写磁盘缓存（超过 200MB 的不缓存）
            if (mayWriteCache && isCacheableContentType(contentType)
                && (!upstreamLen || parseInt(upstreamLen, 10) <= MAX_CACHE_FILE_BYTES)) {
                res.setHeader('x-proxy-cache', 'MISS');
                streamToClientWithCache(pool, Readable.fromWeb(upstream.body), res, upstreamUrl, contentType);
                return;
            }
            res.setHeader('x-proxy-cache', 'BYPASS');
            // 用 pipeline 转发并捕获流错误：
            // 上游 30s 超时（AbortController）或学生端中途断开时 body 流会发 error，
            // 裸 pipe 不挂 error 处理器会让整个进程崩溃，这里必须兜底
            try {
                await pipeline(Readable.fromWeb(upstream.body), res);
            } catch (streamError) {
                // 响应头已发出（状态行/内容已开始传输），只能静默断开，绝不冒泡
                const name = streamError && streamError.name;
                if (name === 'AbortError' || name === 'TimeoutError') {
                    console.warn(`代理流式转发超时中断: ${upstreamUrl}`);
                } else if (streamError && streamError.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
                    console.error('代理流式转发中断:', streamError);
                }
                res.destroy();
            }
        } catch (error) {
            if (res.headersSent) {
                res.end();
                return;
            }
            if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
                return res.status(504).send(tipPage('访问超时', '目标网站响应超时，请稍后重试。'));
            }
            console.error('代理转发失败:', error);
            res.status(502).send(tipPage('访问失败', '无法连接到目标网站，请稍后重试或联系老师。'));
        }
    };

    // 无路径时补斜杠重定向（如 /api/web-proxy/p/3/https/www.douyin.com → .../）
    // 注意 Express 非严格路由下带斜杠的入口路径也会命中本路由，此时直接转交 proxyHandler
    app.all('/api/web-proxy/p/:siteId/:scheme/:host', (req, res, next) => {
        if (req.path.endsWith('/')) {
            return proxyHandler(req, res, next);
        }
        const qIdx = req.originalUrl.indexOf('?');
        const qs = qIdx >= 0 ? req.originalUrl.slice(qIdx) : '';
        res.redirect(`${req.path}/${qs}`);
    });
    app.all('/api/web-proxy/p/:siteId/:scheme/:host/*', proxyHandler);

    // ========== 教师路由 ==========

    // 站点列表
    app.get('/api/teacher/proxy/sites', authenticate, requireTeacher, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM proxy_sites ORDER BY sort_order ASC, id ASC');
            const sites = rows.map(s => ({ ...s, allowed_domains: parseDomains(s.allowed_domains) }));
            res.json({ data: sites, error: null });
        } catch (error) {
            console.error('Error in GET /api/teacher/proxy/sites:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 新增站点
    app.post('/api/teacher/proxy/sites', authenticate, requireTeacher, async (req, res) => {
        try {
            const { name, url, icon, enabled, sort_order, allowed_domains } = req.body || {};
            if (!name || !url) {
                return res.status(400).json({ data: null, error: '站点名称和URL不能为空' });
            }
            let parsedUrl;
            try {
                parsedUrl = new URL(url);
            } catch {
                return res.status(400).json({ data: null, error: 'URL格式不正确' });
            }
            // 域名白名单为空时默认放行主域名及其子域
            let domains = Array.isArray(allowed_domains) ? allowed_domains.map(d => String(d).trim()).filter(Boolean) : [];
            if (domains.length === 0) {
                domains = [parsedUrl.host, '.' + parsedUrl.host];
            }
            const [result] = await pool.query(
                'INSERT INTO proxy_sites (name, url, icon, enabled, sort_order, allowed_domains) VALUES (?, ?, ?, ?, ?, ?)',
                [name, url, icon || null, enabled ? 1 : 0, Number.isFinite(+sort_order) ? +sort_order : 0, JSON.stringify(domains)]
            );
            res.json({ data: { id: result.insertId }, error: null });
        } catch (error) {
            console.error('Error in POST /api/teacher/proxy/sites:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 修改站点
    app.put('/api/teacher/proxy/sites/:id', authenticate, requireTeacher, async (req, res) => {
        try {
            const { id } = req.params;
            const { name, url, icon, enabled, sort_order, allowed_domains } = req.body || {};
            if (!name || !url) {
                return res.status(400).json({ data: null, error: '站点名称和URL不能为空' });
            }
            try {
                new URL(url);
            } catch {
                return res.status(400).json({ data: null, error: 'URL格式不正确' });
            }
            const domains = Array.isArray(allowed_domains) ? allowed_domains.map(d => String(d).trim()).filter(Boolean) : [];
            const [result] = await pool.query(
                'UPDATE proxy_sites SET name = ?, url = ?, icon = ?, enabled = ?, sort_order = ?, allowed_domains = ? WHERE id = ?',
                [name, url, icon || null, enabled ? 1 : 0, Number.isFinite(+sort_order) ? +sort_order : 0, JSON.stringify(domains), id]
            );
            if (result.affectedRows === 0) {
                return res.status(404).json({ data: null, error: '站点不存在' });
            }
            siteCache.delete(Number(id)); // 立即失效缓存
            res.json({ data: { success: true }, error: null });
        } catch (error) {
            console.error('Error in PUT /api/teacher/proxy/sites/:id:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 删除站点
    app.delete('/api/teacher/proxy/sites/:id', authenticate, requireTeacher, async (req, res) => {
        try {
            const { id } = req.params;
            const [result] = await pool.query('DELETE FROM proxy_sites WHERE id = ?', [id]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ data: null, error: '站点不存在' });
            }
            siteCache.delete(Number(id));
            res.json({ data: { success: true }, error: null });
        } catch (error) {
            console.error('Error in DELETE /api/teacher/proxy/sites/:id:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 一键获取站点信息：抓取页面，提取标题/图标/子资源域名
    app.post('/api/teacher/proxy/fetch-site-info', authenticate, requireTeacher, async (req, res) => {
        try {
            const { url } = req.body || {};
            if (!url) {
                return res.status(400).json({ data: null, error: 'URL不能为空' });
            }
            let parsedUrl;
            try {
                parsedUrl = new URL(url);
            } catch {
                return res.status(400).json({ data: null, error: 'URL格式不正确' });
            }

            let upstream;
            try {
                upstream = await fetch(url, {
                    redirect: 'follow',
                    signal: AbortSignal.timeout(FETCH_SITE_INFO_TIMEOUT_MS),
                    headers: {
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                        'accept': 'text/html,application/xhtml+xml',
                    },
                });
            } catch (error) {
                const isTimeout = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
                return res.status(502).json({ data: null, error: isTimeout ? '抓取超时（10秒），请确认网址可访问' : '无法连接到目标网站：' + error.message });
            }
            if (!upstream.ok) {
                return res.status(502).json({ data: null, error: `目标网站返回 ${upstream.status}，无法抓取` });
            }

            const html = (await upstream.text()).slice(0, 2 * 1024 * 1024);

            // 标题
            const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : '';

            // 网站图标（相对地址转绝对）
            let favicon = null;
            const linkMatch = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i)
                || html.match(/<link[^>]+href=["'][^"']+["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i);
            if (linkMatch) {
                const hrefMatch = linkMatch[0].match(/href=["']([^"']+)["']/i);
                if (hrefMatch) {
                    try {
                        favicon = new URL(hrefMatch[1], url).toString();
                    } catch { /* 忽略无法解析的图标地址 */ }
                }
            }

            // 提取所有资源 URL 的域名（src/href/action），去重排序
            const domainSet = new Set([parsedUrl.host]);
            const attrRegex = /(?:src|href|action)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
            let m;
            while ((m = attrRegex.exec(html)) !== null) {
                try {
                    domainSet.add(new URL(m[1]).host);
                } catch { /* 忽略无法解析的URL */ }
            }
            const domains = Array.from(domainSet).sort();

            res.json({ data: { title, favicon, domains }, error: null });
        } catch (error) {
            console.error('Error in POST /api/teacher/proxy/fetch-site-info:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 待审核域名列表
    app.get('/api/teacher/proxy/pending-domains', authenticate, requireTeacher, async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT pd.*, ps.name AS site_name
                FROM proxy_pending_domains pd
                LEFT JOIN proxy_sites ps ON ps.id = pd.site_id
                ORDER BY pd.last_seen_at DESC
            `);
            res.json({ data: rows, error: null });
        } catch (error) {
            console.error('Error in GET /api/teacher/proxy/pending-domains:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 一键批准：把全部待审核域名批量并入指定站点白名单（事务，去重）
    // 注意必须注册在 :id 路由之前，否则 all 会被当成 id
    app.post('/api/teacher/proxy/pending-domains/approve-all', authenticate, requireTeacher, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            const { site_id } = req.body || {};
            if (!site_id) {
                return res.status(400).json({ data: null, error: '请选择要并入的站点' });
            }
            await connection.beginTransaction();
            const [siteRows] = await connection.query('SELECT * FROM proxy_sites WHERE id = ? FOR UPDATE', [site_id]);
            if (siteRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ data: null, error: '站点不存在' });
            }
            const [pendingRows] = await connection.query('SELECT domain FROM proxy_pending_domains FOR UPDATE');
            const domains = parseDomains(siteRows[0].allowed_domains);
            let added = 0;
            for (const row of pendingRows) {
                if (!domains.includes(row.domain)) {
                    domains.push(row.domain);
                    added++;
                }
            }
            await connection.query('UPDATE proxy_sites SET allowed_domains = ? WHERE id = ?', [JSON.stringify(domains), site_id]);
            await connection.query('DELETE FROM proxy_pending_domains');
            await connection.commit();
            siteCache.delete(Number(site_id));
            res.json({ data: { success: true, approved: pendingRows.length, added }, error: null });
        } catch (error) {
            try { await connection.rollback(); } catch { /* 回滚失败忽略 */ }
            console.error('Error in POST /api/teacher/proxy/pending-domains/approve-all:', error);
            res.status(500).json({ data: null, error: error.message });
        } finally {
            connection.release();
        }
    });

    // 一键清空：删除全部待审核记录（注册在 :id 之前）
    app.delete('/api/teacher/proxy/pending-domains/all', authenticate, requireTeacher, async (req, res) => {
        try {
            const [result] = await pool.query('DELETE FROM proxy_pending_domains');
            res.json({ data: { success: true, deleted: result.affectedRows }, error: null });
        } catch (error) {
            console.error('Error in DELETE /api/teacher/proxy/pending-domains/all:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 批准待审域名：并入指定站点白名单后删除记录
    app.post('/api/teacher/proxy/pending-domains/:id/approve', authenticate, requireTeacher, async (req, res) => {
        try {
            const { id } = req.params;
            const { site_id } = req.body || {};
            if (!site_id) {
                return res.status(400).json({ data: null, error: '请选择要并入的站点' });
            }
            const [pendingRows] = await pool.query('SELECT * FROM proxy_pending_domains WHERE id = ?', [id]);
            if (pendingRows.length === 0) {
                return res.status(404).json({ data: null, error: '记录不存在' });
            }
            const [siteRows] = await pool.query('SELECT * FROM proxy_sites WHERE id = ?', [site_id]);
            if (siteRows.length === 0) {
                return res.status(404).json({ data: null, error: '站点不存在' });
            }
            const domain = pendingRows[0].domain;
            const domains = parseDomains(siteRows[0].allowed_domains);
            if (!domains.includes(domain)) {
                domains.push(domain);
            }
            await pool.query('UPDATE proxy_sites SET allowed_domains = ? WHERE id = ?', [JSON.stringify(domains), site_id]);
            await pool.query('DELETE FROM proxy_pending_domains WHERE id = ?', [id]);
            siteCache.delete(Number(site_id));
            res.json({ data: { success: true }, error: null });
        } catch (error) {
            console.error('Error in POST /api/teacher/proxy/pending-domains/:id/approve:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 忽略（删除）待审域名
    app.delete('/api/teacher/proxy/pending-domains/:id', authenticate, requireTeacher, async (req, res) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM proxy_pending_domains WHERE id = ?', [id]);
            res.json({ data: { success: true }, error: null });
        } catch (error) {
            console.error('Error in DELETE /api/teacher/proxy/pending-domains/:id:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 单人上网开关
    app.post('/api/teacher/proxy/students/:studentId/permission', authenticate, requireTeacher, async (req, res) => {
        try {
            const { studentId } = req.params;
            const canUse = !!(req.body || {}).can_use_browser;
            const [rows] = await pool.query('SELECT id, class_id, role FROM profiles WHERE id = ?', [studentId]);
            if (rows.length === 0 || rows[0].role !== 'student') {
                return res.status(404).json({ data: null, error: '学生不存在' });
            }
            // 校验该学生属于当前教师的班级
            const [classRows] = await pool.query('SELECT teacher_id FROM classes WHERE id = ?', [rows[0].class_id]);
            if (classRows.length === 0 || classRows[0].teacher_id !== req.user.userId) {
                return res.status(403).json({ data: null, error: '无权限管理该学生' });
            }
            await pool.query('UPDATE profiles SET can_use_browser = ? WHERE id = ?', [canUse ? 1 : 0, studentId]);
            permCache.delete(studentId); // 立即生效
            res.json({ data: { success: true, can_use_browser: canUse }, error: null });
        } catch (error) {
            console.error('Error in POST /api/teacher/proxy/students/:studentId/permission:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 班级批量上网开关
    app.post('/api/teacher/proxy/classes/:classId/permission', authenticate, requireTeacher, async (req, res) => {
        try {
            const { classId } = req.params;
            if (!(await assertTeacherOwnsClass(req, res, classId))) return;
            const canUse = !!(req.body || {}).can_use_browser;
            const [result] = await pool.query(
                "UPDATE profiles SET can_use_browser = ? WHERE class_id = ? AND role = 'student'",
                [canUse ? 1 : 0, classId]
            );
            permCache.clear(); // 批量变更，整体失效缓存
            res.json({ data: { success: true, can_use_browser: canUse, affected: result.affectedRows }, error: null });
        } catch (error) {
            console.error('Error in POST /api/teacher/proxy/classes/:classId/permission:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 访问记录（简单版，支持班级过滤）
    app.get('/api/teacher/proxy/access-log', authenticate, requireTeacher, async (req, res) => {
        try {
            const classId = req.query.class_id;
            let limit = parseInt(req.query.limit, 10);
            if (!Number.isFinite(limit) || limit < 1) limit = 100;
            if (limit > 500) limit = 500;

            const params = [req.user.userId];
            let sql = `
                SELECT l.id, l.student_id, p.real_name, p.username, p.class_id,
                       l.site_id, s.name AS site_name, l.url, l.created_at
                FROM proxy_access_log l
                LEFT JOIN profiles p ON p.id = l.student_id
                LEFT JOIN proxy_sites s ON s.id = l.site_id
                WHERE p.class_id IN (SELECT id FROM classes WHERE teacher_id = ?)
            `;
            if (classId) {
                if (!(await assertTeacherOwnsClass(req, res, classId))) return;
                sql += ' AND p.class_id = ?';
                params.push(classId);
            }
            sql += ' ORDER BY l.created_at DESC LIMIT ?';
            params.push(limit);
            const [rows] = await pool.query(sql, params);
            res.json({ data: rows, error: null });
        } catch (error) {
            console.error('Error in GET /api/teacher/proxy/access-log:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // ========== 静态资源缓存管理（教师） ==========

    // 缓存设置与用量（多机房隔离：用量为本机实例口径，返回 instance_id 供前端区分机器）
    app.get('/api/teacher/proxy/cache/settings', authenticate, requireTeacher, async (req, res) => {
        try {
            const settings = await getCacheSettings(pool);
            const [stats] = await pool.query(
                'SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes, COUNT(*) AS file_count FROM proxy_cache_files WHERE instance_id = ?',
                [INSTANCE_ID]
            );
            res.json({
                data: {
                    enabled: settings.enabled,
                    limit_mb: settings.limitMb,
                    cache_dir: CACHE_DIR,
                    instance_id: INSTANCE_ID,
                    total_bytes: Number(stats[0].total_bytes) || 0,
                    file_count: Number(stats[0].file_count) || 0,
                },
                error: null,
            });
        } catch (error) {
            console.error('Error in GET /api/teacher/proxy/cache/settings:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 修改缓存设置（limit 校验 100~51200 MB，即 100MB~50GB）
    app.put('/api/teacher/proxy/cache/settings', authenticate, requireTeacher, async (req, res) => {
        try {
            const { enabled, limit_mb } = req.body || {};
            const limitNum = parseInt(limit_mb, 10);
            if (!Number.isFinite(limitNum) || limitNum < 100 || limitNum > 51200) {
                return res.status(400).json({ data: null, error: '缓存上限需在 100~51200 MB（100MB~50GB）之间' });
            }
            await upsertSystemConfig(pool, 'proxy_cache_enabled', enabled ? 1 : 0);
            await upsertSystemConfig(pool, 'proxy_cache_limit_mb', limitNum);
            invalidateCacheSettings();
            // 上限调小后立即触发一次淘汰检查
            evictCacheIfNeeded(pool).catch(() => {});
            res.json({ data: { success: true, enabled: enabled ? 1 : 0, limit_mb: limitNum }, error: null });
        } catch (error) {
            console.error('Error in PUT /api/teacher/proxy/cache/settings:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 清空缓存：只删本机实例的文件（文件名带实例前缀）与本机索引记录，其他机房不受影响
    app.post('/api/teacher/proxy/cache/clear', authenticate, requireTeacher, async (req, res) => {
        try {
            const [stats] = await pool.query(
                'SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM proxy_cache_files WHERE instance_id = ?',
                [INSTANCE_ID]
            );
            const freed = Number(stats[0].total_bytes) || 0;
            let removed = 0;
            const prefix = `${INSTANCE_ID}-`;
            try {
                for (const name of fs.readdirSync(CACHE_DIR)) {
                    if (!name.startsWith(prefix)) continue;
                    try {
                        fs.unlinkSync(path.join(CACHE_DIR, name));
                        removed++;
                    } catch { /* 单个文件删除失败不阻塞整体清空 */ }
                }
            } catch { /* 目录不存在视为已清空 */ }
            await pool.query('DELETE FROM proxy_cache_files WHERE instance_id = ?', [INSTANCE_ID]);
            res.json({ data: { success: true, freed_bytes: freed, removed_files: removed }, error: null });
        } catch (error) {
            console.error('Error in POST /api/teacher/proxy/cache/clear:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // ========== 学生路由 ==========

    // 上网权限状态
    app.get('/api/student/proxy/status', authenticate, requireStudent, async (req, res) => {
        try {
            const can = await canStudentBrowse(pool, req.user.userId);
            res.json({ data: { can_use_browser: can }, error: null });
        } catch (error) {
            console.error('Error in GET /api/student/proxy/status:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 可见站点列表（无权限返回空数组，不报错，前端好处理）
    app.get('/api/student/proxy/sites', authenticate, requireStudent, async (req, res) => {
        try {
            const can = await canStudentBrowse(pool, req.user.userId);
            if (!can) {
                return res.json({ data: { can_use_browser: false, sites: [] }, error: null });
            }
            const [rows] = await pool.query(
                'SELECT id, name, url, icon, sort_order FROM proxy_sites WHERE enabled = 1 ORDER BY sort_order ASC, id ASC'
            );
            res.json({ data: { can_use_browser: true, sites: rows }, error: null });
        } catch (error) {
            console.error('Error in GET /api/student/proxy/sites:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });

    // 签发 iframe 令牌：返回 JSON 的同时写 wpt_{siteId} Cookie（按站点路径隔离，子资源请求自动携带）
    app.get('/api/student/proxy/token', authenticate, requireStudent, async (req, res) => {
        try {
            const siteId = parseInt(req.query.site_id, 10);
            if (!Number.isFinite(siteId)) {
                return res.status(400).json({ data: null, error: '缺少有效的 site_id 参数' });
            }
            const can = await canStudentBrowse(pool, req.user.userId);
            if (!can) {
                return res.status(403).json({ data: null, error: '老师尚未开通你的上网权限' });
            }
            const site = await getEnabledSite(pool, siteId);
            if (!site) {
                return res.status(404).json({ data: null, error: '站点不存在或已停用' });
            }
            const { token, expires_in } = signProxyToken(req.user.userId, siteId);
            res.append('set-cookie',
                `wpt_${siteId}=${token}; Path=/api/web-proxy/p/${siteId}; HttpOnly; SameSite=Lax; Max-Age=${expires_in}`);
            res.json({ data: { token, expires_in }, error: null });
        } catch (error) {
            console.error('Error in GET /api/student/proxy/token:', error);
            res.status(500).json({ data: null, error: error.message });
        }
    });
}

module.exports = { registerWebProxy, rewriteHtml, rewriteCss, invalidateProxyPerm };
