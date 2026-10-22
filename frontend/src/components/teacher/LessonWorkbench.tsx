import React, { useState } from 'react';
import { TaskManager } from './TaskManager';
import { LectureManager } from './LectureManager';

type Tab = 'tasks' | 'lectures';

/**
 * 「备课工作台」外壳：课堂任务 + AI 讲堂两个页签。
 *
 * 为什么不把 AI 讲堂做成独立菜单项（原本推荐那样）：
 * 老师明确要求「在备课工作台增加一个 AI 讲堂」，两个功能同属课前准备，
 * 放在一起比多一个顶级菜单更顺手；页签也便于将来继续加（题库精选、试卷讲评等）。
 *
 * ⛔ 两个页签的内容用 CSS 隐藏而不是条件卸载：
 *    TaskManager 内部有编辑面板、模态框、已填表单等一堆本地状态，
 *    切走再切回若被卸载，老师填了一半的任务就没了。
 */
export const LessonWorkbench: React.FC = () => {
  // 默认落在 AI 讲堂（老师主要用它讲课投屏）；课堂任务仍是第二个页签
  const [tab, setTab] = useState<Tab>('lectures');

  const tabCls = (active: boolean) =>
    `flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
      active ? 'bg-white text-violet-700 shadow-sm ring-1 ring-violet-200' : 'text-gray-600 hover:bg-white/60 hover:text-gray-800'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex shrink-0 items-center gap-2 rounded-xl bg-gray-100 p-1">
        <button onClick={() => setTab('tasks')} className={tabCls(tab === 'tasks')}>
          <i className="fa-solid fa-clipboard-list"></i>课堂任务
        </button>
        <button onClick={() => setTab('lectures')} className={tabCls(tab === 'lectures')}>
          <i className="fa-solid fa-chalkboard-user"></i>AI 讲堂
        </button>
      </div>

      <div className={`min-h-0 flex-1 ${tab === 'tasks' ? '' : 'hidden'}`}>
        <TaskManager />
      </div>
      <div className={`min-h-0 flex-1 ${tab === 'lectures' ? '' : 'hidden'}`}>
        {/* AI 讲堂自己带滚动容器，这里不再套 padding */}
        <LectureManager />
      </div>
    </div>
  );
};

export default LessonWorkbench;
