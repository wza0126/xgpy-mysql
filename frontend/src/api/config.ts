function getApiUrl(): string {
  const env = (import.meta as any).env;

  // 1. 首先检查是否有环境变量配置
  if (env) {
    const envUrl = env.VITE_API_URL;
    if (envUrl) return envUrl;
  }
  
  // 2. 生产环境默认同源，便于后端或 exe 同端口托管前端
  return '';
}

export const API_CONFIG = {
  apiUrl: getApiUrl()
};
