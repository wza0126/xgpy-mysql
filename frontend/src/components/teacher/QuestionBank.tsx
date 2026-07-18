import React from 'react';
import { QuestionManager } from './QuestionManager';

export const QuestionBank: React.FC = () => {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">题库管理</h2>
      <QuestionManager />
    </div>
  );
};
