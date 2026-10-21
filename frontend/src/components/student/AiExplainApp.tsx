import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_CONFIG } from '../../api/config';
import { authHeaders } from '../../utils/authToken';
import { sanitizeHtml, htmlToPlainText } from '../../utils/htmlUtils';
import { AiExplainPlayer, ExplainQuestion, ExplainStyleOption } from '../teacher/AiExplainPlayer';

/**
 * 学生端「AI 讲解」窗口
 *
 * 只有老师在该账号的「学生管理 → 讲解」里放开了 ai_explain 才会出现（默认关闭）。
 * 进去后列出自己的错题，点一道听一道；也可以连播。
 *
 * ⛔ 只能听自己做错过的题：后端会校验 question_id 命中自己的 wrong_questions，
 *    否则等于开了一个「输入题号换全库答案」的入口。
 * ⛔ 风格 chip 由 /api/student/explain/access 下发（已过滤停用项），前端不要自己拼。
 */

interface WrongItem extends ExplainQuestion {
  wrong_count?: number;
  is_resolved?: number;
}

interface AccessData {
  enabled: boolean;
  aiReady: boolean;
  styles: ExplainStyleOption[];
}

const TYPE_LABEL: Record<string, string> = {
  choice: '单选',
  fill_blank: '填空',
  fill: '填空',
  composite: '复合题',
  judge: '判断',
};

export const AiExplainApp: React.FC = () => {
  const [access, setAccess] = useState<AccessData | null>(null);
  const [items, setItems] = useState<WrongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<ExplainQuestion[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const accessRes = await fetch(`${API_CONFIG.apiUrl}/api/student/explain/access`, { headers: authHeaders() });
      const accessJson = await accessRes.json().catch(() => null);
      if (!accessRes.ok) throw new Error((accessJson && accessJson.error) || `读取权限失败（${accessRes.status}）`);
      const data = (accessJson?.data || { enabled: false, aiReady: false, styles: [] }) as AccessData;
      setAccess(data);
      if (!data.enabled) { setItems([]); return; }

      const res = await fetch(`${API_CONFIG.apiUrl}/api/student/explain/wrong-questions?limit=30`, { headers: authHeaders() });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `读取错题失败（${res.status}）`);
      setItems((json?.data?.questions || []) as WrongItem[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const styles = access?.styles || [];

  const previews = useMemo(() => items.map((it) => {
    const text = htmlToPlainText(it.content || '').replace(/\s+/g, ' ').trim();
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  }), [items]);

  if (playing) {
    // ⛔ 必须 portal 到 body：播放器是 fixed inset-0 z-[9999]，但它渲染在桌面窗口（WindowFrame 带
    //    transform，会新建层叠上下文）里，直接渲染会被桌面任务栏压住（顶部/底部被切掉）。
    return createPortal(
      <AiExplainPlayer
        questions={playing}
        audience="student"
        styles={styles}
        title="错题讲解"
        onClose={() => setPlaying(null)}
      />,
      document.body,
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-600 px-3 py-1 text-sm text-white">
            <i className="fa-solid fa-headphones-simple mr-1"></i>
            AI 讲解
          </span>
          <span className="text-sm text-gray-600">听老师讲你的错题</span>
        </div>
        <div className="flex items-center gap-2">
          {styles.length > 0 && (
            <span className="text-xs text-gray-400">
              可选风格：{styles.map((s) => s.name).join(' / ')}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <i className="fa-solid fa-rotate mr-1"></i>
            刷新
          </button>
          {items.length > 1 && (
            <button
              onClick={() => setPlaying(items as ExplainQuestion[])}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
            >
              <i className="fa-solid fa-play mr-1"></i>
              连播全部（{items.length}）
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
            <i className="fa-solid fa-spinner fa-spin text-2xl text-indigo-500"></i>
            <p className="text-sm">正在读取…</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-rose-600">{error}</p>
            <button onClick={load} className="rounded-lg bg-indigo-600 px-4 py-2 text-white">重试</button>
          </div>
        )}

        {!loading && !error && access && !access.enabled && (
          <div className="mx-auto mt-10 max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center">
            <i className="fa-solid fa-lock text-3xl text-gray-400"></i>
            <p className="mt-3 font-medium text-gray-800">老师还没有为你开通 AI 讲解</p>
            <p className="mt-1 text-sm text-gray-500">
              需要老师在「学生管理 → 讲解」里给你打开开关（默认是关闭的）。
            </p>
          </div>
        )}

        {!loading && !error && access && access.enabled && !access.aiReady && (
          <div className="mx-auto mt-10 max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-800">
            <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
            <p className="mt-2 text-sm">AI 功能还没有授权激活，暂时不能生成讲解。请联系老师。</p>
          </div>
        )}

        {!loading && !error && access && access.enabled && access.aiReady && items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
            <i className="fa-solid fa-face-smile text-3xl text-emerald-500"></i>
            <p className="text-sm">你还没有错题，暂时没有可讲的内容。</p>
          </div>
        )}

        {!loading && !error && access && access.enabled && access.aiReady && items.length > 0 && (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={it.id} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3">
                <span className="mt-0.5 w-6 shrink-0 text-right text-xs text-gray-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                      {TYPE_LABEL[it.type || ''] || it.type || '题目'}
                    </span>
                    {it.cluster_id && (
                      <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">{it.cluster_id}</span>
                    )}
                    {Number(it.wrong_count) > 1 && (
                      <span className="text-[11px] text-rose-500">错过 {it.wrong_count} 次</span>
                    )}
                    {Number(it.is_resolved) === 1 && (
                      <span className="text-[11px] text-emerald-600">已订正</span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-gray-700">{previews[i]}</p>
                  {it.options ? (
                    <div
                      className="question-rich-content mt-1 line-clamp-2 text-xs text-gray-400"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(
                          (() => {
                            try {
                              const raw = typeof it.options === 'string' ? JSON.parse(it.options) : it.options;
                              const arr = Array.isArray(raw) ? raw : (raw && raw.options) || [];
                              return arr.map((o: any, k: number) => `${String.fromCharCode(65 + k)}. ${typeof o === 'string' ? o : (o && (o.text || o.content)) || ''}`).join('　');
                            } catch {
                              return '';
                            }
                          })(),
                        ),
                      }}
                    />
                  ) : null}
                </div>
                <button
                  onClick={() => setPlaying([it as ExplainQuestion])}
                  className="shrink-0 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-100"
                >
                  <i className="fa-solid fa-play mr-1"></i>
                  听讲解
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AiExplainApp;
