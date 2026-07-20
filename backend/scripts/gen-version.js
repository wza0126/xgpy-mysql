// 生成 src/version.js：版本号唯一来源是 package.json，提交哈希与构建时间自动注入
// 本地开发（predev/prestart）和云端 exe 构建（prebuild:exe）都会自动执行，无需手工维护
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, '..');
const pkg = require(path.join(backendDir, 'package.json'));

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: backendDir, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  // 无 git 环境（如生产服务器直接运行 server.cjs）时忽略
}

const buildTime = new Date().toISOString();

const content = `// 本文件由 scripts/gen-version.js 自动生成，请勿手工修改
module.exports = {
  version: ${JSON.stringify(pkg.version)},
  commit: ${JSON.stringify(commit)},
  buildTime: ${JSON.stringify(buildTime)},
};
`;

fs.writeFileSync(path.join(backendDir, 'src', 'version.js'), content);
console.log(`Version info: v${pkg.version} (${commit})`);
