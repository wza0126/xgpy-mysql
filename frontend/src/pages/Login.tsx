import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { useSiteConfig } from '../hooks/useSiteConfig';
import { useNavigate } from 'react-router-dom';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { signIn, profile } = useAuth();
  const navigate = useNavigate();
  const siteConfig = useSiteConfig();
  const siteTitle = siteConfig.site_title || '西高中学习平台';
  const siteSubtitle = siteConfig.site_subtitle || '江苏省高中信息技术';

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('reason=class_disabled')) {
      setError('平台暂未开放，请联系老师');
    }
  }, []);

  useEffect(() => {
    // 浏览器标签页标题同步站点设置
    if (siteTitle) document.title = siteTitle;
  }, [siteTitle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { error: loginError } = await signIn(username, password);
      if (loginError) {
        console.error('登录错误:', loginError);
        setError(loginError.message || '用户名或密码错误');
      }
    } catch (err) {
      console.error('登录异常:', err);
      setError('登录失败，请稍后重试');
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <i className="fa-solid fa-graduation-cap text-white text-3xl"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">{siteTitle}</h1>
          <p className="text-gray-500 mt-2">{siteSubtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <div className="relative">
              <i className="fa-solid fa-user absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                placeholder="请输入用户名"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <div className="relative">
              <i className="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                placeholder="请输入密码"
                required
              />
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className={`px-4 py-3 rounded-lg text-sm ${
                error.includes('平台暂未开放') || error.includes('未开放')
                  ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                  : 'bg-red-50 text-red-600'
              }`}
            >
              <div className="flex items-center gap-2">
                {error.includes('平台暂未开放') || error.includes('未开放') ? (
                  <i className="fa-solid fa-lock text-yellow-500"></i>
                ) : (
                  <i className="fa-solid fa-exclamation-circle text-red-500"></i>
                )}
                <span>{error}</span>
              </div>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3 rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin"></i>
                登录中...
              </>
            ) : (
              <>
                <i className="fa-solid fa-sign-in-alt"></i>
                登录
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>登陆后自动跳出说明平台未开放，请联系老师</p>
          <p>学生账号由教师后台批量导入</p>
        </div>
      </motion.div>
    </div>
  );
};
