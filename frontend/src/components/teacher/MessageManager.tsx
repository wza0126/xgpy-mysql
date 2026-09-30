import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { formatDateTime } from '../../utils/dateUtils';

/**
 * 教师端「消息设置」（v2.7.0）
 *
 * 对应学生消息体系的管理侧，共 7 块：
 *   ① 全局设置（开关 / 每条消耗积分 / 字数上限 / 每日上限）
 *   ② 全部学生消息（可搜索，可删除单条）
 *   ③ 禁言管理（设置天数 / 解除）
 *   ④ 举报处理（查看举报人、被举报人、理由；一键禁言 + 删除消息）
 *   ⑤ 屏蔽关键词（增删改启停）
 *   ⑥ 快捷短语（学生发送面板的文字模板）
 *   ⑦ 概览统计
 *
 * ⚠️ 班级级开关（某班学生能否用消息）仍在「班级管理」里的 dm_enabled，不在这里做。
 */

type TabId = 'settings' | 'messages' | 'mutes' | 'reports' | 'keywords' | 'quick';

interface Settings {
  enabled: boolean;
  pointsPerMessage: number;
  maxLength: number;
  maxPerDay: number;
}

interface Overview {
  today_messages: number;
  today_senders: number;
  pending_reports: number;
  muted_students: number;
  keywords_total: number;
  keywords_enabled: number;
  settings?: Settings;
}

interface MessageRow {
  id: number;
  sender_username: string;
  sender_real_name: string;
  receiver_username: string;
  receiver_real_name: string;
  content: string;
  points_cost: number;
  is_read: boolean;
  is_deleted: boolean;
  sent_at: string;
  report_count: number;
}

interface MuteRow {
  student_id: string;
  student_username: string;
  student_real_name: string;
  mute_until: string;
  reason: string;
  remain_days: number;
  active: number;
}

interface ReportRow {
  id: string;
  message_id: number;
  reporter_username: string;
  reporter_real_name: string;
  reported_username: string;
  reported_real_name: string;
  message_content: string;
  reason: string;
  status: 'pending' | 'handled' | 'rejected';
  muted_days: number;
  handle_note: string | null;
  handled_at: string | null;
  created_at: string;
  message_deleted: number | null;
}

interface KeywordRow {
  id: string;
  word: string;
  category: string;
  enabled: number;
}

interface QuickRow {
  id: string;
  content: string;
  sort_order: number;
  enabled: number;
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'settings', label: '消息设置', icon: 'fa-sliders' },
  { id: 'messages', label: '消息记录', icon: 'fa-comments' },
  { id: 'mutes', label: '禁言管理', icon: 'fa-microphone-slash' },
  { id: 'reports', label: '举报处理', icon: 'fa-flag' },
  { id: 'keywords', label: '屏蔽词', icon: 'fa-ban' },
  { id: 'quick', label: '快捷短语', icon: 'fa-bolt' },
];

export const MessageManager: React.FC = () => {
  const [tab, setTab] = useState<TabId>('settings');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [settings, setSettings] = useState<Settings>({ enabled: true, pointsPerMessage: 1, maxLength: 100, maxPerDay: 0 });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [msgKeyword, setMsgKeyword] = useState('');
  const [msgSender, setMsgSender] = useState('');     // 按发送人账号/姓名筛选
  const [msgReceiver, setMsgReceiver] = useState(''); // 按接收人账号/姓名筛选
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [mutes, setMutes] = useState<MuteRow[]>([]);
  const [muteAccount, setMuteAccount] = useState('');
  const [muteDays, setMuteDays] = useState(3);
  const [muteReason, setMuteReason] = useState('');
  const [muteMsg, setMuteMsg] = useState<string | null>(null);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [reportFilter, setReportFilter] = useState<'all' | 'pending' | 'handled' | 'rejected'>('pending');
  const [handlingReport, setHandlingReport] = useState<ReportRow | null>(null);
  const [handleMuteDays, setHandleMuteDays] = useState(3);
  const [handleNote, setHandleNote] = useState('');
  const [handleDeleteMsg, setHandleDeleteMsg] = useState(true);
  const [handleMsg, setHandleMsg] = useState<string | null>(null);

  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [keywordDraft, setKeywordDraft] = useState(''); // 批量文本框草稿（多行/逗号分隔）
  const [keywordMsg, setKeywordMsg] = useState<string | null>(null);
  const [savingKeywords, setSavingKeywords] = useState(false);

  const [quick, setQuick] = useState<QuickRow[]>([]);
  const [newQuick, setNewQuick] = useState('');
  const [quickMsg, setQuickMsg] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await backendClient.get('/api/teacher/message-overview');
      const d = res?.data;
      if (d) {
        setOverview({
          today_messages: Number(d.today_messages) || 0,
          today_senders: Number(d.today_senders) || 0,
          pending_reports: Number(d.pending_reports) || 0,
          muted_students: Number(d.muted_students) || 0,
          keywords_total: Number(d.keywords_total) || 0,
          keywords_enabled: Number(d.keywords_enabled) || 0,
        });
        if (d.settings) setSettings(d.settings);
      }
    } catch { /* 忽略 */ }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await backendClient.get('/api/teacher/message-settings');
      if (res?.data) setSettings(res.data);
    } catch { /* 忽略 */ }
  }, []);

  /**
   * 当前「消息记录」筛选条件。
   * ⛔ 列表查询与批量删除必须共用这一个来源：两处各拼一份迟早漂移，
   *    会出现「看到 20 条、删掉 500 条」的事故（后端亦对应 buildStudentMessageFilter）。
   */
  const messageFilterParams = useCallback((): Record<string, string> => {
    const params: Record<string, string> = {};
    if (msgKeyword.trim()) params.keyword = msgKeyword.trim();
    if (msgSender.trim()) params.sender = msgSender.trim();
    if (msgReceiver.trim()) params.receiver = msgReceiver.trim();
    return params;
  }, [msgKeyword, msgSender, msgReceiver]);

  const loadMessages = useCallback(async () => {
    setLoadingMessages(true);
    try {
      const res = await backendClient.get('/api/teacher/student-messages', messageFilterParams());
      setMessages(res?.data || []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [messageFilterParams]);

  const loadMutes = useCallback(async () => {
    try {
      const res = await backendClient.get('/api/teacher/message-mutes');
      setMutes(res?.data || []);
    } catch { setMutes([]); }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (reportFilter !== 'all') params.status = reportFilter;
      const res = await backendClient.get('/api/teacher/message-reports', params);
      setReports(res?.data || []);
    } catch { setReports([]); }
  }, [reportFilter]);

  const loadKeywords = useCallback(async () => {
    try {
      const res = await backendClient.get('/api/teacher/message-keywords');
      const list: KeywordRow[] = res?.data || [];
      setKeywords(list);
      // 仅当用户还没动过文本框时回填，避免把正在编辑的内容冲掉
      setKeywordDraft(prev => (prev.trim() ? prev : list.map(k => k.word).join('\n')));
    } catch { setKeywords([]); }
  }, []);

  const loadQuick = useCallback(async () => {
    try {
      const res = await backendClient.get('/api/teacher/message-quick-replies');
      setQuick(res?.data || []);
    } catch { setQuick([]); }
  }, []);

  useEffect(() => { loadOverview(); loadSettings(); }, [loadOverview, loadSettings]);
  useEffect(() => {
    if (tab === 'messages') loadMessages();
    if (tab === 'mutes') loadMutes();
    if (tab === 'reports') loadReports();
    if (tab === 'keywords') loadKeywords();
    if (tab === 'quick') loadQuick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, reportFilter]);

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      const res = await backendClient.put('/api/teacher/message-settings', {
        enabled: settings.enabled,
        points_per_message: Number(settings.pointsPerMessage),
        max_length: Number(settings.maxLength),
        max_per_day: Number(settings.maxPerDay),
      });
      if (res?.error) { setSettingsMsg(res.error); return; }
      if (res?.data) setSettings(res.data);
      setSettingsMsg('保存成功');
      await loadOverview();
    } catch (e: any) {
      setSettingsMsg(e?.message || '保存失败');
    } finally {
      setSavingSettings(false);
    }
  };

  const deleteMessage = async (id: number) => {
    if (!confirm('确定删除这条消息吗？学生端将不再展示（记录仍保留供追溯）。')) return;
    try {
      await backendClient.delete(`/api/teacher/student-messages/${id}`);
      await loadMessages();
      await loadOverview();
    } catch (e: any) {
      alert(e?.message || '删除失败');
    }
  };

  /**
   * 按当前筛选条件批量清空消息。
   * 二次确认必须把「影响条数」说清楚——一键删除不可撤销，不能让老师凭感觉点。
   */
  const bulkDeleteMessages = async () => {
    const params = messageFilterParams();
    const scope = [
      params.keyword ? `内容含「${params.keyword}」` : '',
      params.sender ? `发送人含「${params.sender}」` : '',
      params.receiver ? `接收人含「${params.receiver}」` : '',
    ].filter(Boolean).join('、');
    if (!confirm(
      scope
        ? `确定删除【${scope}】的全部消息吗？\n当前已载入 ${messages.length} 条，实际删除以后端筛选结果为准。\n此操作不可撤销！`
        : `⚠️ 未设置任何筛选条件，将删除【全部】学生消息记录（不可撤销）！\n建议先按发送人/接收人/关键词筛选。\n确定继续吗？`
    )) return;
    setBulkDeleting(true);
    try {
      // 无筛选时后端会拒（CONFIRM_ALL_REQUIRED），这里显式带上确认标记
      const payload: Record<string, unknown> = { ...params };
      if (!scope) payload.confirm_all = true;
      const res = await backendClient.post('/api/teacher/student-messages/bulk-delete', payload);
      if (res?.error) { alert(res.error); return; }
      alert(`已删除 ${res?.data?.deleted ?? 0} 条消息`);
      await loadMessages();
      await loadOverview();
    } catch (e: any) {
      alert(e?.message || '批量删除失败');
    } finally {
      setBulkDeleting(false);
    }
  };

  const submitMute = async () => {
    setMuteMsg(null);
    if (!muteAccount.trim()) { setMuteMsg('请输入学生账号'); return; }
    try {
      const res = await backendClient.post('/api/teacher/message-mutes', {
        student_username: muteAccount.trim(),
        days: Number(muteDays),
        reason: muteReason.trim(),
      });
      if (res?.error) { setMuteMsg(res.error); return; }
      setMuteMsg(`已禁言 ${res?.data?.student_name} ${res?.data?.days} 天`);
      setMuteAccount('');
      setMuteReason('');
      await loadMutes();
      await loadOverview();
    } catch (e: any) {
      setMuteMsg(e?.message || '操作失败');
    }
  };

  const unmute = async (studentId: string, name: string) => {
    if (!confirm(`确定解除对 ${name} 的禁言吗？`)) return;
    try {
      await backendClient.delete(`/api/teacher/message-mutes/${studentId}`);
      await loadMutes();
      await loadOverview();
    } catch (e: any) {
      alert(e?.message || '解除失败');
    }
  };

  const handleReport = async (action: 'handle' | 'reject') => {
    if (!handlingReport) return;
    setHandleMsg(null);
    try {
      const res = await backendClient.post(`/api/teacher/message-reports/${handlingReport.id}/handle`, {
        action,
        note: handleNote.trim(),
        mute_days: action === 'handle' ? Number(handleMuteDays) || 0 : 0,
        delete_message: handleDeleteMsg,
      });
      if (res?.error) { setHandleMsg(res.error); return; }
      setHandlingReport(null);
      setHandleNote('');
      await loadReports();
      await loadMutes();
      await loadMessages();
      await loadOverview();
    } catch (e: any) {
      setHandleMsg(e?.message || '处置失败');
    }
  };

  /**
   * 批量保存屏蔽词：文本框整体替换后端词库。
   * 支持换行 / 逗号 / 分号 / 顿号 / 空格分隔，自动去重去空。
   */
  const saveKeywordsBulk = async () => {
    setKeywordMsg(null);
    setSavingKeywords(true);
    try {
      const res = await backendClient.post('/api/teacher/message-keywords/bulk', { words: keywordDraft });
      if (res?.error) { setKeywordMsg(res.error); return; }
      const d = res?.data;
      setKeywordMsg(`保存成功：共 ${d?.total ?? 0} 个屏蔽词`);
      setKeywordDraft((d?.words || []).join('\n'));
      await loadKeywords();
      await loadOverview();
    } catch (e: any) {
      setKeywordMsg(e?.message || '保存失败');
    } finally {
      setSavingKeywords(false);
    }
  };

  const addQuick = async () => {
    setQuickMsg(null);
    if (!newQuick.trim()) { setQuickMsg('请输入短语内容'); return; }
    try {
      const res = await backendClient.post('/api/teacher/message-quick-replies', {
        content: newQuick.trim(),
        sort_order: (quick.length + 1) * 10,
      });
      if (res?.error) { setQuickMsg(res.error); return; }
      setNewQuick('');
      await loadQuick();
    } catch (e: any) {
      setQuickMsg(e?.message || '添加失败');
    }
  };

  const deleteQuick = async (q: QuickRow) => {
    if (!confirm('确定删除这条快捷短语吗？')) return;
    try {
      await backendClient.delete(`/api/teacher/message-quick-replies/${q.id}`);
      await loadQuick();
    } catch (e: any) {
      alert(e?.message || '删除失败');
    }
  };

  const inputCls = 'w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';

  return (
    <div className="p-6">
      {/* 页头 */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">
          <i className="fa-solid fa-comments text-blue-500 mr-2"></i>消息设置
        </h1>
        <p className="text-sm text-gray-500">
          管理学生之间的消息功能：收费规则、内容风控、禁言与举报处置
        </p>
      </div>

      {/* 概览卡片 */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {[
            { label: '今日消息', value: overview.today_messages, icon: 'fa-comment', color: 'blue' },
            { label: '今日发消息人数', value: overview.today_senders, icon: 'fa-users', color: 'indigo' },
            { label: '待处理举报', value: overview.pending_reports, icon: 'fa-flag', color: 'red' },
            { label: '禁言中', value: overview.muted_students, icon: 'fa-microphone-slash', color: 'orange' },
            { label: '屏蔽词(启用/总)', value: `${overview.keywords_enabled}/${overview.keywords_total}`, icon: 'fa-ban', color: 'amber' },
            { label: '每条消耗积分', value: overview.settings?.pointsPerMessage ?? 0, icon: 'fa-coins', color: 'emerald' },
          ].map(c => (
            <div key={c.label} className="p-3.5 bg-white rounded-xl border border-gray-200">
              <div className="flex items-center gap-2 mb-1">
                <i className={`fa-solid ${c.icon} text-${c.color}-500 text-sm`}></i>
                <span className="text-xs text-gray-500">{c.label}</span>
              </div>
              <p className="text-xl font-bold text-gray-800">{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tab 栏 */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-w-[104px] py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:bg-white/60'
            }`}
          >
            <i className={`fa-solid ${t.icon} mr-1`}></i>{t.label}
          </button>
        ))}
      </div>

      {/* ① 消息设置 */}
      {tab === 'settings' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">基础设置</h2>
          <p className="text-xs text-gray-500 mb-5">
            这些设置对全校学生生效（教学班是否可用消息，请到「班级管理」里单独控制）
          </p>

          <div className="space-y-5">
            <label className="flex items-center justify-between p-4 bg-blue-50 rounded-xl cursor-pointer">
              <div>
                <p className="font-medium text-gray-800">启用学生消息功能</p>
                <p className="text-xs text-gray-500 mt-0.5">关闭后所有学生都无法发送消息</p>
              </div>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={e => setSettings({ ...settings, enabled: e.target.checked })}
                className="w-5 h-5 accent-blue-600"
              />
            </label>

            <div className="p-4 bg-emerald-50 rounded-xl">
              <label className="block font-medium text-gray-800 mb-1">发送每条消息消耗的积分</label>
              <p className="text-xs text-gray-500 mb-2">设为 0 表示不扣积分；积分不足的学生将无法发送</p>
              <input
                type="number"
                min={0}
                max={1000}
                value={settings.pointsPerMessage}
                onChange={e => setSettings({ ...settings, pointsPerMessage: Number(e.target.value) })}
                className={inputCls}
              />
            </div>

            <div className="p-4 bg-amber-50 rounded-xl">
              <label className="block font-medium text-gray-800 mb-1">单条消息字数限制</label>
              <p className="text-xs text-gray-500 mb-2">建议 50~200 字，过长不利于课堂阅读</p>
              <input
                type="number"
                min={1}
                max={2000}
                value={settings.maxLength}
                onChange={e => setSettings({ ...settings, maxLength: Number(e.target.value) })}
                className={inputCls}
              />
            </div>

            <div className="p-4 bg-sky-50 rounded-xl">
              <label className="block font-medium text-gray-800 mb-1">每日发送上限（条）</label>
              <p className="text-xs text-gray-500 mb-2">设为 0 表示不限条数，完全由积分约束</p>
              <input
                type="number"
                min={0}
                max={1000}
                value={settings.maxPerDay}
                onChange={e => setSettings({ ...settings, maxPerDay: Number(e.target.value) })}
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={saveSettings}
              disabled={savingSettings}
              className="px-6 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {savingSettings ? '保存中...' : '保存设置'}
            </button>
            {settingsMsg && (
              <span className={`text-sm ${settingsMsg.includes('成功') ? 'text-emerald-600' : 'text-red-500'}`}>
                {settingsMsg}
              </span>
            )}
          </div>

          <div className="mt-6 p-4 bg-gray-50 rounded-xl text-xs text-gray-600 leading-relaxed">
            <p className="font-semibold text-gray-700 mb-1.5">
              <i className="fa-solid fa-circle-info mr-1"></i>学生端在发送框看到的内容
            </p>
            <p className="italic">
              「本功能主要用于课堂互动学习，请合理使用消息文明沟通。你的消息受到老师监督，如有违规会受到相应惩罚。」
            </p>
          </div>
        </div>
      )}

      {/* ② 消息记录 */}
      {tab === 'messages' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex-1 min-w-[200px] relative">
              <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                type="text"
                value={msgKeyword}
                onChange={e => setMsgKeyword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadMessages(); }}
                placeholder="搜索消息内容，回车查询"
                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="w-[180px] relative">
              <i className="fa-solid fa-right-from-bracket absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                type="text"
                value={msgSender}
                onChange={e => setMsgSender(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadMessages(); }}
                placeholder="发送人（账号/姓名）"
                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="w-[180px] relative">
              <i className="fa-solid fa-right-to-bracket absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                type="text"
                value={msgReceiver}
                onChange={e => setMsgReceiver(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadMessages(); }}
                placeholder="接收人（账号/姓名）"
                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <button onClick={loadMessages} className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
              查询
            </button>
            {(msgKeyword || msgSender || msgReceiver) && (
              <button
                onClick={() => { setMsgKeyword(''); setMsgSender(''); setMsgReceiver(''); }}
                className="px-3 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
              >
                重置
              </button>
            )}
            <button
              onClick={bulkDeleteMessages}
              disabled={bulkDeleting}
              className="ml-auto px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-50 whitespace-nowrap"
            >
              <i className="fa-solid fa-trash-can mr-1"></i>
              {bulkDeleting ? '删除中…' : '批量删除'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            <i className="fa-solid fa-circle-info text-blue-400 mr-1"></i>
            「批量删除」按下方的当前筛选条件执行，未设置任何条件时会删除全部记录，请谨慎操作。
          </p>

          {loadingMessages ? (
            <div className="p-8 text-center text-gray-500">
              <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
            </div>
          ) : messages.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <i className="fa-regular fa-comment-dots text-3xl mb-2"></i>
              <p>暂无消息记录</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2.5 px-2 font-medium">时间</th>
                    <th className="py-2.5 px-2 font-medium">发送人</th>
                    <th className="py-2.5 px-2 font-medium">接收人</th>
                    <th className="py-2.5 px-2 font-medium">内容</th>
                    <th className="py-2.5 px-2 font-medium text-center">积分</th>
                    <th className="py-2.5 px-2 font-medium text-center">状态</th>
                    <th className="py-2.5 px-2 font-medium text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map(m => (
                    <tr key={m.id} className={`border-b border-gray-100 hover:bg-gray-50 ${m.is_deleted ? 'opacity-50' : ''}`}>
                      <td className="py-2.5 px-2 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(m.sent_at)}</td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        {m.sender_real_name || m.sender_username}
                        <span className="text-xs text-gray-400 ml-1">({m.sender_username})</span>
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        {m.receiver_real_name || m.receiver_username}
                      </td>
                      <td className="py-2.5 px-2 max-w-xs">
                        <span className="line-clamp-2 break-words">{m.content}</span>
                      </td>
                      <td className="py-2.5 px-2 text-center text-xs">
                        {m.points_cost > 0 ? <span className="text-amber-600">-{m.points_cost}</span> : '—'}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {m.is_deleted ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">已删除</span>
                        ) : m.report_count > 0 ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                            被举报×{m.report_count}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">正常</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {!m.is_deleted && (
                          <button
                            onClick={() => deleteMessage(m.id)}
                            className="text-xs text-red-600 hover:text-red-800"
                          >
                            删除
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ③ 禁言管理 */}
      {tab === 'mutes' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-4">
              <i className="fa-solid fa-microphone-slash text-orange-500 mr-1"></i>设置禁言
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">学生账号</label>
                <input
                  type="text"
                  value={muteAccount}
                  onChange={e => { setMuteAccount(e.target.value); setMuteMsg(null); }}
                  placeholder="输入学生账号"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">禁言天数</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={muteDays}
                  onChange={e => setMuteDays(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">原因（可选）</label>
                <input
                  type="text"
                  value={muteReason}
                  onChange={e => setMuteReason(e.target.value)}
                  placeholder="例如：发送辱骂内容"
                  className={inputCls}
                />
              </div>
              <button
                onClick={submitMute}
                className="w-full py-2.5 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600"
              >
                确认禁言
              </button>
              {muteMsg && (
                <p className={`text-sm ${muteMsg.includes('已禁言') ? 'text-emerald-600' : 'text-red-500'}`}>{muteMsg}</p>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-4">
              禁言名单
              <span className="ml-2 text-xs font-normal text-gray-400">共 {mutes.length} 条</span>
            </h2>
            {mutes.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <i className="fa-solid fa-check-circle text-3xl mb-2 text-emerald-300"></i>
                <p>当前没有学生被禁言</p>
              </div>
            ) : (
              <div className="space-y-2">
                {mutes.map(m => (
                  <div key={m.student_id} className={`flex items-center justify-between p-3.5 rounded-xl border ${
                    m.active ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div>
                      <p className="font-medium text-gray-800">
                        {m.student_real_name || m.student_username}
                        <span className="text-xs text-gray-400 ml-1.5">({m.student_username})</span>
                        {m.active
                          ? <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-orange-200 text-orange-700">禁言中 · 剩 {m.remain_days} 天</span>
                          : <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">已到期</span>}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        截止 {formatDateTime(m.mute_until)}
                        {m.reason ? ` · ${m.reason}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => unmute(m.student_id, m.student_real_name || m.student_username)}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-white whitespace-nowrap"
                    >
                      解除禁言
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ④ 举报处理 */}
      {tab === 'reports' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            {(['pending', 'handled', 'rejected', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setReportFilter(f)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  reportFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {{ pending: '待处理', handled: '已处理', rejected: '已驳回', all: '全部' }[f]}
              </button>
            ))}
            <button onClick={loadReports} className="ml-auto text-sm text-blue-600 hover:text-blue-800">
              <i className="fa-solid fa-rotate mr-1"></i>刷新
            </button>
          </div>

          {reports.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <i className="fa-solid fa-flag text-3xl mb-2"></i>
              <p>没有符合条件的举报记录</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map(r => (
                <div key={r.id} className={`p-4 rounded-xl border ${
                  r.status === 'pending' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="text-sm">
                      <span className="text-gray-500">举报人：</span>
                      <span className="font-medium text-gray-800">{r.reporter_real_name || r.reporter_username}</span>
                      <span className="text-xs text-gray-400 ml-1">({r.reporter_username})</span>
                      <i className="fa-solid fa-arrow-right text-xs text-gray-400 mx-2"></i>
                      <span className="text-gray-500">被举报人：</span>
                      <span className="font-medium text-red-700">{r.reported_real_name || r.reported_username}</span>
                      <span className="text-xs text-gray-400 ml-1">({r.reported_username})</span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                      r.status === 'pending' ? 'bg-red-200 text-red-700'
                        : r.status === 'handled' ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-200 text-gray-600'
                    }`}>
                      {{ pending: '待处理', handled: '已处理', rejected: '已驳回' }[r.status]}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-white border border-gray-200 mb-2">
                    <p className="text-xs text-gray-500 mb-1">被举报消息内容：</p>
                    <p className="text-sm text-gray-800 break-words whitespace-pre-wrap">{r.message_content || '（内容已不可用）'}</p>
                  </div>

                  <p className="text-sm text-gray-700 mb-2">
                    <span className="text-gray-500">举报理由：</span>{r.reason}
                  </p>

                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{formatDateTime(r.created_at)}{r.muted_days > 0 ? ` · 已禁言 ${r.muted_days} 天` : ''}</span>
                    {r.status === 'pending' && (
                      <button
                        onClick={() => {
                          setHandlingReport(r);
                          setHandleMuteDays(3);
                          setHandleNote('');
                          setHandleDeleteMsg(true);
                          setHandleMsg(null);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700"
                      >
                        处置
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ⑤ 屏蔽词 */}
      {tab === 'keywords' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-1">
            <i className="fa-solid fa-ban text-amber-500 mr-1"></i>屏蔽词批量设置
            <span className="ml-2 text-xs font-normal text-gray-400">
              当前词库 {keywords.length} 个
            </span>
          </h2>
          <p className="text-xs text-gray-500 leading-relaxed mb-4">
            每行一个词，也可用逗号、分号、顿号或空格分隔；保存时整表替换（前后端共用一套边界：最多 1000 个、单个不超过 100 字）。
            学生发出的消息只要包含任一屏蔽词就会被拒绝发送，并提示命中了哪个词。
          </p>
          <textarea
            rows={16}
            value={keywordDraft}
            onChange={e => { setKeywordDraft(e.target.value); setKeywordMsg(null); }}
            placeholder={'例如：\n作弊\n代写\n色情\n赌博'}
            className={`${inputCls} resize-y font-mono text-xs leading-relaxed`}
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={saveKeywordsBulk}
              disabled={savingKeywords}
              className="px-5 py-2.5 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 disabled:opacity-50"
            >
              {savingKeywords ? '保存中…' : '保存屏蔽词库'}
            </button>
            <button
              onClick={() => { setKeywordDraft(keywords.map(k => k.word).join('\n')); setKeywordMsg(null); }}
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50"
            >
              还原为当前词库
            </button>
            <button
              onClick={() => { if (confirm('确定清空文本框吗？（需再次点击「保存」才会生效）')) setKeywordDraft(''); }}
              className="px-4 py-2.5 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50"
            >
              清空草稿
            </button>
            {keywordMsg && (
              <span className={`text-sm ${keywordMsg.includes('成功') ? 'text-emerald-600' : 'text-red-500'}`}>
                {keywordMsg}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ⑥ 快捷短语 */}
      {tab === 'quick' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-4">
              <i className="fa-solid fa-bolt text-sky-500 mr-1"></i>添加快捷短语
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">短语内容</label>
                <textarea
                  rows={3}
                  maxLength={200}
                  value={newQuick}
                  onChange={e => { setNewQuick(e.target.value); setQuickMsg(null); }}
                  placeholder="例如：我们来PK一局吧"
                  className={`${inputCls} resize-none`}
                />
              </div>
              <button
                onClick={addQuick}
                className="w-full py-2.5 rounded-lg bg-sky-500 text-white font-medium hover:bg-sky-600"
              >
                添加
              </button>
              {quickMsg && <p className="text-sm text-red-500">{quickMsg}</p>}
              <p className="text-xs text-gray-500 leading-relaxed pt-1">
                学生发送消息时，可从这些短语里一点即填，省去打字的麻烦。
              </p>
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-4">
              短语列表
              <span className="ml-2 text-xs font-normal text-gray-400">共 {quick.length} 条</span>
            </h2>
            {quick.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <p>暂无快捷短语</p>
              </div>
            ) : (
              <div className="space-y-2">
                {quick.map(q => (
                  <div key={q.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                    q.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60'
                  }`}>
                    <span className={`text-sm ${q.enabled ? 'text-gray-800' : 'text-gray-500 line-through'}`}>
                      {q.content}
                    </span>
                    <button
                      onClick={() => deleteQuick(q)}
                      className="ml-3 text-xs text-gray-400 hover:text-red-600 whitespace-nowrap"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 举报处置弹窗 */}
      <AnimatePresence>
        {handlingReport && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-[9998]"
              onClick={() => setHandlingReport(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 flex items-center justify-center z-[9999] p-4"
            >
              <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h3 className="font-bold text-gray-800">处置举报</h3>
                  <button onClick={() => setHandlingReport(null)} className="text-gray-400 hover:text-gray-600">
                    <i className="fa-solid fa-xmark text-lg"></i>
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  <div className="p-3 bg-gray-50 rounded-xl text-sm">
                    <p className="text-gray-700 mb-1">
                      <span className="text-gray-500">被举报人：</span>
                      <span className="font-medium text-red-700">
                        {handlingReport.reported_real_name || handlingReport.reported_username}
                      </span>
                    </p>
                    <p className="text-gray-700">
                      <span className="text-gray-500">举报理由：</span>{handlingReport.reason}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      禁言天数（0 = 不禁言）
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={handleMuteDays}
                      onChange={e => setHandleMuteDays(Number(e.target.value))}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">处理备注（可选）</label>
                    <input
                      type="text"
                      value={handleNote}
                      onChange={e => setHandleNote(e.target.value)}
                      placeholder="例如：已核实，警告并禁言"
                      className={inputCls}
                    />
                  </div>

                  <label className="flex items-center gap-2.5 p-3 bg-red-50 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={handleDeleteMsg}
                      onChange={e => setHandleDeleteMsg(e.target.checked)}
                      className="w-4 h-4 accent-red-600"
                    />
                    <span className="text-sm text-gray-700">同时删除这条被举报的消息</span>
                  </label>

                  {handleMsg && <p className="text-sm text-red-500">{handleMsg}</p>}
                </div>

                <div className="flex gap-2 px-5 py-4 border-t border-gray-100">
                  <button
                    onClick={() => handleReport('handle')}
                    className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
                  >
                    确认处理
                  </button>
                  <button
                    onClick={() => handleReport('reject')}
                    className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
                  >
                    驳回
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MessageManager;
