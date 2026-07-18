import React, { useState, useEffect } from 'react';
import { backendClient } from '../../api/backendClient';

interface KnowledgeBaseItem {
  id: string;
  question: string;
  answer: string;
  hit_count: number;
  created_at: string;
  updated_at: string | null;
  creator_name?: string;
}

export const KnowledgeBaseManager: React.FC = () => {
  const [items, setItems] = useState<KnowledgeBaseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;
  
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeBaseItem | null>(null);
  const [formData, setFormData] = useState({ question: '', answer: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchList();
  }, [page, keyword]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await backendClient.get('/api/ai-qa-kb/list', {
        limit: pageSize,
        offset: page * pageSize,
        keyword
      });
      if (res.data) {
        setItems(res.data.list || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('获取答疑库失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(0);
    fetchList();
  };

  const handleAdd = () => {
    setEditingItem(null);
    setFormData({ question: '', answer: '' });
    setShowModal(true);
  };

  const handleEdit = (item: KnowledgeBaseItem) => {
    setEditingItem(item);
    setFormData({ question: item.question, answer: item.answer });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.question.trim() || !formData.answer.trim()) {
      alert('问题和回答不能为空');
      return;
    }
    
    setSaving(true);
    try {
      if (editingItem) {
        await backendClient.put(`/api/ai-qa-kb/${editingItem.id}`, formData);
      } else {
        await backendClient.post('/api/ai-qa-kb', formData);
      }
      setShowModal(false);
      fetchList();
    } catch (err: any) {
      alert(err.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条答疑记录吗？')) return;
    try {
      await backendClient.delete(`/api/ai-qa-kb/${id}`);
      fetchList();
    } catch (err) {
      console.error('删除失败:', err);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">答疑库管理</h1>
          <p className="text-gray-500 mt-1">管理AI答疑知识库，已收录 {total} 条问答</p>
        </div>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center gap-2"
        >
          <i className="fa-solid fa-plus"></i>
          添加问答
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex gap-4">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索问题或回答..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          <button
            onClick={handleSearch}
            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg"
          >
            <i className="fa-solid fa-search mr-2"></i>
            搜索
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">问题</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">回答</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-24">命中次数</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-24">创建者</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-28">创建时间</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-28">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    加载中...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    暂无数据
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-800 line-clamp-2">{item.question}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-600 line-clamp-2">{item.answer}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {item.hit_count}次
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">
                      {item.creator_name || '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-500">
                      {new Date(item.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleEdit(item)}
                          className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"
                          title="编辑"
                        >
                          <i className="fa-solid fa-edit"></i>
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                          title="删除"
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              共 {total} 条，第 {page + 1}/{totalPages} 页
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 模态框 */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl mx-4">
            <h2 className="text-xl font-bold text-gray-800 mb-4">
              {editingItem ? '编辑问答' : '添加问答'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">问题</label>
                <textarea
                  value={formData.question}
                  onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                  placeholder="输入问题内容..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">回答</label>
                <textarea
                  value={formData.answer}
                  onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                  rows={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                  placeholder="输入回答内容..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
