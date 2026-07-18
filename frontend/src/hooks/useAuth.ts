import { useEffect, useState } from 'react';
import { backendClient } from '../api/backendClient';
import { API_CONFIG } from '../api/config';
import { Profile } from '../types';

interface Session {
  user: User | null;
  access_token: string;
  expires_at?: number;
}

interface User {
  id: string;
  email?: string;
  created_at: string;
  role?: string;
}

function getProxyTokenFromHash(): string | null {
  const hash = window.location.hash;
  const queryStr = hash.split('?')[1] || '';
  const params = new URLSearchParams(queryStr);
  return params.get('proxy_token');
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProxyMode, setIsProxyMode] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [proxySessionId, setProxySessionId] = useState<string | null>(null);
  const [authListeners] = useState<Set<(event: string, session: Session | null) => void>>(() => new Set());

  useEffect(() => {
    const proxyToken = getProxyTokenFromHash();
    if (proxyToken) {
      verifyProxyToken(proxyToken);
    } else {
      loadSession();
    }
  }, []);

  const verifyProxyToken = async (token: string) => {
    try {
      console.warn('[verifyProxyToken] 开始验证代理 token', {
        tokenPreview: token.slice(0, 20) + '...',
        urlHash: window.location.hash,
        inIframe: (() => { try { return window !== window.top; } catch { return true; } })(),
      });

      sessionStorage.setItem('proxy_token', token);
      sessionStorage.setItem('proxy_mode', 'true');
      const { data } = await backendClient.getSession();
      if (data?.session) {
        setSession(data.session);
        setUser(data.session.user);
        await fetchProfile(data.session.user.id);
        setIsProxyMode(true);
      } else {
        // proxy_token 无效
        sessionStorage.removeItem('proxy_token');
        sessionStorage.removeItem('proxy_mode');
        setProxyError('凭证无效或已过期');
      }
    } catch (error) {
      console.error('Failed to verify proxy token:', error);
      sessionStorage.removeItem('proxy_token');
      sessionStorage.removeItem('proxy_mode');
      setProxyError('验证失败：' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadSession = async () => {
    try {
      const { data } = await backendClient.getSession();
      if (data?.session) {
        setSession(data.session);
        setUser(data.session.user);
        await fetchProfile(data.session.user.id);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async (userId: string) => {
    const { data, error } = await backendClient
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!error && data) {
      setProfile(data as Profile);
    }
  };

  const checkClassLoginPermission = async (userId: string): Promise<boolean> => {
    console.log('检查用户登录权限:', userId);

    const profileResult = await backendClient
      .from('profiles')
      .select('role, class_id, can_use_app')
      .eq('id', userId)
      .maybeSingle();
    const profileData = profileResult.data;

    console.log('用户资料:', profileData);
    console.log('can_use_app值:', profileData?.can_use_app);
    console.log('注：can_use_app 只控制能否打开应用中心，不影响登录权限');

    if (profileData?.role !== 'student' || !profileData.class_id) {
      return true;
    }

    const classResult = await backendClient
      .from('classes')
      .select('allow_login')
      .eq('id', profileData.class_id)
      .maybeSingle();
    const classData = classResult.data;

    console.log('班级数据:', classData);
    console.log('allow_login值:', classData?.allow_login);

    return !(classData?.allow_login === 0 || classData?.allow_login === false);
  };

  const checkAndEnforceLoginRestriction = async () => {
    if (isProxyMode) return;
    if (!user) return;

    const canLogin = await checkClassLoginPermission(user.id);
    if (!canLogin) {
      await signOut();
      window.location.href = '/#/login?reason=class_disabled';
    }
  };

  const signUp = async () => {
    return {
      data: null,
      error: { message: '学生账号由教师后台创建' } as Error,
    };
  };

  const signIn = async (username: string, password: string) => {
    try {
      setLoading(true);
      const email = `${username}@meoo.local`;
      console.log('尝试登录:', email);

      const result = await backendClient.login(email, password);

      if (result.error || !result.data) {
        console.error('登录失败:', result.error || '无返回数据');
        return { data: null, error: result.error || new Error('登录失败') };
      }

      if (!result.data.user || !result.data.session) {
        console.error('登录返回数据异常:', result.data);
        return { data: null, error: new Error('登录返回数据异常') };
      }

      const userId = result.data.user.id;
      console.log('登录成功, 用户ID:', userId);

      const canLogin = await checkClassLoginPermission(userId);
      if (!canLogin) {
        await signOut();
        return {
          data: null,
          error: { message: '平台暂未开放，请联系老师' } as Error,
        };
      }

      console.log('useAuth.ts: 登录成功，准备获取 profile');
      setSession(result.data.session);
      setUser(result.data.user);
      await fetchProfile(result.data.user.id);

      authListeners.forEach((listener) => listener('SIGNED_IN', result.data.session));

      const role = result.data.user.role;
      const targetPath = role === 'teacher' ? '/teacher' : '/desktop';
      console.log('useAuth.ts: 强制跳转到', targetPath);

      window.location.hash = `#${targetPath}`;
      setTimeout(() => {
        window.location.reload();
      }, 50);

      return { data: result.data, error: null };
    } catch (err) {
      console.error('登录异常:', err);
      return { data: null, error: err as Error };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    // iframe 中不清除主页面共享的 localStorage（代理模式查看学生桌面场景）
    const inIframe = (() => {
      try { return window !== window.top; } catch { return true; }
    })();

    if (!inIframe) {
      localStorage.removeItem('xgpy_token');
      localStorage.removeItem('xgpy_user');
    }

    setProfile(null);
    setUser(null);
    setSession(null);

    authListeners.forEach((listener) => listener('SIGNED_OUT', null));

    sessionStorage.setItem('last_logout_time', Date.now().toString());

    // iframe 中不执行主页面跳转
    if (!inIframe) {
      window.location.hash = '#/';
      setTimeout(() => {
        window.location.reload();
      }, 100);
    }
  };

  const updatePassword = async (newPassword: string) => {
    try {
      const token = localStorage.getItem('xgpy_token');
      const response = await fetch(`${API_CONFIG.apiUrl}/api/auth/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      const result = await response.json();
      if (!response.ok) {
        return { data: null, error: { message: result.error || 'Password update failed' } };
      }
      return { data: result.data, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err.message || 'Network error' } };
    }
  };

  const getUserSessions = async () => {
    try {
      const token = localStorage.getItem('xgpy_token');
      if (!token) return [];

      const response = await fetch(`${API_CONFIG.apiUrl}/api/auth/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Failed to get sessions:', error);
      return [];
    }
  };

  const getLoginHistory = async (limit = 20) => {
    try {
      const token = localStorage.getItem('xgpy_token');
      if (!token) return [];

      const response = await fetch(`${API_CONFIG.apiUrl}/api/auth/login-history?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Failed to get login history:', error);
      return [];
    }
  };

  const getSecurityStats = async () => {
    try {
      const token = localStorage.getItem('xgpy_token');
      if (!token) return null;

      const response = await fetch(`${API_CONFIG.apiUrl}/api/auth/security-stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      return data.data || null;
    } catch (error) {
      console.error('Failed to get security stats:', error);
      return null;
    }
  };

  const forceLogoutSession = async (sessionId: string) => {
    try {
      const token = localStorage.getItem('xgpy_token');
      if (!token) return { success: false, error: 'No token' };

      const response = await fetch(`${API_CONFIG.apiUrl}/api/auth/logout-session/${sessionId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const result = await response.json();
      return result.data || { success: false, error: result.error || 'Failed' };
    } catch (error) {
      console.error('Failed to force logout:', error);
      return { success: false, error: 'Failed' };
    }
  };

  const logoutOtherDevices = async () => {
    try {
      const token = localStorage.getItem('xgpy_token');
      if (!token) return { success: false, error: 'No token' };

      const response = await fetch(`${API_CONFIG.apiUrl}/api/auth/logout-others`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const result = await response.json();
      return result.data || { success: false, error: result.error || 'Failed' };
    } catch (error) {
      console.error('Failed to logout other devices:', error);
      return { success: false, error: 'Failed' };
    }
  };

  const isTeacher = profile?.role === 'teacher';
  const isStudent = profile?.role === 'student';

  return {
    session,
    user,
    profile,
    loading,
    isTeacher,
    isStudent,
    isProxyMode,
    proxyError,
    proxySessionId,
    signUp,
    signIn,
    signOut,
    updatePassword,
    refreshProfile: () => user && fetchProfile(user.id),
    checkAndEnforceLoginRestriction,
    getUserSessions,
    getLoginHistory,
    getSecurityStats,
    forceLogoutSession,
    logoutOtherDevices,
  };
}
