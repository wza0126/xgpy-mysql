// @ts-nocheck
import { API_CONFIG } from './config';

const API_BASE = API_CONFIG.apiUrl;

function getAuthToken() {
  // 只有在 iframe 中且 proxy_mode 为 true 时才使用 proxy_token
  // 不能只检查 isProxyMode()，因为同源 iframe 的 sessionStorage 是共享的，
  // 主页面会看到 iframe 设置的 proxy_mode=true，从而误用 proxy_token
  if (isInIframe() && isProxyMode()) {
    const proxyToken = sessionStorage.getItem('proxy_token');
    if (proxyToken) return proxyToken;
  }
  return localStorage.getItem('xgpy_token');
}

function isProxyMode() {
  return sessionStorage.getItem('proxy_mode') === 'true';
}

function isInIframe() {
  try {
    return window !== window.top;
  } catch {
    return true;
  }
}

async function fetchApi(endpoint, options = {}) {
  const token = getAuthToken();
  
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    ...options.headers
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const url = `${API_BASE}${endpoint}`;
  console.log(`Fetching: ${url}`, { method: options.method || 'GET', token: token ? 'present' : 'missing' });
  
  const response = await fetch(url, {
    ...options,
    headers
  });
  
  if (response.status === 401) {
    const inIframe = isInIframe();
    const proxyMode = isProxyMode();
    const tokenSource = proxyMode ? 'proxy' : (localStorage.getItem('xgpy_token') ? 'localStorage' : 'none');
    const debugInfo = {
      time: new Date().toISOString(),
      endpoint,
      tokenSource,
      tokenPreview: token ? token.slice(0, 20) + '...' : 'null',
      isProxyMode: proxyMode,
      isInIframe: inIframe,
    };
    console.error('[DEBUG 401]', debugInfo);

    if (inIframe) {
      // iframe 中永远不清除主页面的 localStorage
      if (proxyMode) {
        sessionStorage.removeItem('proxy_token');
        sessionStorage.removeItem('proxy_mode');
      }
    } else {
      // 主页面：清除 localStorage 并刷新
      localStorage.removeItem('xgpy_token');
      localStorage.removeItem('xgpy_user');
      window.location.hash = '#/';
      window.location.reload();
    }
    throw new Error('Session expired - please login again');
  }
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Network error' }));
    const err = new Error(error.error || 'Request failed') as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  
  return response.json();
}

class MariaDBClient {
  constructor() {
    this.baseUrl = API_BASE;
  }

  async healthCheck() {
    return fetchApi('/api/health');
  }

  async get(endpoint, params = {}) {
    const queryString = Object.keys(params).map(key => 
      `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`
    ).join('&');
    const url = queryString ? `${endpoint}?${queryString}` : endpoint;
    return fetchApi(url);
  }

  async post(endpoint, data = {}) {
    return fetchApi(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async put(endpoint, data = {}) {
    return fetchApi(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async delete(endpoint) {
    return fetchApi(endpoint, {
      method: 'DELETE'
    });
  }

  from(tableName) {
    return new QueryBuilder(tableName, this);
  }

  async login(username, password) {
    try {
      const deviceInfo = navigator.userAgent;
      const result = await fetchApi('/api/auth/secure-login', {
        method: 'POST',
        body: JSON.stringify({ username, password, deviceInfo })
      });
      
      if (result.data?.session?.access_token) {
        localStorage.setItem('xgpy_token', result.data.session.access_token);
        localStorage.setItem('xgpy_user', JSON.stringify(result.data.user));
      }
      
      return result;
    } catch (error) {
      console.error('Login error:', error);
      return { data: null, error: error.message || '登录失败' };
    }
  }

  async logout() {
    localStorage.removeItem('xgpy_token');
    localStorage.removeItem('xgpy_user');
    return { data: { success: true }, error: null };
  }

  async getSession() {
    const token = getAuthToken();
    if (!token) {
      return { data: { session: null }, error: null };
    }

    // 总是从后端验证 token，避免 localStorage 缓存了过期/被清理的 token
    // 否则页面加载时显示已登录，点击模块发请求时才暴露 401，体验很差
    return fetchApi('/api/auth/session');
  }

  async importData(jsonData) {
    return fetchApi('/api/import', {
      method: 'POST',
      body: JSON.stringify(jsonData)
    });
  }

  // 业务API - 兑换奖品
  async businessExchangePrize(data) {
    return fetchApi('/api/business/exchange-prize', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // 业务API - 提交答案
  async businessSubmitAnswer(data) {
    return fetchApi('/api/business/submit-answer', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // 业务API - 宠物喂食
  async businessFeedPet(data) {
    return fetchApi('/api/business/feed-pet', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // 业务API - 提交测试
  async businessSubmitTest(data) {
    return fetchApi('/api/business/submit-test', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // 业务API - 提交考试
  async businessSubmitExam(data) {
    return fetchApi('/api/business/submit-exam', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // 业务API - 保存考试进度（断点续考）
  async saveExamProgress(data) {
    return fetchApi('/api/business/exam-progress', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // 业务API - 获取考试进度（断点续考）
  async getExamProgress(examRecordId) {
    return fetchApi(`/api/business/exam-progress/${examRecordId}`);
  }

  // 业务API - 删除考试进度（考试完成后）
  async deleteExamProgress(examRecordId) {
    return fetchApi(`/api/business/exam-progress/${examRecordId}`, {
      method: 'DELETE'
    });
  }

  // 业务API - 结束考试（教师端）
  async closeExam(data) {
    return fetchApi('/api/business/close-exam', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // 业务API - 检查考试是否已结束（学生端）
  async isExamClosed(testId) {
    return fetchApi(`/api/business/exam-is-closed/${testId}`);
  }

  async rpc(functionName, params = {}) {
    // 简单的 rpc 支持 - 对于特定函数我们提供模拟实现
    if (functionName === 'cleanup_old_used_codes') {
      // 对于清理认证码函数，我们直接在客户端执行清理
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
        
        // 获取所有已使用的认证码
        const { data: allCodes } = await this.from('internet_codes').select('id, used_by, used_at');
        
        if (!allCodes) {
          return { data: { count: 0 }, error: null };
        }
        
        // 过滤出7天前已使用的认证码
        const codesToDelete = allCodes.filter(code => {
          // 已使用: used_by 不为空且不为 null
          const isUsed = code.used_by !== null && code.used_by !== '' && code.used_by !== undefined;
          // 7天前
          const isOld = code.used_at && code.used_at < sevenDaysAgo;
          return isUsed && isOld;
        });
        
        console.log('清理认证码：', {
          '总数': allCodes.length,
          '7天前已使用': codesToDelete.length,
          '阈值': sevenDaysAgo
        });
        
        // 删除这些记录
        for (const code of codesToDelete) {
          await this.from('internet_codes').delete().eq('id', code.id);
        }
        
        return { data: { count: codesToDelete.length }, error: null };
      } catch (error) {
        console.error('清理认证码失败:', error);
        return { data: null, error };
      }
    }
    
    return { data: null, error: new Error(`RPC function ${functionName} not implemented`) };
  }
}

class QueryBuilder {
  constructor(tableName, client) {
    this.tableName = tableName;
    this.client = client;
    this.filters = {};
    this.selectColumns = [];
    this.orderColumn = null;
    this.orderAscending = true;
    this.limitCount = null;
    this.rangeFrom = null;
    this.rangeTo = null;
    // 操作模式标志
    this._updateData = null;
    this._deleteMode = false;
    this._insertData = null;
  }

  select(columns = '*') {
    if (columns !== '*') {
      this.selectColumns = columns.split(',').map(c => c.trim());
    }
    return this;
  }

  eq(column, value) {
    this.filters[column] = value;
    return this;
  }

  neq(column, value) {
    this.filters[`${column}_neq`] = value;
    return this;
  }

  gt(column, value) {
    this.filters[`${column}_gt`] = value;
    return this;
  }

  lt(column, value) {
    this.filters[`${column}_lt`] = value;
    return this;
  }

  gte(column, value) {
    this.filters[`${column}_gte`] = value;
    return this;
  }

  lte(column, value) {
    this.filters[`${column}_lte`] = value;
    return this;
  }

  in(column, values) {
    this.filters[`${column}_in`] = values;
    return this;
  }

  is(column, value) {
    this.filters[column] = value;
    return this;
  }

  not(column, operator, value) {
    // 简化的 not 方法支持
    if (operator === 'is' && value === null) {
      this.filters[`${column}_is_null`] = false;
    }
    return this;
  }

  order(column, options = {}) {
    this.orderColumn = column;
    this.orderAscending = options.ascending !== false;
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  range(from, to) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  async execute() {
    const params = {
      table: this.tableName,
      filters: Object.keys(this.filters).length > 0 ? this.filters : undefined
    };

    if (this.orderColumn) {
      params.order = { column: this.orderColumn, ascending: this.orderAscending };
    }

    if (this.limitCount) {
      params.limit = this.limitCount;
    }

    if (this.rangeFrom !== null && this.rangeTo !== null) {
      params.offset = this.rangeFrom;
      params.limit = this.rangeTo - this.rangeFrom + 1;
    }

    return this.doExecute(params);
  }

  async doExecute(params) {
    const response = await fetchApi('/api/query', {
      method: 'POST',
      body: JSON.stringify(params)
    });

    if (response.error) {
      return { data: [], error: new Error(response.error) };
    }

    let data = response.data || [];

    Object.entries(this.filters).forEach(([key, value]) => {
      if (key.endsWith('_neq')) {
        const column = key.replace('_neq', '');
        data = data.filter(row => row[column] !== value);
      } else if (key.endsWith('_gt')) {
        const column = key.replace('_gt', '');
        data = data.filter(row => row[column] > value);
      } else if (key.endsWith('_lt')) {
        const column = key.replace('_lt', '');
        data = data.filter(row => row[column] < value);
      } else if (key.endsWith('_gte')) {
        const column = key.replace('_gte', '');
        data = data.filter(row => row[column] >= value);
      } else if (key.endsWith('_lte')) {
        const column = key.replace('_lte', '');
        data = data.filter(row => row[column] <= value);
      } else if (key.endsWith('_in')) {
        const column = key.replace('_in', '');
        data = data.filter(row => value.includes(row[column]));
      } else if (key.endsWith('_is_null')) {
        const column = key.replace('_is_null', '');
        data = value 
          ? data.filter(row => row[column] === null || row[column] === undefined)
          : data.filter(row => row[column] !== null && row[column] !== undefined);
      }
    });

    if (this.orderColumn) {
      data.sort((a, b) => {
        const aVal = a[this.orderColumn];
        const bVal = b[this.orderColumn];
        if (aVal < bVal) return this.orderAscending ? -1 : 1;
        if (aVal > bVal) return this.orderAscending ? 1 : -1;
        return 0;
      });
    }

    return { data, error: null };
  }

  async single() {
    const result = await this.limit(1).execute();
    if (result.error || result.data.length === 0) {
      return { data: null, error: result.error };
    }
    return { data: result.data[0], error: null };
  }

  async maybeSingle() {
    const result = await this.limit(1).execute();
    return { data: result.data[0] || null, error: result.error };
  }

  // 注意：这些方法必须先设置过滤条件，然后在 then/await 时才真正执行
  update(data) {
    this._updateData = data;
    return this;
  }

  delete() {
    this._deleteMode = true;
    return this;
  }

  insert(data) {
    // insert 是立即执行的，不支持链式过滤
    // 为了保持一致，让我们也返回 this，但实际执行还是立即
    this._insertData = data;
    return this;
  }

  then(onFulfilled, onRejected) {
    // 实现 Promise-like then 方法以支持 await
    return new Promise((resolve, reject) => {
      this._executeInternal().then(resolve).catch(reject);
    }).then(onFulfilled, onRejected);
  }
  
  async _executeInternal() {
    // 根据不同模式执行不同操作
    if (this._updateData) {
      return this._doUpdate(this._updateData);
    }
    
    if (this._deleteMode) {
      return this._doDelete();
    }
    
    if (this._insertData) {
      return this._doInsert(this._insertData);
    }
    
    // 默认执行查询
    return this.execute();
  }

  async _doUpdate(data) {
    console.log('=== QueryBuilder._doUpdate ===');
    console.log('Update data:', data);
    console.log('Current filters:', this.filters);
    console.log('Table:', this.tableName);

    const params = {
      table: this.tableName,
      filters: this.filters,
      limit: 1000
    };

    console.log('Query params:', params);
    const queryResult = await this.doExecute(params);
    console.log('Query result:', queryResult);

    if (!queryResult.data || queryResult.data.length === 0) {
      console.log('No rows to update');
      return { data: [], error: null };
    }

    console.log(`Updating ${queryResult.data.length} rows...`);
    const updated = [];
    for (const row of queryResult.data) {
      console.log(`Updating row ${row.id} with:`, data);
      // 转换日期格式
      const processedData = this.convertDateFields(data);
      const updateResponse = await fetchApi(`/api/tables/${this.tableName}/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify(processedData)
      });
      console.log('Update response:', updateResponse);
      if (updateResponse.data) {
        updated.push(...updateResponse.data);
      }
    }

    console.log('Update complete, updated rows:', updated);
    return { data: updated, error: null };
  }

  async _doDelete() {
    const response = await fetchApi(`/api/query`, {
      method: 'POST',
      body: JSON.stringify({
        table: this.tableName,
        filters: this.filters,
        limit: 1000
      })
    });

    if (!response.data || response.data.length === 0) {
      return { data: [], error: null };
    }

    const deleted = [];
    for (const row of response.data) {
      try {
        await fetchApi(`/api/tables/${this.tableName}/${row.id}`, {
          method: 'DELETE'
        });
        deleted.push(row);
      } catch (error) {
        console.warn(`Skipping deletion of ${row.id}:`, error.message);
        // 忽略 Not found 错误，继续删除其他行
      }
    }

    return { data: deleted, error: null };
  }

  async _doInsert(data) {
    console.log('=== QueryBuilder._doInsert ===');
    console.log('Table:', this.tableName);
    console.log('Insert data:', data);
    
    const records = Array.isArray(data) ? data : [data];
    const results = [];

    for (const record of records) {
      console.log('Inserting record:', record);
      
      // 确保 answer 字段不为空
      if (this.tableName === 'student_answers' && !record.answer) {
        console.warn('Skipping insert: answer field is empty');
        continue;
      }
      
      // 清理不需要的字段（移除自动生成的字段）
      const cleanedRecord = this.cleanFieldsForInsert(record);
      
      // 转换 ISO 8601 日期格式为 MySQL 兼容格式
      const processedRecord = this.convertDateFields(cleanedRecord);
      
      const response = await fetchApi(`/api/tables/${this.tableName}`, {
        method: 'POST',
        body: JSON.stringify(processedRecord)
      });
      console.log('Insert response:', response);
      results.push(...(response.data || []));
    }

    return { data: results, error: null };
  }
  
  cleanFieldsForInsert(record) {
    const cleaned = { ...record };
    // 移除从数据库读取时自动生成的字段，但保留 id 字段用于 upsert
    const fieldsToRemove = ['updated_at', 'created_at'];
    fieldsToRemove.forEach(field => delete cleaned[field]);
    return cleaned;
  }
  
  convertDateFields(record) {
    const dateFields = ['used_at', 'created_at', 'updated_at', 'exchanged_at', 'adopted_at', 'birth_date', 'start_date', 'end_date', 'due_date', 'last_wrong_at', 'first_wrong_at'];
    const newRecord = { ...record };
    
    for (const field of dateFields) {
      if (newRecord[field] !== undefined && newRecord[field] !== null) {
        let dateValue = newRecord[field];
        
        // 如果是字符串，尝试转换
        if (typeof dateValue === 'string') {
          // 检测 ISO 8601 格式 (包含 T)
          if (dateValue.includes('T')) {
            // 解析 ISO 8601 格式，默认视为 UTC 时间
            const date = new Date(dateValue);
            if (!isNaN(date.getTime())) {
              // 转换为本地时间格式 YYYY-MM-DD HH:MM:SS
              // 从 UTC 转换到本地时区（中国时区 UTC+8）
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const hours = String(date.getHours()).padStart(2, '0');
              const minutes = String(date.getMinutes()).padStart(2, '0');
              const seconds = String(date.getSeconds()).padStart(2, '0');
              newRecord[field] = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            }
          } else if (dateValue.includes('-')) {
            // 已经是 YYYY-MM-DD HH:MM:SS 格式，保持不变
            // 检查是否需要时区转换
            const date = new Date(dateValue.replace(' ', 'T'));
            if (!isNaN(date.getTime())) {
              // 如果原始字符串没有时区信息，假设是本地时间
              // 转换为本地时间显示
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const hours = String(date.getHours()).padStart(2, '0');
              const minutes = String(date.getMinutes()).padStart(2, '0');
              const seconds = String(date.getSeconds()).padStart(2, '0');
              newRecord[field] = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            }
          }
        } else if (dateValue instanceof Date) {
          // 如果是 Date 对象，转换为本地时间字符串
          const year = dateValue.getFullYear();
          const month = String(dateValue.getMonth() + 1).padStart(2, '0');
          const day = String(dateValue.getDate()).padStart(2, '0');
          const hours = String(dateValue.getHours()).padStart(2, '0');
          const minutes = String(dateValue.getMinutes()).padStart(2, '0');
          const seconds = String(dateValue.getSeconds()).padStart(2, '0');
          newRecord[field] = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        }
      }
    }
    
    return newRecord;
  }

  async count() {
    const result = await this.execute();
    return { count: result.data.length, error: result.error };
  }
}

export type BackendResult<T = any> = {
  data: T;
  error: any;
  count?: number;
};

export interface BackendQuery {
  select(columns?: string): BackendQuery;
  eq(column: string, value: any): BackendQuery;
  neq(column: string, value: any): BackendQuery;
  gt(column: string, value: any): BackendQuery;
  lt(column: string, value: any): BackendQuery;
  gte(column: string, value: any): BackendQuery;
  lte(column: string, value: any): BackendQuery;
  in(column: string, values: any[]): BackendQuery;
  is(column: string, value: any): BackendQuery;
  not(column: string, operator: string, value: any): BackendQuery;
  order(column: string, options?: { ascending?: boolean }): BackendQuery;
  limit(count: number): BackendQuery;
  range(from: number, to: number): BackendQuery;
  update(data: any): BackendQuery;
  delete(): BackendQuery;
  insert(data: any): BackendQuery;
  single(): Promise<BackendResult<any | null>>;
  maybeSingle(): Promise<BackendResult<any | null>>;
  count(): Promise<{ count: number; error: any }>;
  then<TResult1 = BackendResult<any[]>, TResult2 = never>(
    onfulfilled?: ((value: BackendResult<any[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2>;
}

export interface BackendClient {
  healthCheck(): Promise<any>;
  get(endpoint: string, params?: any): Promise<any>;
  post(endpoint: string, data?: any): Promise<any>;
  put(endpoint: string, data?: any): Promise<any>;
  delete(endpoint: string): Promise<any>;
  from(tableName: string): BackendQuery;
  login(username: string, password: string): Promise<any>;
  logout(): Promise<any>;
  getSession(): Promise<any>;
  importData(jsonData: any): Promise<any>;
  rpc(functionName: string, params?: any): Promise<BackendResult<any>>;
}

export const backendClient: BackendClient = new MariaDBClient() as any;
export const apiBaseUrl = API_BASE;
export const defaultApiKey = 'xgpy-local-key';

export function getApiBaseUrl() {
  return API_BASE;
}
