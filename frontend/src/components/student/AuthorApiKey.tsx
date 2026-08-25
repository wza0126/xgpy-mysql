import React, { useEffect, useState } from 'react';
import { backendClient } from '../../api/backendClient';

/**
 * 学生自绑 DeepSeek API Key 组件
 * 挂在「作者中心」tab 顶部。绑定后创作不扣积分、无次数限制；解绑后回到扣积分模式。
 * 所有外网调用由后端代理，学生机不直连外网。
 */
export function AuthorApiKey() {
  const [loading, setLoading] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  const [masked, setMasked] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [showValue, setShowValue] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await backendClient.get('/api/creative-workshop/me/apikey');
      if (error) throw new Error(error);
      setHasKey(!!data?.has_key);
      setMasked(data?.masked ?? null);
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '加载失败' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleBind = async () => {
    const trimmed = inputKey.trim();
    if (!trimmed) {
      setMsg({ type: 'error', text: '请输入 API Key' });
      return;
    }
    if (!trimmed.startsWith('sk-')) {
      setMsg({ type: 'error', text: 'DeepSeek API Key 以 sk- 开头' });
      return;
    }
    if (trimmed.length < 20 || trimmed.length > 128) {
      setMsg({ type: 'error', text: 'API Key 长度应为 20-128 个字符' });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const { data, error } = await backendClient.put('/api/creative-workshop/me/apikey', { key: trimmed });
      if (error) throw new Error(error);
      setHasKey(true);
      setMasked(data?.masked ?? null);
      setInputKey('');
      setShowInput(false);
      setShowValue(false);
      setMsg({ type: 'success', text: '绑定成功！创作时将使用你的 Key，不再扣积分' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '绑定失败' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnbind = async () => {
    if (!window.confirm('确定解绑吗？解绑后创作将回到扣积分模式。')) return;
    setSubmitting(true);
    setMsg(null);
    try {
      const { error } = await backendClient.delete('/api/creative-workshop/me/apikey');
      if (error) throw new Error(error);
      setHasKey(false);
      setMasked(null);
      setMsg({ type: 'info', text: '已解绑，创作回到扣积分模式' });
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '解绑失败' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const { data, error } = await backendClient.post('/api/creative-workshop/me/apikey/test', {});
      if (error) throw new Error(error);
      if (data?.ok) {
        setMsg({ type: 'success', text: 'API Key 有效！可以正常创作' });
      } else {
        setMsg({ type: 'error', text: data?.error || '测试失败' });
      }
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message || '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleCancel = () => {
    setShowInput(false);
    setInputKey('');
    setShowValue(false);
    setMsg(null);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
        <div className="text-sm text-gray-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-key text-amber-500"></i>
          <h4 className="text-sm font-medium text-gray-800">DeepSeek API Key 绑定</h4>
        </div>
        <div className="relative group">
          <span className="text-xs text-blue-500 cursor-help underline decoration-dotted">
            ⓘ 如何获取 API Key？
          </span>
          {/* 悬浮说明浮层：group-hover 显示，同时支持 focus-within 键盘可达 */}
          <div
            tabIndex={0}
            className="absolute right-0 top-6 z-30 w-72 p-3 bg-white rounded-lg shadow-xl border border-gray-200 text-xs text-gray-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-opacity"
          >
            <div className="font-semibold mb-2 text-gray-800">如何获取 DeepSeek API Key？</div>
            <ol className="list-decimal pl-4 space-y-1">
              <li>访问 DeepSeek 开放平台：<br />
                <a href="https://platform.deepseek.com/" target="_blank" rel="noopener noreferrer"
                   className="text-blue-500 hover:underline break-all">
                  https://platform.deepseek.com/
                </a>
              </li>
              <li>注册并登录（手机号/邮箱）</li>
              <li>进入「API Keys」页面</li>
              <li>点击「创建 API Key」，复制生成的 sk-xxx 字符串</li>
              <li>粘到下方输入框并保存</li>
            </ol>
            <div className="mt-2 pt-2 border-t border-gray-100 text-gray-500">
              <p>• 新用户通常有免费体验额度</p>
              <p>• 用尽后按官方定价计费（约 ¥1-2/百万 tokens）</p>
              <p>• Key 仅本账号可用，请勿泄露</p>
            </div>
          </div>
        </div>
      </div>

      {/* 状态行 */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-xs text-gray-500">当前状态：</span>
        {hasKey ? (
          <>
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">
              已绑定 {masked || ''}
            </span>
            <button
              onClick={handleTest}
              disabled={testing || submitting}
              className="px-3 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors disabled:opacity-50"
            >
              {testing ? <><i className="fa-solid fa-spinner fa-spin mr-1"></i>测试中</> : <><i className="fa-solid fa-plug-circle-check mr-1"></i>测试</>}
            </button>
            <button
              onClick={handleUnbind}
              disabled={submitting || testing}
              className="px-3 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors disabled:opacity-50"
            >
              <i className="fa-solid fa-trash-can mr-1"></i>解绑
            </button>
          </>
        ) : (
          <>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
              未绑定（走平台 Key，扣积分）
            </span>
            <button
              onClick={() => { setShowInput(true); setMsg(null); }}
              disabled={showInput}
              className="px-3 py-1 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <i className="fa-solid fa-link mr-1"></i>绑定
            </button>
          </>
        )}
      </div>

      {/* 绑定/更新输入框 */}
      {showInput && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <input
              type={showValue ? 'text' : 'password'}
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="粘帖 sk-xxx 开头的 DeepSeek API Key"
              className="w-full px-3 py-1.5 pr-9 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowValue(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title={showValue ? '隐藏' : '显示'}
            >
              <i className={`fa-solid ${showValue ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            </button>
          </div>
          <button
            onClick={handleBind}
            disabled={submitting}
            className="px-3 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting ? <><i className="fa-solid fa-spinner fa-spin mr-1"></i>保存中</> : '保存'}
          </button>
          <button
            onClick={handleCancel}
            disabled={submitting}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors disabled:opacity-50"
          >
            取消
          </button>
        </div>
      )}

      {/* 消息提示 */}
      {msg && (
        <div className={`text-xs px-3 py-2 rounded-lg ${
          msg.type === 'success' ? 'bg-green-50 text-green-700' :
          msg.type === 'error' ? 'bg-red-50 text-red-700' :
          'bg-blue-50 text-blue-700'
        }`}>
          {msg.type === 'success' && <i className="fa-solid fa-circle-check mr-1"></i>}
          {msg.type === 'error' && <i className="fa-solid fa-circle-exclamation mr-1"></i>}
          {msg.type === 'info' && <i className="fa-solid fa-circle-info mr-1"></i>}
          {msg.text}
        </div>
      )}

      {/* 说明 */}
      <div className="mt-2 text-xs text-gray-400">
        绑定后创作不扣积分、无次数限制；解绑后回到扣积分模式。
        学生机不直连外网，测试和创作均由系统后端代理调用 DeepSeek。
      </div>
    </div>
  );
}
