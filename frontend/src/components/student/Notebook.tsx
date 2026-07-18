import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Note } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { toDatabaseDateTime } from '../../utils/dateUtils';

export const Notebook: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [content, setContent] = useState('');
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();

  useEffect(() => {
    if (profile) {
      fetchNotes();
    }
  }, [profile]);

  const fetchNotes = async () => {
    if (!profile) return;
    const { data } = await backendClient
      .from('notes')
      .select('*')
      .eq('student_id', profile.id)
      .order('updated_at', { ascending: false });
    if (data) {
      setNotes(data as Note[]);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!profile || !content.trim()) return;

    if (editingNote) {
      await backendClient
        .from('notes')
        .update({ content, updated_at: toDatabaseDateTime(new Date()) })
        .eq('id', editingNote.id);
    } else {
      await backendClient.from('notes').insert({
        student_id: profile.id,
        content,
      });
    }

    setContent('');
    setEditingNote(null);
    fetchNotes();
  };

  const handleEdit = (note: Note) => {
    setEditingNote(note);
    setContent(note.content || '');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条笔记吗？删除后无法恢复。')) {
      return;
    }
    await backendClient.from('notes').delete().eq('id', id);
    fetchNotes();
  };

  const handleCancel = () => {
    setContent('');
    setEditingNote(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <div className="p-6 h-full">
      <div className="grid grid-cols-3 gap-6 h-full">
        <div className="col-span-2 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="font-bold text-gray-800 mb-4">
              {editingNote ? '编辑笔记' : '新建笔记'}
            </h3>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="记录学习笔记、易错知识点、解题思路,保存重要信息..."
              className="w-full h-80 p-4 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              {editingNote && (
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  取消
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={!content.trim()}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <i className="fa-solid fa-save"></i>
                {editingNote ? '更新' : '保存'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 overflow-y-auto">
          <h3 className="font-bold text-gray-800 mb-4">我的笔记</h3>
          {notes.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <i className="fa-solid fa-note-sticky text-3xl mb-2"></i>
              <p>暂无笔记</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <motion.div
                  key={note.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-lg p-3 shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
                >
                  <p className="text-gray-700 text-sm line-clamp-3 mb-2">{note.content}</p>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{new Date(note.updated_at || '').toLocaleDateString()}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(note)}
                        className="text-blue-500 hover:text-blue-600"
                      >
                        <i className="fa-solid fa-edit"></i>
                      </button>
                      <button
                        onClick={() => handleDelete(note.id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
