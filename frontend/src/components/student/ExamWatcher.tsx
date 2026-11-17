import React, { useEffect } from 'react';
import { useDesktopStore } from '../../store/desktopStore';
import { backendClient } from '../../api/backendClient';

/**
 * 考试看守（2026-11-17）
 * ============================================================
 * 挂在 Desktop 上、**不挂在考试窗口里** —— 学生没打开考试窗口时也要收得到老师的指令。
 * （如果只在 TestModule 里心跳，学生停在桌面就永远收不到「强制开始」。）
 *
 * 三件事：
 *   1. 每 5 秒一次心跳：上报「切出去几次/多少秒」，拉老师的强制指令
 *   2. force_start  → 把测试窗口拉起来、锁死，并让 TestModule 自己取卷开始
 *   3. force_end    → 写 store.forceEndAt，TestModule 看到就开始 60 秒倒计时
 *
 * ⛔ 心跳失败绝不能弹窗、也不能停：教室网络抖动很常见，攒着下次一起报即可。
 */
export const ExamWatcher: React.FC<{ testComponent: React.ReactNode }> = ({ testComponent }) => {
  const examContext = useDesktopStore((s) => s.examContext);
  const testId = examContext?.testId || '';

  useEffect(() => {
    let stopped = false;
    let pendingCount = 0;
    let pendingSeconds = 0;
    let inactiveSince = 0;
    let isInactive = false;
    let starting = false;

    const markInactive = () => {
      // 只有在考试中才统计（在桌面闲逛不算「考试切屏」）
      if (isInactive || !testId) return;
      isInactive = true;
      inactiveSince = Date.now();
      pendingCount += 1;
    };
    const markActive = () => {
      if (!isInactive) return;
      isInactive = false;
      if (inactiveSince) {
        pendingSeconds += Math.max(0, Math.round((Date.now() - inactiveSince) / 1000));
      }
      inactiveSince = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') markInactive();
      else markActive();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', markInactive);
    window.addEventListener('focus', markActive);

    const tick = async () => {
      if (stopped) return;
      const sendCount = pendingCount;
      const sendSeconds = pendingSeconds;
      pendingCount = 0;
      pendingSeconds = 0;
      try {
        const r: any = await backendClient.examHeartbeat({
          test_id: testId || undefined,
          inactive_count: sendCount,
          inactive_seconds: sendSeconds,
        });
        if (stopped) return;
        const d = (r && r.data) || {};
        const store = useDesktopStore.getState();

        // ① 强制开始：把学生抓进考试窗口
        if (d.force_start && !store.examContext && !starting) {
          starting = true;
          const tid = d.force_start.test_id;
          store.setPendingExam(tid);
          store.openWindow(
            {
              id: 'test',
              title: '测试',
              icon: 'fa-clipboard-check',
              isMinimized: false,
              isMaximized: false,
              component: testComponent,
            },
            { force: true }
          );
          store.lockWindow('test');
          // 兜底：8 秒后还没真正进考试（考试已结束 / 取卷失败 / profile 还没就绪），
          // 就把锁解开，否则学生会被一个「进不去又关不掉」的窗口困住。
          setTimeout(() => {
            const st = useDesktopStore.getState();
            if (!st.examContext) st.unlockWindow('test');
          }, 8000);
          // 给 TestModule 一点时间取卷，避免每 5 秒重复开窗
          setTimeout(() => { starting = false; }, 15000);
        }

        // ② 强制结束：只对「正在进行的这一场」生效
        if (d.force_end && store.examContext && d.force_end.test_id === store.examContext.testId) {
          if (store.forceEndAt == null) {
            const left = d.force_end.expired ? 0 : Math.max(0, Number(d.force_end.seconds_left) || 0);
            store.setForceEndAt(Date.now() + left * 1000);
          }
        }
      } catch {
        // 网络抖动：把这次没报上去的补回去
        pendingCount += sendCount;
        pendingSeconds += sendSeconds;
      }
    };

    tick();
    // 考试中 5 秒一次（强制结束要尽快到），平时 15 秒一次（只为收「强制开始」）。
    // ⛔ 别把空闲也设成 5 秒：一个班 50 人就是 10 请求/秒，白烧服务器。
    const timer = setInterval(tick, testId ? 5000 : 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', markInactive);
      window.removeEventListener('focus', markActive);
    };
  }, [testId, testComponent]);

  return null;
};
