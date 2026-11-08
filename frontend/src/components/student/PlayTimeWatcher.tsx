import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDesktopStore } from '../../store/desktopStore';
import { backendClient } from '../../api/backendClient';

/**
 * 游戏时长看守（2026-11-08）
 * ============================================================
 * 挂在 Desktop 上（不是挂在应用中心里）——应用中心窗口可能被关掉，但游戏窗口还在，
 * 挂在应用中心里就会出现「关掉应用中心继续玩、不扣时间」的漏洞。
 *
 * 规则：
 *  · 只有「按时长」类型（apps.price_type='time'）的应用窗口打开且未最小化时计时
 *  · 每 30 秒一次心跳，服务端扣 30 秒并校验每日上限
 *  · 服务端返回 locked 时关掉窗口并弹遮罩（余额耗尽 / 今日额度用完）
 *  · 页面切到后台（标签不可见）时跳过本次心跳，不给「挂着不看也扣时」的冤枉
 *
 * ⛔ 计时必须在服务端结算。前端只负责按节奏上报，绝不在前端扣减余额。
 */

const HEARTBEAT_SECONDS = 30;

type LockInfo = { title: string; reason: 'no_balance' | 'daily_cap'; capMinutes: number } | null;

export const PlayTimeWatcher: React.FC = () => {
  const { windows, closeWindow } = useDesktopStore();
  const [timeAppIds, setTimeAppIds] = useState<string[]>([]);
  const [lock, setLock] = useState<LockInfo>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const warnedRef = useRef(false);
  const lockRef = useRef(false);

  // 拉一次「按时长」应用清单；老师改配置后学生刷新页面即生效
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data }: any = await backendClient
          .from('apps')
          .select('id')
          .eq('is_active', true)
          .eq('price_type', 'time');
        if (alive) setTimeAppIds((data || []).map((x: any) => String(x.id)));
      } catch {
        /* 拉不到就当作没有时长应用，不影响桌面其他功能 */
      }
    })();
    return () => { alive = false; };
  }, []);

  // 当前正在前台玩的时长应用（多个窗口同时开时只算最上面那个，避免重复扣时）
  const active = useMemo(() => {
    if (!timeAppIds.length) return null;
    const open = windows.filter(
      (w) => w.isOpen && !w.isMinimized && w.id.startsWith('app_') && timeAppIds.includes(w.id.slice(4))
    );
    if (!open.length) return null;
    const top = open.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
    return { windowId: top.id, appId: top.id.slice(4), title: top.title };
  }, [windows, timeAppIds]);

  // ⛔ 不能把 active 放进计时 effect 的依赖：拖窗口、切窗口都会改 zIndex，
  //    active 对象一变 effect 就重建、立刻 tick 一次 → 白扣 30 秒。
  //    这里用 ref 持有最新值，effect 只跟 appId 走。
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  const activeAppId = active?.appId ?? null;

  useEffect(() => {
    if (!activeAppId || lock) return;
    let stopped = false;

    const tick = async () => {
      if (stopped || lockRef.current) return;
      const a = activeRef.current;
      if (!a) return;
      // 标签切到后台不算玩
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const r: any = await backendClient.post('/api/student/playtime/heartbeat', {
          app_id: a.appId,
          seconds: HEARTBEAT_SECONDS,
        });
        const d = r?.data;
        if (!d || stopped) return;
        if (d.locked) {
          lockRef.current = true;
          const capMinutes = Math.round((d.cap_seconds || 0) / 60);
          setLock({
            title: a.title,
            reason: d.lock_reason === 'daily_cap' ? 'daily_cap' : 'no_balance',
            capMinutes,
          });
          closeWindow(a.windowId);
          return;
        }
        // 剩不到 1 分钟提醒一次，别让学生被突然中断
        if (!warnedRef.current && typeof d.balance_seconds === 'number' && d.balance_seconds > 0 && d.balance_seconds <= 60) {
          warnedRef.current = true;
          setWarning('游戏时间只剩不到 1 分钟了，做完这一段就去做题赚钻石吧');
          setTimeout(() => setWarning(null), 6000);
        }
      } catch {
        /* 网络抖动：跳过这一次，不扣时也不锁屏，下次心跳继续 */
      }
    };

    tick();
    const timer = setInterval(tick, HEARTBEAT_SECONDS * 1000);
    return () => { stopped = true; clearInterval(timer); };
  }, [activeAppId, lock, closeWindow]);

  // 重新开始玩一个应用时，重置「已提醒过」标记
  useEffect(() => {
    if (activeAppId) { warnedRef.current = false; lockRef.current = false; }
  }, [activeAppId]);

  return (
    <>
      {warning && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[9999] bg-amber-500 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm">
          <i className="fa-solid fa-hourglass-half mr-2"></i>
          {warning}
        </div>
      )}

      {lock && (
        <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-7 max-w-sm w-full text-center shadow-2xl">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-sky-100 flex items-center justify-center">
              <i className="fa-solid fa-gem text-2xl text-sky-500"></i>
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">时间到了</h3>
            <p className="text-gray-600 text-sm mb-1">
              {lock.reason === 'daily_cap'
                ? `今天已经玩满 ${lock.capMinutes} 分钟了，明天再来。`
                : '游戏时间用完了。'}
            </p>
            <p className="text-gray-500 text-sm mb-5">
              去测试、考试或完成任务可以赚钻石，1 颗钻石换几分钟游戏时间。
            </p>
            <button
              onClick={() => { setLock(null); lockRef.current = false; }}
              className="w-full py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium transition-colors"
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default PlayTimeWatcher;
