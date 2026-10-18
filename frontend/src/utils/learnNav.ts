/**
 * 学习模块「跳到指定章 / 指定知识点」的跨窗口导航。
 *
 * 场景：桌面星域图层的「知识点地图」格子、今日卡里的「下一个目标」被点击时，
 * 学习窗口有两种状态——
 *   1) 已经开着（最小化也算）→ 必须**立刻切章**，不能再开一个窗口；
 *   2) 还没开 → 先开窗，新组件挂载时才知道要定位到哪一章。
 * 两种时序都覆盖，所以做双通道：
 *   - 事件 `openLearnChapter`：监听者在（窗口已存在）就即时生效；
 *   - 模块级 pending：监听者不在时先存着，等 LearnModule 挂载时消费一次。
 *
 * 与既有 `openPracticeWithCluster`（学习 → 练习）保持同一套风格。
 */

export interface LearnNavTarget {
  /** 章名（cluster_id 的一级部分） */
  cluster_id: string;
  /**
   * 可选的小节名（cluster_id 的二级部分）。
   * 传了就等讲义渲染完再滚到该小节标题；不传只切到章首。
   */
  section?: string;
}

let pending: LearnNavTarget | null = null;

/** 请求学习模块定位到某一章（clusterId 即「章名」），可选再滚到某小节 */
export function requestLearnChapter(clusterId: string, section?: string) {
  if (!clusterId) return;
  pending = section ? { cluster_id: clusterId, section } : { cluster_id: clusterId };
  try {
    window.dispatchEvent(
      new CustomEvent('openLearnChapter', { detail: { cluster_id: clusterId, section: section || '' } })
    );
  } catch {
    /* ignore */
  }
}

/**
 * 读一下待定位目标，**不清空**。
 * ⛔ 不要在 useState 的初始化函数里做「读+清空」：本项目开了 React.StrictMode，
 *    初始化函数会被执行两次，第二次拿到 null，目标章节就丢了（实测踩过）。
 */
export function peekPendingLearnChapter(): LearnNavTarget | null {
  return pending;
}

/** 真正消费掉待定位目标（在挂载后的 effect 里调，早于/晚于取目录都不影响） */
export function clearPendingLearnChapter() {
  pending = null;
}

/** 监听跳转请求；返回解绑函数。命中后清掉 pending，避免下次开窗又跳回旧目标 */
export function onOpenLearnChapter(handler: (clusterId: string, section?: string) => void): () => void {
  const fn = (e: Event) => {
    const detail = (e as CustomEvent)?.detail || {};
    const cid = detail.cluster_id;
    if (typeof cid !== 'string' || !cid) return;
    const sec = typeof detail.section === 'string' && detail.section ? detail.section : undefined;
    pending = null;
    handler(cid, sec);
  };
  window.addEventListener('openLearnChapter', fn);
  return () => window.removeEventListener('openLearnChapter', fn);
}
