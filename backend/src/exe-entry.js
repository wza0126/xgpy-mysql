process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.XGPY_SERVE_FRONTEND = 'true';

require('./env');

const fs = require('fs');
const path = require('path');
const express = require('express');
const { app, startServer } = require('./index');

// 内嵌在 exe 里的前端（pkg 快照，读取时需要解压）
const bundledDist = path.join(__dirname, '..', 'exe-assets', 'frontend-dist');
// 解压到 exe 同级的 public 目录：走真实磁盘 + 系统文件缓存，
// 避免「每次请求都从内嵌快照解压 3.6MB 主包」在高并发下把 CPU 拖满。
const publicDir = path.join(path.dirname(process.execPath), 'public');

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.writeFileSync(d, fs.readFileSync(s));
  }
}

/** 用 index.html 里引用的主包文件名当「这一版前端」的指纹 */
function assetStamp(htmlText) {
  const m = String(htmlText || '').match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : '';
}

/**
 * 把内嵌前端解压到磁盘。指纹一致就复用，不重复解压。
 * 解压失败时回退到内嵌快照，保证功能可用（只是慢一点）。
 */
function materializeFrontend() {
  try {
    const srcIndex = path.join(bundledDist, 'index.html');
    if (!fs.existsSync(srcIndex)) {
      console.warn('[frontend] 内嵌前端不存在，跳过解压');
      return bundledDist;
    }
    const wantStamp = assetStamp(fs.readFileSync(srcIndex, 'utf-8'));
    const stampFile = path.join(publicDir, '.build-stamp');

    if (fs.existsSync(path.join(publicDir, 'index.html')) && fs.existsSync(stampFile)) {
      const haveStamp = fs.readFileSync(stampFile, 'utf-8').trim();
      if (wantStamp && haveStamp === wantStamp) {
        console.log(`[frontend] 磁盘前端已是最新 (${wantStamp})`);
        return publicDir;
      }
    }

    const t0 = Date.now();
    rmDir(publicDir);
    copyDir(bundledDist, publicDir);
    fs.writeFileSync(stampFile, wantStamp || String(Date.now()));
    console.log(`[frontend] 前端已解压到磁盘: ${publicDir} (${Date.now() - t0}ms, stamp=${wantStamp})`);
    return publicDir;
  } catch (e) {
    console.warn('[frontend] 解压失败，回退到内嵌快照:', e.message);
    return bundledDist;
  }
}

const serveDir = materializeFrontend();

// 带 hash 的资源永久缓存：学生只需下载一次 3.6MB 主包，之后都走本地缓存
app.use('/assets', express.static(path.join(serveDir, 'assets'), {
  maxAge: '365d',
  immutable: true,
  fallthrough: true,
}));

// 其余静态文件缓存 1 小时
app.use(express.static(serveDir, { maxAge: '1h', index: false, fallthrough: true }));

// SPA 兜底：index.html 不缓存，发版后刷新就能拿到新资源
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(serveDir, 'index.html'));
});

startServer().catch((error) => {
  console.error('Failed to start XGPY exe server:', error);
  process.exit(1);
});
