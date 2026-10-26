import React, { useState } from 'react';
import { QuestionManager } from './QuestionManager';
import { CompositeManager } from './CompositeManager';

/**
 * 题库管理（2026-10-26 分两个入口）
 *
 * 综合题是「一段材料 + 4~6 个小题」的大题，和单选/填空不是一类东西：
 * 混在同一张表里翻列表、按整题算掌握都不合适。所以拆成两个页签：
 *   ① 选题 —— 单选 / 填空（单题练习池的来源）
 *   ② 综合题 —— 只看综合题，并能控制学生端「综合题练习」能不能练到它
 */
export const QuestionBank: React.FC = () => {
  const [tab, setTab] = useState<'single' | 'composite'>('single');

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-800">题库管理</h2>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          <button
            onClick={() => setTab('single')}
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
              tab === 'single' ? 'bg-white font-medium text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <i className="fa-solid fa-list-check mr-1.5"></i>选题（选择 / 填空）
          </button>
          <button
            onClick={() => setTab('composite')}
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
              tab === 'composite' ? 'bg-white font-medium text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <i className="fa-solid fa-layer-group mr-1.5"></i>综合题
          </button>
        </div>
      </div>

      {tab === 'single' ? <QuestionManager /> : <CompositeManager />}
    </div>
  );
};
