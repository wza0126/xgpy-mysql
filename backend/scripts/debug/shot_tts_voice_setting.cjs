#!/usr/bin/env node
/**
 * shot_tts_voice_setting.cjs —— 截「系统配置 → AI设置 → 默认发音人」这一块（含试听按钮）。
 * 用法：node scripts/debug/shot_tts_voice_setting.cjs
 * 前置：前端 dev 3266 + 后端 3101 都在跑。
 */
const path = require('path');
const fs = require('fs');
const { launchHeadless } = require('./lib/cdp.cjs');

const BASE = process.env.XGPY_FE || 'http://127.0.0.1:3266';
const SHOT_DIR = path.join(__dirname, '..', '..', '..', '.workbuddy', 'shots');
const TEACHER = { user: 'teacher', pwd: 'xgpy666' };

(async () => {
  const cdp = await launchHeadless({ port: 9471, userDataDir: path.join(__dirname, '..', '..', '.tmp-chrome-voice') });
  try {
    await cdp.ws.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    const go = async () => { await cdp.evalJs(`location.href = ${JSON.stringify(BASE + '/')}; 'go'`); await cdp.sleep(2600); };
    await go();
    await cdp.evalJs(`(async () => {
      const r = await fetch('/api/auth/secure-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ${JSON.stringify(TEACHER.user)}, password: ${JSON.stringify(TEACHER.pwd)}, deviceInfo: 'shot-voice' })
      });
      const j = await r.json();
      const t = j && j.data && j.data.session && j.data.session.access_token;
      if (t) { localStorage.setItem('xgpy_token', t); localStorage.setItem('xgpy_user', JSON.stringify(j.data.user)); }
      return t ? 'ok' : 'fail';
    })()`);
    await go();
    // 进「系统配置」
    await cdp.evalJs(`(() => {
      const all = [...document.querySelectorAll('button,a,div,li,span')].filter(e => e.offsetParent !== null);
      const hit = all.filter(e => (e.textContent || '').replace(/\\s+/g, ' ').trim() === '系统配置')
                     .sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!hit) return 'notfound';
      (hit.closest('button,a,[role=button]') || hit).click();
      return 'ok';
    })()`);
    await cdp.sleep(1800);
    // 滚到「默认发音人」可见
    const scrolled = await cdp.evalJs(`(() => {
      const lab = [...document.querySelectorAll('label')].find(l => (l.textContent || '').includes('默认发音人'));
      if (!lab) return 'notfound';
      (lab.closest('.rounded-xl') || lab.parentElement).scrollIntoView({ block: 'center' });
      return 'ok';
    })()`);
    console.log('滚动到发音人区域：', scrolled);
    await cdp.sleep(600);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const r = await cdp.ws.send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(SHOT_DIR, 'tts_voice_setting.png');
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('📸 ' + p);
  } catch (e) {
    console.error('截图失败：', e.message);
    process.exitCode = 1;
  } finally {
    try { await cdp.close(); } catch { /* ignore */ }
  }
})();
