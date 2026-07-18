const path = require('path');
const dotenv = require('dotenv');

const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = `.env.${nodeEnv}`;
const appDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const envDirs = process.pkg
  ? [appDir]
  : Array.from(new Set([appDir, path.resolve(appDir, '..')]));
const envPath = path.resolve(envDirs[0], envFile);
const loadedEnvPaths = [];

for (const envDir of envDirs) {
  const result = dotenv.config({ path: path.resolve(envDir, envFile) });
  if (!result.error) loadedEnvPaths.push(path.resolve(envDir, envFile));
}

for (const envDir of envDirs) {
  const result = dotenv.config({ path: path.resolve(envDir, '.env') });
  if (!result.error) loadedEnvPaths.push(path.resolve(envDir, '.env'));
}

module.exports = {
  nodeEnv,
  envFile,
  envPath,
  appDir,
  envDirs,
  loadedEnvPaths,
};
