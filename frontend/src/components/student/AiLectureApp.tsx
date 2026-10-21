import React, { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../../utils/authToken';
import LecturePlayer, { Lecture } from '../lecture/LecturePlayer';

/**
 * 学生端「AI 讲堂」窗口。
 *
 * 只在老师于「学生管理 → 讲解」放开了 ai_explain 时才能进（默认关闭，与「AI讲解」同一个开关）。
 * 里面只列**已发布**的微课程，草稿永远不会出现在这里。
 *
 * ⛔ 学生端不给任何编辑入口：微课程是老师的课件资产，学生只能看、只能播。
 * ⛔ 播放次数由后端在学生打开详情时自增，前端不做统计上报。
 */

interface LectureCard {
  id: string;
  title: string;
  subject: string;
  chapter: string;
  cover: { kind: string; title: string; kicker?: string } | null;
  page_count: number;
  duration_sec: number;
  play_count: number;
}

const KIND_ICON: Record<string, string> = {
  lead: 'fa-lightbulb',
  point: 'fa-list-check',
  steps: 'fa-arrow-right-arrow-left',
  table: 'fa-table-columns',
  chart: 'fa-chart-simple',
  code: 'fa-code',
  example: 'fa-circle-question',
  recap: 'fa-check-double',
};

const fmtDuration = (sec: number) => {
  const s = Number(sec) || 0;
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} 分 ${s % 60} 秒` : `${s} 秒`;
};

export const AiLectureApp: React.FC = () => {
  const [list, setList] = useState<LectureCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState<Lecture | null>(null);
  const [opening, setOpening] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/student/lectures', { headers: authHeaders() });
      const json = await res.json().catch(() => null);
      if (res.status === 403) { setForbidden(true); return; }
      if (!res.ok) throw new Error((json && json.error) || `加载失败（${res.status}）`);
      setList(json?.data?.lectures || []);
    } catch (e) {
      setErr((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const play = async (id: string) => {
    setOpening(id);
    try {
      const res = await fetch(`/api/student/lectures/${id}`, { headers: authHeaders() });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || '打开失败');
      const lec = json?.data?.lecture;
      if (!lec?.pages?.length) throw new Error('这门课还没有内容');
      setPlaying(lec as Lecture);
    } catch (e) {
      alert((e as Error).message || '打开失败');
    } finally {
      setOpening('');
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        <i className="fa-solid fa-spinner fa-spin mr-2"></i>加载中…
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          <i className="fa-solid fa-lock text-2xl"></i>
        </div>
        <p className="font-medium text-gray-800">老师还没有为你开通 AI 讲堂</p>
        <p className="mt-2 text-sm text-gray-500">需要老师在你账号的「讲解」开关里打开</p>
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500">
          <i className="fa-solid fa-circle-exclamation text-2xl"></i>
        </div>
        <p className="font-medium text-gray-800">{err}</p>
        <button onClick={load} className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700">
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-gray-50 p-4">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800">
          <i className="fa-solid fa-chalkboard-user text-violet-600"></i>AI 讲堂
        </h2>
        <p className="mt-1 text-xs text-gray-500">老师做好的微课程，点开就能边看边听。</p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white py-14 text-center">
          <i className="fa-solid fa-chalkboard-user mb-3 text-3xl text-gray-300"></i>
          <p className="text-gray-500">老师还没有发布微课程</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.map((item) => (
            <button
              key={item.id}
              onClick={() => play(item.id)}
              disabled={opening === item.id}
              className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-violet-300 hover:shadow-md disabled:opacity-60"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
                {opening === item.id
                  ? <i className="fa-solid fa-spinner fa-spin"></i>
                  : <i className={`fa-solid ${KIND_ICON[item.cover?.kind || 'lead'] || 'fa-lightbulb'}`}></i>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-gray-800">{item.title}</p>
                <p className="mt-0.5 truncate text-xs text-gray-500">{item.chapter || item.subject || ''}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {item.page_count} 页 · 约 {fmtDuration(item.duration_sec)}
                </p>
              </div>
              <i className="fa-solid fa-play mt-3 shrink-0 text-xs text-violet-500"></i>
            </button>
          ))}
        </div>
      )}

      {playing && (
        <LecturePlayer lecture={playing} audience="student" onClose={() => { setPlaying(null); load(); }} />
      )}
    </div>
  );
};

export default AiLectureApp;
