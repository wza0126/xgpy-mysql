#!/usr/bin/env node
/**
 * 双远端推送（2026-11-10）
 * ============================================================
 * 主仓库：origin → Gitee（czsxxsgz/xgpy-mysql，私有，凭据在 Windows 凭据管理器）
 * 备仓库：mirror → GitHub（走 ghproxy.net，国内唯一能通的路径）
 *
 * 为什么要分开推：GitHub 那边经常超时，如果和 Gitee 绑在一条命令里，
 * Gitee 明明成功了却因为备份失败而返回非 0，容易误判成「没推上去」。
 *
 * 用法：
 *   node scripts/push-all.js              推 Gitee + GitHub 备份
 *   node scripts/push-all.js --no-backup  只推 Gitee
 *   node scripts/push-all.js --force      工作区有未提交改动也照推（默认拦截）
 *
 * 退出码：0 = 主仓库推送成功（备份失败只警告）；1 = 主仓库失败或前置检查不通过
 */

'use strict';

// ⛔ git push 的「To ... a..b main -> main」是写到 **stderr** 的，
//    用 execSync 只能拿到 stdout，会误显示成空的。统一走 spawnSync 合并两路。
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BRANCH = 'main';
const PRIMARY = 'origin';      // Gitee
const BACKUP = 'mirror';       // GitHub 镜像

const argv = process.argv.slice(2);
const NO_BACKUP = argv.includes('--no-backup');
const FORCE = argv.includes('--force');

/** 跑一条命令，成功返回 stdout；失败抛出（带合并后的输出） */
function sh(cmd, timeout = 120000) {
  const r = spawnSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout, shell: true });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status !== 0) {
    const err = new Error(out || `命令失败: ${cmd}`);
    err.out = out;
    throw err;
  }
  return out;
}

/** 执行但不上抛，返回 { ok, out } —— 备份推送要用这个，失败了不该中断流程 */
function shSoft(cmd, timeout = 180000) {
  const r = spawnSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout, shell: true });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { ok: r.status === 0, out: out || (r.error ? r.error.message : '') };
}

function head() {
  return sh('git rev-parse HEAD');
}

/** 远端分支 SHA；取不到返回空串 */
function remoteSha(remote) {
  const r = shSoft(`git ls-remote ${remote} refs/heads/${BRANCH}`, 90000);
  if (!r.ok) return '';
  return (r.out.split(/\s+/)[0] || '').trim();
}

function fail(msg, detail) {
  console.log(`\n✗ ${msg}`);
  if (detail) console.log(detail.split('\n').slice(0, 12).map((l) => '  ' + l).join('\n'));
  process.exit(1);
}

// ---------------------------------------------------------------- 前置检查
console.log('=== 推送检查 ===');

const curBranch = sh('git rev-parse --abbrev-ref HEAD');
if (curBranch !== BRANCH) {
  fail(`当前在 ${curBranch} 分支，脚本只推 ${BRANCH}。先 git checkout ${BRANCH}`);
}

// 有未提交的改动就拦住：发版时漏 commit 会导致「代码改了但仓库没有」
const dirty = sh('git status --porcelain').split('\n').filter(Boolean);
if (dirty.length > 0 && !FORCE) {
  fail(
    `工作区有 ${dirty.length} 个文件未提交，先 commit 再推（或加 --force 强制推送已提交的部分）`,
    dirty.slice(0, 10).join('\n')
  );
}
if (dirty.length > 0 && FORCE) {
  console.log(`! 工作区有 ${dirty.length} 个未提交文件，按 --force 继续只推已提交的内容`);
}

const localHead = head();
const shortHead = localHead.slice(0, 7);
console.log(`本地 ${BRANCH}: ${shortHead}  最新提交: ${sh('git log -1 --pretty=%s').slice(0, 60)}`);

// ---------------------------------------------------------------- 主仓库
console.log('\n=== 1/2 推送 Gitee（主仓库）===');
const beforeGitee = remoteSha(PRIMARY);
if (beforeGitee === localHead) {
  console.log('· 远端已是最新，跳过');
} else {
  const r = shSoft(`git push ${PRIMARY} ${BRANCH}`, 180000);
  if (!r.ok) {
    fail(
      'Gitee 推送失败。常见原因：\n' +
      '  1) 凭据过期 —— 控制面板 → 凭据管理器 → Windows 凭据 → 删除 git:https://gitee.com，再跑一次会重新询问\n' +
      '  2) 远端有新提交 —— 先 git pull origin main 再推\n' +
      '  3) 网络不通 —— 浏览器打开 gitee.com 确认',
      r.out
    );
  }
  console.log('· ' + (r.out.split('\n').pop() || 'push ok'));
}

// ---------------------------------------------------------------- 备份仓库
let backupState = '跳过';
if (!NO_BACKUP) {
  console.log('\n=== 2/2 推送 GitHub 备份（镜像）===');
  const beforeMirror = remoteSha(BACKUP);
  if (!beforeMirror) {
    console.log('! 读不到 GitHub 远端（多半是 ghproxy 超时），跳过备份');
    backupState = '读不到远端';
  } else if (beforeMirror === localHead) {
    console.log('· 备份已是最新，跳过');
    backupState = '已最新';
  } else {
    const r = shSoft(`git push ${BACKUP} ${BRANCH}`, 240000);
    if (r.ok) {
      console.log('· ' + (r.out.split('\n').pop() || 'push ok'));
      backupState = '已推送';
    } else {
      console.log('! 备份推送失败（不影响主仓库，可稍后重跑）');
      console.log('  ' + r.out.split('\n').slice(-3).join('\n  '));
      backupState = '失败（不影响发版）';
    }
  }
}

// ---------------------------------------------------------------- 校验
console.log('\n=== 结果校验 ===');
const giteeSha = remoteSha(PRIMARY);
const mirrorSha = NO_BACKUP ? '' : remoteSha(BACKUP);

const line = (name, sha) => {
  if (!sha) return `  ${name.padEnd(18)} 读不到`;
  const mark = sha === localHead ? '✓ 一致' : '✗ 不一致';
  return `  ${name.padEnd(18)} ${sha.slice(0, 7)}  ${mark}`;
};

console.log(`  本地 ${BRANCH}           ${shortHead}`);
console.log(line('Gitee（主）', giteeSha));
if (!NO_BACKUP) console.log(line('GitHub（备份）', mirrorSha));

if (giteeSha !== localHead) {
  fail('Gitee 上的提交和本地不一致，主仓库没推成功，请检查上面的输出');
}

console.log(`\n✓ 主仓库已同步（备份：${backupState}）`);
process.exit(0);
