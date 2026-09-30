import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotificationStore, Notification } from '../../store/notificationStore';
import { useAuth } from '../../hooks/useAuth';
import { backendClient } from '../../api/backendClient';
import { formatRelativeTime, formatDate } from '../../utils/dateUtils';
import { getAuthToken } from '../../utils/authToken';

/** 消息相关状态（后端 /api/student/digital-messages/my 返回） */
interface MessageStatus {
  dm_enabled: boolean;
  settings_enabled: boolean;
  points_per_message: number;
  max_length: number;
  max_per_day: number;
  sent_today: number;
  current_points: number;
  muted: boolean;
  mute_until: string | null;
  mute_remain_days: number;
  mute_reason: string;
}

interface InboxMessage {
  id: number;
  sender_id: string;
  sender_username: string;
  sender_real_name: string;
  content: string;
  sent_at: string;
  is_read: boolean;
}

interface BlacklistItem {
  id: string;
  target_id: string;
  target_username: string;
  target_real_name: string;
  created_at: string;
}

const DEFAULT_STATUS: MessageStatus = {
  dm_enabled: false,
  settings_enabled: true,
  points_per_message: 0,
  max_length: 100,
  max_per_day: 0,
  sent_today: 0,
  current_points: 0,
  muted: false,
  mute_until: null,
  mute_remain_days: 0,
  mute_reason: '',
};

/** 消息内容框上的合规提示（用户要求第 4 条，务必与后端风控一致） */
const USAGE_NOTICE = '本功能主要用于课堂互动学习，请合理使用消息文明沟通。你的消息受到老师监督，如有违规会受到相应惩罚。';

/**
 * 上次发送对象暂存（用户要求第 3 条：不用每次重选账号）。
 * 用 localStorage 持久化，直到学生重新选择同学或手工改写账号为止。
 * ⚠️ 按学生 id 分键，避免同一台电脑上多个学生登录时互相串号。
 */
const receiverKey = (studentId: string) => `xgpy_msg_receiver_${studentId}`;

export const NotificationCenter: React.FC = () => {
  const {
    notifications,
    unreadCount,
    isLoading,
    showNotificationCenter,
    showNotificationPopup,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    setShowNotificationCenter,
    clearPopup
  } = useNotificationStore();
  const { profile } = useAuth();
  const [dmTab, setDmTab] = useState<'notifications' | 'send' | 'inbox' | 'blacklist'>('notifications');
  const [dmReceiver, setDmReceiver] = useState('');
  const [dmContent, setDmContent] = useState('');
  const [dmSending, setDmSending] = useState(false);
  const [dmResult, setDmResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [dmInbox, setDmInbox] = useState<InboxMessage[]>([]);
  const [status, setStatus] = useState<MessageStatus>(DEFAULT_STATUS);
  const [classmates, setClassmates] = useState<{ id: string; username: string; real_name: string }[]>([]);

  // 黑名单
  const [blacklist, setBlacklist] = useState<BlacklistItem[]>([]);
  const [blInput, setBlInput] = useState('');
  const [blMsg, setBlMsg] = useState<string | null>(null);

  // 快捷短语
  const [quickReplies, setQuickReplies] = useState<{ id: string; content: string }[]>([]);

  // 消息操作弹窗（点开一条收到消息）
  const [activeMsg, setActiveMsg] = useState<InboxMessage | null>(null);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportMsg, setReportMsg] = useState<string | null>(null);

  const dmEnabled = status.dm_enabled && status.settings_enabled;

  // 恢复上次的发送对象（user 要求 3：临时保存，直到重新选择或手工输入）
  useEffect(() => {
    if (!profile?.id) return;
    const saved = localStorage.getItem(receiverKey(profile.id));
    if (saved) setDmReceiver(saved);
  }, [profile?.id]);

  useEffect(() => {
    if (profile) {
      fetchNotifications(profile.id);
      fetchUnreadCount(profile.id);
    }
  }, [profile, fetchNotifications, fetchUnreadCount]);

  // 打开通知中心时加载消息数据、同班同学、黑名单、快捷短语
  useEffect(() => {
    if (showNotificationCenter && profile) {
      loadMessages();
      loadClassmates();
      loadBlacklist();
      loadQuickReplies();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNotificationCenter, profile?.id]);

  const loadClassmates = async () => {
    try {
      const res = await backendClient.get('/api/student/classmates');
      setClassmates(res?.data || []);
    } catch {
      setClassmates([]);
    }
  };

  const loadMessages = async () => {
    try {
      const res = await backendClient.get('/api/student/digital-messages/my');
      const d = res?.data;
      setDmInbox(d?.messages || []);
      setStatus({
        dm_enabled: !!d?.dm_enabled,
        settings_enabled: d?.settings_enabled !== false,
        points_per_message: Number(d?.points_per_message) || 0,
        max_length: Number(d?.max_length) || 100,
        max_per_day: Number(d?.max_per_day) || 0,
        sent_today: Number(d?.sent_today) || 0,
        current_points: Number(d?.current_points) || 0,
        muted: !!d?.muted,
        mute_until: d?.mute_until || null,
        mute_remain_days: Number(d?.mute_remain_days) || 0,
        mute_reason: d?.mute_reason || '',
      });
    } catch {
      // 忽略加载失败
    }
  };

  const loadBlacklist = async () => {
    try {
      const res = await backendClient.get('/api/student/message-blacklist');
      setBlacklist(res?.data || []);
    } catch {
      setBlacklist([]);
    }
  };

  const loadQuickReplies = async () => {
    try {
      const res = await backendClient.get('/api/student/message-quick-replies');
      setQuickReplies(res?.data || []);
    } catch {
      setQuickReplies([]);
    }
  };

  const sendMessage = async () => {
    setDmResult(null);
    const receiver = dmReceiver.trim();
    if (!receiver) { setDmResult({ ok: false, text: '请输入对方账号' }); return; }
    const text = dmContent.trim();
    if (!text) { setDmResult({ ok: false, text: '请输入发送内容' }); return; }
    if (text.length > status.max_length) {
      setDmResult({ ok: false, text: `消息最长 ${status.max_length} 个字，当前 ${text.length} 个字` });
      return;
    }
    setDmSending(true);
    try {
      const res = await backendClient.post('/api/student/digital-messages/send', {
        receiver_username: receiver,
        content: text,
      });
      if (res?.error) { setDmResult({ ok: false, text: res.error }); return; }
      const d = res?.data;
      setDmResult({
        ok: true,
        text: d?.points_cost > 0
          ? `发送成功，已扣除 ${d.points_cost} 积分（剩余 ${d.current_points} 积分）`
          : '发送成功',
      });
      // 只清空内容，保留接收人——连续给同一个人发消息时不必重选（用户要求 3）
      setDmContent('');
      await loadMessages();
    } catch (e: any) {
      setDmResult({ ok: false, text: e?.message || '发送失败，请重试' });
    } finally {
      setDmSending(false);
    }
  };

  /** 设置发送对象并持久化（下拉选择 / 手工输入都走这里） */
  const updateReceiver = (username: string) => {
    setDmReceiver(username);
    setDmResult(null);
    if (profile?.id) {
      if (username.trim()) localStorage.setItem(receiverKey(profile.id), username);
      else localStorage.removeItem(receiverKey(profile.id));
    }
  };

  /** 收到的消息：全部标为已读 */
  const markAllInboxRead = async () => {
    try {
      const res = await backendClient.post('/api/student/digital-messages/read-all', {});
      if (res?.error) { setDmResult({ ok: false, text: res.error }); return; }
      setDmInbox(prev => prev.map(m => ({ ...m, is_read: true })));
    } catch (e: any) {
      setDmResult({ ok: false, text: e?.message || '操作失败' });
    }
  };

  /** 从消息弹窗点「回复」：切到发送页签并预填对方账号 */
  const replyTo = (m: InboxMessage) => {
    updateReceiver(m.sender_username);
    setDmContent('');
    setActiveMsg(null);
    setDmResult(null);
    setDmTab('send');
  };

  /** 打开一条收到的消息（弹窗），顺带标为已读 */
  const openMessage = async (m: InboxMessage) => {
    setActiveMsg(m);
    setShowReportForm(false);
    setReportReason('');
    setReportMsg(null);
    if (!m.is_read) {
      try {
        await backendClient.post('/api/student/digital-messages/read', { id: m.id });
        setDmInbox(prev => prev.map(x => (x.id === m.id ? { ...x, is_read: true } : x)));
      } catch { /* 忽略 */ }
    }
  };

  /** 把消息发送方加入黑名单（弹窗内的入口） */
  const blockSender = async (m: InboxMessage) => {
    setReportMsg(null);
    try {
      const res = await backendClient.post('/api/student/message-blacklist', { target_id: m.sender_id });
      if (res?.error) { setReportMsg(res.error); return; }
      setReportMsg(`已将 ${m.sender_real_name || m.sender_username} 加入黑名单，不会再收到对方消息`);
      await loadBlacklist();
      await loadMessages();
      await loadClassmates();
    } catch (e: any) {
      setReportMsg(e?.message || '操作失败');
    }
  };

  /** 提交举报 */
  const submitReport = async () => {
    if (!activeMsg) return;
    if (!reportReason.trim()) { setReportMsg('请填写举报理由'); return; }
    try {
      const res = await backendClient.post('/api/student/message-reports', {
        message_id: activeMsg.id,
        reason: reportReason.trim(),
      });
      if (res?.error) { setReportMsg(res.error); return; }
      setReportMsg('举报已提交，老师会尽快处理');
      setShowReportForm(false);
      setReportReason('');
    } catch (e: any) {
      setReportMsg(e?.message || '举报失败，请重试');
    }
  };

  /** 手工输入账号加黑名单 */
  const addToBlacklist = async () => {
    setBlMsg(null);
    const acct = blInput.trim();
    if (!acct) { setBlMsg('请输入对方账号'); return; }
    try {
      const res = await backendClient.post('/api/student/message-blacklist', { target_username: acct });
      if (res?.error) { setBlMsg(res.error); return; }
      setBlMsg(`已把 ${res?.data?.target_name || acct} 加入黑名单`);
      setBlInput('');
      await loadBlacklist();
      await loadMessages();
      await loadClassmates();
    } catch (e: any) {
      setBlMsg(e?.message || '操作失败');
    }
  };

  /** 移出黑名单 */
  const removeFromBlacklist = async (id: string) => {
    try {
      await backendClient.delete(`/api/student/message-blacklist/${id}`);
      await loadBlacklist();
      await loadClassmates();
      await loadMessages();
    } catch { /* 忽略 */ }
  };

  const handleNotificationClick = async (notification: Notification) => {
    // 数字消息弹窗点击：标记已读 + 打开通知中心并切换到"收到的消息"tab
    if ((notification as any).notification_type === 'digital_message') {
      try {
        const token = getAuthToken();
        if (token) {
          await backendClient.post('/api/student/digital-messages/read', { id: (notification as any).id });
        }
      } catch {}
      setDmTab('inbox');
      return;
    }
    if (!notification.is_read && profile) {
      await markAsRead(notification.id, profile.id);
    }
  };

  const unreadNotifications = notifications.filter(n => !n.is_read);
  const readNotifications = notifications.filter(n => n.is_read);
  const unreadInbox = dmInbox.filter(m => !m.is_read).length;

  return (
    <>
      {/* 新通知弹窗（右上角） */}
      <AnimatePresence>
        {showNotificationPopup && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            className="fixed top-4 right-4 z-[9999] w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
          >
            <div className={`px-4 py-3 flex items-center justify-between ${
              showNotificationPopup.notification_type === 'digital_message'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                : 'bg-gradient-to-r from-blue-500 to-indigo-500'
            }`}>
              <div className="flex items-center gap-2 text-white">
                <i className={`fa-solid ${
                  showNotificationPopup.notification_type === 'digital_message'
                    ? 'fa-envelope' : 'fa-bell'
                }`}></i>
                <span className="font-medium">
                  {showNotificationPopup.notification_type === 'digital_message'
                    ? '新消息' : '新通知'}
                </span>
              </div>
              <button
                onClick={clearPopup}
                className="text-white/80 hover:text-white transition-colors"
              >
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            <div
              className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => {
                handleNotificationClick(showNotificationPopup);
                clearPopup();
                setShowNotificationCenter(true);
              }}
            >
              <h4 className="font-medium text-gray-800 mb-1">
                {showNotificationPopup.title}
              </h4>
              <p className="text-sm text-gray-600 line-clamp-2">
                {showNotificationPopup.content}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                {formatRelativeTime(showNotificationPopup.created_at)}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 通知中心抽屉 */}
      <AnimatePresence>
        {showNotificationCenter && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-[9997]"
              onClick={() => setShowNotificationCenter(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed right-0 top-0 h-full w-[450px] bg-white shadow-2xl z-[9998] flex flex-col"
            >
              {/* 头部 */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-white">
                    <i className="fa-solid fa-bell text-lg"></i>
                    <h2 className="text-lg font-semibold">通知中心</h2>
                  </div>
                  <button
                    onClick={() => setShowNotificationCenter(false)}
                    className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  >
                    <i className="fa-solid fa-times text-lg"></i>
                  </button>
                </div>
                <p className="text-blue-100 text-sm">共 {notifications.length} 条通知，{unreadCount} 条未读</p>

                {/* Tab 切换 */}
                <div className="mt-3 flex gap-1 bg-blue-800/40 rounded-lg p-1">
                  <button
                    onClick={() => setDmTab('notifications')}
                    className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      dmTab === 'notifications' ? 'bg-white text-blue-700' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    <i className="fa-solid fa-bell mr-1"></i>通知
                  </button>
                  {dmEnabled && (
                    <button
                      onClick={() => setDmTab('send')}
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        dmTab === 'send' ? 'bg-white text-blue-700' : 'text-blue-100 hover:bg-white/10'
                      }`}
                    >
                      <i className="fa-solid fa-paper-plane mr-1"></i>发送消息
                    </button>
                  )}
                  <button
                    onClick={() => setDmTab('inbox')}
                    className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      dmTab === 'inbox' ? 'bg-white text-blue-700' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    <i className="fa-solid fa-envelope mr-1"></i>收到{unreadInbox > 0 ? `(${unreadInbox})` : ''}
                  </button>
                  <button
                    onClick={() => setDmTab('blacklist')}
                    className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      dmTab === 'blacklist' ? 'bg-white text-blue-700' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    <i className="fa-solid fa-user-slash mr-1"></i>黑名单
                  </button>
                </div>
              </div>

              {/* 操作栏（仅通知 tab） */}
              {dmTab === 'notifications' && (
                <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  {unreadCount > 0 && profile && (
                    <button
                      onClick={() => markAllAsRead(profile.id)}
                      className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      <i className="fa-solid fa-check-double"></i>
                      全部标为已读
                    </button>
                  )}
                </div>
              )}

              {/* 发送消息 tab */}
              {dmTab === 'send' && (
                <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-700">
                      <i className="fa-solid fa-paper-plane text-blue-500 mr-1"></i>发送消息
                    </h3>
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                      <i className="fa-solid fa-coins mr-1"></i>
                      {status.points_per_message > 0
                        ? `每条 ${status.points_per_message} 积分`
                        : '不消耗积分'}
                    </span>
                  </div>

                  {/* 合规提示（用户要求第 4 条） */}
                  <div className="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] leading-relaxed text-amber-800">
                    <i className="fa-solid fa-circle-info mr-1"></i>
                    {USAGE_NOTICE}
                  </div>

                  {/* 禁言横幅 */}
                  {status.muted && (
                    <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                      <i className="fa-solid fa-microphone-slash mr-1"></i>
                      <span className="font-semibold">你已被禁言，还需 {status.mute_remain_days} 天</span>
                      {status.mute_reason ? `（原因：${status.mute_reason}）` : ''}
                    </div>
                  )}

                  {/* 积分 / 今日条数状态条 */}
                  <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
                    <span>
                      <i className="fa-solid fa-star text-amber-500 mr-1"></i>
                      我的积分：<span className="font-semibold text-gray-700">{status.current_points}</span>
                    </span>
                    <span>
                      今日已发 <span className="font-semibold text-gray-700">{status.sent_today}</span> 条
                      {status.max_per_day > 0 ? ` / 上限 ${status.max_per_day}` : ''}
                    </span>
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">从同班同学中选择</label>
                    <select
                      value={dmReceiver ? classmates.find(c => c.username === dmReceiver)?.id || '' : ''}
                      onChange={e => {
                        const selected = classmates.find(c => c.id === e.target.value);
                        if (selected) updateReceiver(selected.username);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    >
                      <option value="">-- 选择同学 --</option>
                      {classmates.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.real_name} ({c.username})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">
                      对方账号
                      <span className="text-gray-400 ml-1">（已记住，下次打开自动填入；改了就按新的算）</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={dmReceiver}
                        onChange={e => updateReceiver(e.target.value)}
                        placeholder="对方学生账号"
                        className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                      />
                      {dmReceiver && (
                        <button
                          type="button"
                          onClick={() => updateReceiver('')}
                          title="清除"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <i className="fa-solid fa-circle-xmark text-sm"></i>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 快捷短语 */}
                  {quickReplies.length > 0 && (
                    <div className="mb-3">
                      <label className="block text-xs text-gray-500 mb-1">
                        <i className="fa-solid fa-bolt text-amber-500 mr-1"></i>快捷短语（点一下填入）
                      </label>
                      <div className="flex flex-wrap gap-1.5 max-h-[104px] overflow-y-auto">
                        {quickReplies.map(q => (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => { setDmContent(q.content); setDmResult(null); }}
                            className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[11px] text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors text-left"
                          >
                            {q.content.length > 16 ? q.content.slice(0, 16) + '…' : q.content}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs text-gray-500">发送内容</label>
                      <span className={`text-[11px] ${
                        dmContent.length > status.max_length ? 'text-red-500' : 'text-gray-400'
                      }`}>
                        {dmContent.length} / {status.max_length}
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      maxLength={status.max_length}
                      value={dmContent}
                      onChange={e => { setDmContent(e.target.value); setDmResult(null); }}
                      placeholder="输入要发送的内容，例如：这道题我的思路是……"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none bg-white"
                    />
                  </div>

                  <button
                    onClick={sendMessage}
                    disabled={dmSending || status.muted || !dmEnabled}
                    className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {dmSending ? '发送中...'
                      : status.muted ? `已禁言（还需 ${status.mute_remain_days} 天）`
                      : status.points_per_message > 0 ? `发送（扣 ${status.points_per_message} 积分）`
                      : '发送'}
                  </button>

                  {dmResult && (
                    <p className={`mt-2 text-xs ${dmResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                      {dmResult.text}
                    </p>
                  )}
                </div>
              )}

              {/* 收到的消息 tab */}
              {dmTab === 'inbox' && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* 操作栏：与「通知」页签一致的全部标为已读 */}
                  <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      共 {dmInbox.length} 条{unreadInbox > 0 ? `，${unreadInbox} 条未读` : ''}
                    </span>
                    {unreadInbox > 0 && (
                      <button
                        onClick={markAllInboxRead}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        <i className="fa-solid fa-check-double"></i>
                        全部标为已读
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {dmInbox.length === 0 ? (
                      <div className="p-8 text-center text-gray-500">
                        <i className="fa-regular fa-envelope text-4xl mb-2"></i>
                        <p>暂无收到消息</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {dmInbox.map(m => (
                          <div
                            key={m.id}
                            onClick={() => openMessage(m)}
                            className={`p-4 cursor-pointer hover:bg-blue-50/70 transition-colors ${m.is_read ? 'bg-white' : 'bg-blue-50/50'}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-gray-800">
                                <i className="fa-solid fa-user text-blue-500 mr-1"></i>
                                {m.sender_real_name || m.sender_username}
                                <span className="text-xs text-gray-400 ml-1">({m.sender_username})</span>
                              </span>
                              <span className="text-xs text-gray-400">
                                {formatDate(m.sent_at)}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{m.content}</p>
                            {!m.is_read && (
                              <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">未读</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 黑名单 tab */}
              {dmTab === 'blacklist' && (
                <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    <i className="fa-solid fa-user-slash text-gray-500 mr-1"></i>我的黑名单
                  </h3>
                  <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
                    加入黑名单后，你将不再收到对方的消息。也可以在「收到的消息」里点开某条消息，直接拉黑发送方。
                  </p>

                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={blInput}
                      onChange={e => { setBlInput(e.target.value); setBlMsg(null); }}
                      placeholder="输入对方账号"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    />
                    <button
                      onClick={addToBlacklist}
                      className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
                    >
                      加入
                    </button>
                  </div>

                  {blMsg && <p className="text-xs text-blue-600 mb-3">{blMsg}</p>}

                  {blacklist.length === 0 ? (
                    <div className="p-6 text-center text-gray-400 text-sm">
                      <i className="fa-solid fa-user-check text-3xl mb-2"></i>
                      <p>黑名单为空</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {blacklist.map(b => (
                        <div key={b.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {b.target_real_name || b.target_username}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              {b.target_username} · {formatDate(b.created_at)}
                            </p>
                          </div>
                          <button
                            onClick={() => removeFromBlacklist(b.id)}
                            className="ml-2 px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-300 whitespace-nowrap transition-colors"
                          >
                            移出
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 通知列表 */}
              {dmTab === 'notifications' && (
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="p-8 text-center text-gray-500">
                    <i className="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                    <p>加载中...</p>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <i className="fa-regular fa-inbox text-4xl mb-2"></i>
                    <p>暂无通知</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {/* 未读通知 */}
                    {unreadNotifications.length > 0 && (
                      <>
                        <div className="px-4 py-2 bg-yellow-50 text-yellow-700 text-sm font-medium border-b border-yellow-100">
                          未读通知 ({unreadNotifications.length})
                        </div>
                        {unreadNotifications.map((notification) => (
                          <NotificationItem
                            key={notification.id}
                            notification={notification}
                            formatDate={formatDate}
                            onClick={() => handleNotificationClick(notification)}
                          />
                        ))}
                      </>
                    )}

                    {/* 已读通知 */}
                    {readNotifications.length > 0 && (
                      <>
                        <div className="px-4 py-2 bg-gray-50 text-gray-600 text-sm font-medium border-b border-gray-200">
                          已读通知 ({readNotifications.length})
                        </div>
                        {readNotifications.map((notification) => (
                          <NotificationItem
                            key={notification.id}
                            notification={notification}
                            formatDate={formatDate}
                            onClick={() => {}}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 消息详情弹窗（拉黑 / 举报 入口） */}
      <AnimatePresence>
        {activeMsg && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-[10000]"
              onClick={() => setActiveMsg(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 flex items-center justify-center z-[10001] p-4 pointer-events-none"
            >
              <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md pointer-events-auto overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-800">
                    <i className="fa-solid fa-envelope-open-text text-blue-500 mr-2"></i>消息详情
                  </h3>
                  <button
                    onClick={() => setActiveMsg(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <i className="fa-solid fa-xmark text-lg"></i>
                  </button>
                </div>

                <div className="p-5">
                  <div className="flex items-center justify-between mb-3 text-sm">
                    <span className="text-gray-700">
                      <i className="fa-solid fa-user text-blue-500 mr-1"></i>
                      来自 <span className="font-medium">{activeMsg.sender_real_name || activeMsg.sender_username}</span>
                      <span className="text-xs text-gray-400 ml-1">({activeMsg.sender_username})</span>
                    </span>
                    <span className="text-xs text-gray-400">{formatDate(activeMsg.sent_at)}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 mb-4">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{activeMsg.content}</p>
                  </div>

                  {/* 举报表单 */}
                  {showReportForm ? (
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200 mb-4">
                      <label className="block text-xs font-medium text-red-700 mb-1.5">
                        <i className="fa-solid fa-flag mr-1"></i>举报理由（必填）
                      </label>
                      <textarea
                        rows={3}
                        maxLength={500}
                        value={reportReason}
                        onChange={e => { setReportReason(e.target.value); setReportMsg(null); }}
                        placeholder="请说明该消息的问题，例如：含有辱骂内容、骚扰他人……"
                        className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm focus:ring-2 focus:ring-red-400 outline-none resize-none bg-white"
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={submitReport}
                          className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                        >
                          提交举报
                        </button>
                        <button
                          onClick={() => { setShowReportForm(false); setReportReason(''); setReportMsg(null); }}
                          className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {reportMsg && (
                    <p className={`text-xs mb-3 ${reportMsg.includes('已提交') || reportMsg.includes('已将') ? 'text-emerald-600' : 'text-red-500'}`}>
                      {reportMsg}
                    </p>
                  )}

                  {/* 操作按钮：回复 / 拉黑 / 举报 */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => replyTo(activeMsg)}
                      className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <i className="fa-solid fa-reply"></i>回复
                    </button>
                    <button
                      onClick={() => blockSender(activeMsg)}
                      className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <i className="fa-solid fa-user-slash"></i>加入黑名单
                    </button>
                    <button
                      onClick={() => { setShowReportForm(true); setReportMsg(null); }}
                      className="flex-1 py-2.5 rounded-xl border border-red-300 text-sm text-red-600 hover:bg-red-50 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <i className="fa-solid fa-flag"></i>举报
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

/** 通知列表项 */
const NotificationItem: React.FC<{
  notification: Notification;
  formatDate: (d: string) => string;
  onClick: () => void;
}> = ({ notification, formatDate, onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${!notification.is_read ? 'bg-blue-50/30' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          notification.notification_type === 'digital_message'
            ? 'bg-emerald-100 text-emerald-600'
            : notification.has_point_reward
              ? 'bg-amber-100 text-amber-600'
              : 'bg-blue-100 text-blue-600'
        }`}>
          <i className={`fa-solid text-sm ${
            notification.notification_type === 'digital_message'
              ? 'fa-envelope'
              : notification.has_point_reward
                ? 'fa-gift'
                : 'fa-bell'
          }`}></i>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <h4 className={`text-sm truncate ${!notification.is_read ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
              {notification.title}
            </h4>
            {!notification.is_read && (
              <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"></span>
            )}
          </div>
          <p className="text-xs text-gray-600 line-clamp-2 mb-1">{notification.content}</p>
          <div className="flex items-center justify-between text-[11px] text-gray-400">
            <span>
              <i className="fa-solid fa-user-tie mr-1"></i>老师
            </span>
            <span>{formatDate(notification.created_at)}</span>
          </div>
          {notification.has_point_reward && notification.point_reward_amount ? (
            <span className="inline-block mt-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
              +{notification.point_reward_amount} 积分
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
