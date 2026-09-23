import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { backendClient } from '../../api/backendClient';
import { getAuthToken } from '../../utils/authToken';

/**
 * PK 数据统计面板（P0）
 *
 * 三个维度：
 * 1) 总览卡 —— 活动搞没搞起来（参与率 / 场次 / 正确率 / 每题耗时 / 积分发放）
 * 2) 按活动 —— 哪个配置真被用了（含「从未被参与」的活动，便于及时下线）
 * 3) 按学生 —— 谁是活跃者、谁需要干预（场次 / 胜率 / 正确率 / 连败 / 最近对战）
 *
 * 口径全部由后端 /api/pk/stats/* 裁定，前端不做二次统计（避免两处口径不一致）。
 */

interface ClassInfo {
  id: string;
  name: string;
}

interface Overview {
  total_students: number;
  players: number;
  participation_rate: number;
  total_rooms: number;
  avg_rooms_per_player: number;
  total_correct: number;
  total_answered: number;
  avg_correct_rate: number | null;
  avg_cost_ms: number | null;
  total_system_points: number;
  total_bonus_points: number;
}

interface ConfigStat {
  config_id: string | null;
  config_name: string;
  rooms: number;
  players: number;
  total_correct: number;
  total_answered: number;
  avg_correct_rate: number | null;
  avg_duration_ms: number | null;
  is_active?: boolean;
  never_used?: boolean;
}

interface StudentStat {
  id: string;
  username: string;
  real_name: string;
  pk_rank_tier: number;
  pk_rank_stars: number;
  pk_points: number;
  rooms_played: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number | null;
  total_correct: number;
  total_answered: number;
  correct_rate: number | null;
  system_points: number;
  bonus_points: number;
  consolation_points: number;
  lose_streak: number;
  last_battle_at: string | null;
}

const RANK_NAMES = ['小学生', '初中生', '高中生', '本科生', '研究生'];

const fmtDuration = (ms: number | null | undefined): string => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} 毫秒`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  return `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`;
};

const fmtDate = (v: string | null): string => {
  if (!v) return '从未参与';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 通用指标卡 */
const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: string;
  tone: string;
}> = ({ label, value, sub, icon, tone }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-4">
    <div className="flex items-center gap-2 mb-2">
      <i className={`fa-solid ${icon} ${tone}`}></i>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
    <div className="text-2xl font-bold text-gray-800">{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
  </div>
);

const SectionSpinner = () => (
  <div className="flex items-center justify-center py-10 text-gray-400">
    <i className="fa-solid fa-spinner fa-spin mr-2"></i>加载中…
  </div>
);

export const PKStatsTab: React.FC = () => {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [classId, setClassId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [byConfig, setByConfig] = useState<ConfigStat[]>([]);
  const [byStudent, setByStudent] = useState<StudentStat[]>([]);
  // 排序：按学生表的列
  const [sortKey, setSortKey] = useState<keyof StudentStat>('rooms_played');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    fetchClasses();
  }, []);

  useEffect(() => {
    if (classId) fetchStats();
  }, [classId]);

  const fetchClasses = async () => {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/classes', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await res.json();
      const list: ClassInfo[] = Array.isArray(j) ? j : (j.data || []);
      setClasses(list);
      if (list.length > 0) setClassId(list[0].id);
    } catch (e) {
      console.error('拉取班级失败:', e);
    }
  };

  const fetchStats = async () => {
    setLoading(true);
    try {
      const [o, c, s] = await Promise.all([
        backendClient.get(`/api/pk/stats/overview?class_id=${encodeURIComponent(classId)}`),
        backendClient.get(`/api/pk/stats/by-config?class_id=${encodeURIComponent(classId)}`),
        backendClient.get(`/api/pk/stats/by-student?class_id=${encodeURIComponent(classId)}`),
      ]);
      setOverview((o.data || null) as Overview | null);
      setByConfig((c.data || []) as ConfigStat[]);
      setByStudent((s.data || []) as StudentStat[]);
    } catch (e) {
      console.error('拉取 PK 统计失败:', e);
    }
    setLoading(false);
  };

  const handleSort = (key: keyof StudentStat) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortedStudents = useMemo(() => {
    const arr = [...byStudent];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // null 值恒排末尾
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), 'zh-CN');
      if (cmp === 0) cmp = String(a.username).localeCompare(String(b.username), 'zh-CN');
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [byStudent, sortKey, sortAsc]);

  /** 正确率分布柱状图数据：只取有对战记录的学生 */
  const correctRateChart = useMemo(
    () =>
      byStudent
        .filter((s) => s.correct_rate != null && s.rooms_played >= 3)
        .slice(0, 12)
        .map((s) => ({ name: s.real_name || s.username, rate: s.correct_rate as number })),
    [byStudent]
  );

  const Th: React.FC<{ k: keyof StudentStat; children: React.ReactNode; align?: 'left' | 'right' }> = ({
    k, children, align = 'right',
  }) => (
    <th
      onClick={() => handleSort(k)}
      className={`px-3 py-2 text-xs font-medium text-gray-600 cursor-pointer select-none whitespace-nowrap hover:text-purple-600 ${
        align === 'left' ? 'text-left' : 'text-right'
      }`}
      title="点击排序"
    >
      {children}
      {sortKey === k && (
        <i className={`fa-solid ${sortAsc ? 'fa-arrow-up' : 'fa-arrow-down'} ml-1 text-purple-500`}></i>
      )}
    </th>
  );

  return (
    <div className="space-y-6">
      {/* 头部：班级选择 */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-bold text-gray-800">
            <i className="fa-solid fa-chart-simple mr-2 text-purple-500"></i>PK 数据统计
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            统计口径由服务端裁定；只计入已正常结算的对局
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">班级</label>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={fetchStats}
            className="p-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
            title="刷新"
          >
            <i className="fa-solid fa-rotate-right"></i>
          </button>
        </div>
      </div>

      {loading && <SectionSpinner />}

      {!loading && !overview && (
        <div className="text-center py-12 text-gray-500 bg-white rounded-lg border border-gray-200">
          <i className="fa-solid fa-chart-column text-6xl mb-4 text-gray-300"></i>
          <p>暂无统计结果</p>
          <p className="text-sm mt-2">请确认该班级已开启 PK 对战且学生有参与记录</p>
        </div>
      )}

      {!loading && overview && (
        <>
          {/* ===== 1. 总览卡 ===== */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard
              label="参与率"
              value={`${overview.participation_rate}%`}
              sub={`${overview.players} / ${overview.total_students} 人参与`}
              icon="fa-users"
              tone="text-blue-500"
            />
            <StatCard
              label="总场次"
              value={overview.total_rooms}
              sub={`人均 ${overview.avg_rooms_per_player} 场`}
              icon="fa-trophy"
              tone="text-purple-500"
            />
            <StatCard
              label="平均正确率"
              value={overview.avg_correct_rate == null ? '—' : `${overview.avg_correct_rate}%`}
              sub={`${overview.total_correct} / ${overview.total_answered} 题`}
              icon="fa-circle-check"
              tone={overview.avg_correct_rate == null ? 'text-gray-400' : (overview.avg_correct_rate >= 60 ? 'text-green-500' : 'text-orange-500')}
            />
            <StatCard
              label="平均每题耗时"
              value={fmtDuration(overview.avg_cost_ms)}
              sub="按作答流水计算"
              icon="fa-stopwatch"
              tone="text-cyan-500"
            />
            <StatCard
              label="系统积分发放"
              value={overview.total_system_points}
              sub="按做对题数结算"
              icon="fa-coins"
              tone="text-amber-500"
            />
            <StatCard
              label="参与奖励发放"
              value={overview.total_bonus_points}
              sub="首战 / 全勤等"
              icon="fa-gift"
              tone="text-pink-500"
            />
          </div>

          {/* ===== 2. 按活动统计 ===== */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h4 className="font-bold text-gray-800 mb-1">
              <i className="fa-solid fa-layer-group mr-2 text-purple-500"></i>按活动统计
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              标「从未被参与」的活动建议调整筛选条件或及时下线
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">活动名称</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">场次</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">参与人数</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">平均正确率</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">平均对局时长</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-600">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {byConfig.map((c, i) => (
                    <tr key={c.config_id || `null-${i}`} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-800">
                        {c.config_id === null
                          ? <span className="text-gray-500">{c.config_name}</span>
                          : c.config_name}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{c.rooms}</td>
                      <td className="px-3 py-2 text-right">{c.players}</td>
                      <td className="px-3 py-2 text-right">
                        {c.avg_correct_rate == null ? '—' : `${c.avg_correct_rate}%`}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">{fmtDuration(c.avg_duration_ms)}</td>
                      <td className="px-3 py-2 text-center">
                        {c.never_used ? (
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs rounded">从未被参与</span>
                        ) : c.is_active === false ? (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">已禁用</span>
                        ) : (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">进行中</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {byConfig.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-gray-400">暂无活动数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ===== 正确率分布 ===== */}
          {correctRateChart.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h4 className="font-bold text-gray-800 mb-1">
                <i className="fa-solid fa-chart-column mr-2 text-purple-500"></i>学生正确率（对战场次 ≥ 3）
              </h4>
              <p className="text-xs text-gray-500 mb-3">
                比胜率更公平：输给强手但答题准确，说明知识点已掌握
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={correctRateChart} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                  <Tooltip formatter={(v: any) => [`${v}%`, '正确率']} />
                  <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                    {correctRateChart.map((d, i) => (
                      <Cell key={i} fill={d.rate >= 60 ? '#22c55e' : d.rate >= 40 ? '#f59e0b' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ===== 3. 按学生统计 ===== */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h4 className="font-bold text-gray-800 mb-1">
              <i className="fa-solid fa-user-graduate mr-2 text-purple-500"></i>学生对战明细
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              点击表头排序；「连败」≥3 建议关注或调整匹配
            </p>
            <div className="overflow-x-auto" style={{ maxHeight: 560 }}>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">学生</th>
                    <Th k="rooms_played">场次</Th>
                    <Th k="wins">胜</Th>
                    <Th k="losses">负</Th>
                    <Th k="draws">平</Th>
                    <Th k="win_rate">胜率</Th>
                    <Th k="correct_rate">正确率</Th>
                    <Th k="pk_points">PK 积分</Th>
                    <Th k="system_points">系统积分</Th>
                    <Th k="bonus_points">参与奖励</Th>
                    <Th k="lose_streak">连败</Th>
                    <Th k="last_battle_at">最近对战</Th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStudents.map((s) => (
                    <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800">{s.real_name || s.username}</span>
                          <span className="text-xs text-gray-400">{s.username}</span>
                          <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 text-xs rounded">
                            {RANK_NAMES[s.pk_rank_tier] || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{s.rooms_played}</td>
                      <td className="px-3 py-2 text-right text-green-600">{s.wins}</td>
                      <td className="px-3 py-2 text-right text-red-500">{s.losses}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{s.draws}</td>
                      <td className="px-3 py-2 text-right">
                        {s.win_rate == null ? '—' : `${s.win_rate}%`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.correct_rate == null ? (
                          '—'
                        ) : (
                          <span className={s.correct_rate >= 60 ? 'text-green-600' : s.correct_rate >= 40 ? 'text-orange-500' : 'text-red-500'}>
                            {s.correct_rate}%
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-amber-600">{s.pk_points}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{s.system_points}</td>
                      <td className="px-3 py-2 text-right text-pink-600">
                        {s.bonus_points + s.consolation_points > 0
                          ? s.bonus_points + s.consolation_points
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.lose_streak >= 3 ? (
                          <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded font-medium">
                            {s.lose_streak} 连败
                          </span>
                        ) : s.lose_streak > 0 ? (
                          <span className="text-gray-500">{s.lose_streak}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmtDate(s.last_battle_at)}</td>
                    </tr>
                  ))}
                  {sortedStudents.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-8 text-center text-gray-400">该班级暂无学生</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
