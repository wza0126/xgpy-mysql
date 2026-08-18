import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient, defaultApiKey } from '../../api/backendClient';
import { Question, KnowledgePoint } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { RichTextEditor } from '../common/RichTextEditor';
import { sanitizeHtml, htmlToPlainText, plainTextToHtml, uploadImagesFromHtml } from '../../utils/htmlUtils';

const parseJsonField = (field: any) => {
  if (typeof field === 'string') {
    try {
      return JSON.parse(field);
    } catch {
      return field;
    }
  }
  return field;
};

const getOptions = (options: any) => {
  const parsed = parseJsonField(options);
  return parsed?.options || parsed;
};

const getAnswers = (answers: any) => {
  const parsed = parseJsonField(answers);
  return parsed?.answers || parsed;
};

const parseTags = (tags: any): string[] => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    }
  }
  return [];
};

interface FilterState {
  type: string;
  knowledgePointId: string;
  tags: string[];
  searchText: string;
  practiceEnabled: '' | 'enabled' | 'disabled';
  examEnabled: '' | 'enabled' | 'disabled';
}

interface QuestionAccuracy {
  question_id: string;
  total_count: number;
  correct_count: number;
  accuracy: number;
}

type QuestionFormData = {
  type: 'choice' | 'fill_blank' | 'composite';
  content: string;
  options: string[];
  answers: string[];
  explanation: string;
  knowledge_point_id: string;
  practice_enabled: boolean;
  exam_enabled: boolean;
  tags: string;
};

interface AIFormData {
  type: 'choice' | 'fill_blank';
  customPrompt: string;
  api_key: string;
}

export const QuestionManager: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [filteredQuestions, setFilteredQuestions] = useState<Question[]>([]);
  const [knowledgePoints, setKnowledgePoints] = useState<KnowledgePoint[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiConfig, setAiConfig] = useState<Record<string, any>>({});
  const [showModal, setShowModal] = useState(false);
  const [showBatchTagModal, setShowBatchTagModal] = useState(false);
  const [showBatchKnowledgeModal, setShowBatchKnowledgeModal] = useState(false);
  const [batchKnowledgeId, setBatchKnowledgeId] = useState('');
  const [showAIGenerateModal, setShowAIGenerateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importTab, setImportTab] = useState<'text' | 'rich'>('text');
  const [richImportHtml, setRichImportHtml] = useState('');
  const [parsedQuestions, setParsedQuestions] = useState<any[]>([]);
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [editingKnowledge, setEditingKnowledge] = useState<KnowledgePoint | null>(null);
  const [knowledgeFormData, setKnowledgeFormData] = useState({
    title: '',
    description: '',
    order_index: 0,
  });
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [compositeSubQuestions, setCompositeSubQuestions] = useState<any[]>([]);
  const [editingSubQuestion, setEditingSubQuestion] = useState<number | null>(null);
  const [subQuestionForm, setSubQuestionForm] = useState({
    index: 1,
    type: 'choice' as 'choice' | 'fill_blank',
    content: '',
    options: ['', '', '', ''],
    answers: [''],
    score: 2,
    multiple: false,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchTagAction, setBatchTagAction] = useState<'add' | 'remove'>('add');
  const [batchTagInput, setBatchTagInput] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [filters, setFilters] = useState<FilterState>({
    type: '',
    knowledgePointId: '',
    tags: [],
    searchText: '',
    practiceEnabled: '',
    examEnabled: '',
  });
  const [searchInput, setSearchInput] = useState('');
  const [tagFilterEnabled, setTagFilterEnabled] = useState(false);
  const [showAccuracy, setShowAccuracy] = useState(false);
  const [questionAccuracy, setQuestionAccuracy] = useState<Record<string, QuestionAccuracy>>({});
  const [accuracySort, setAccuracySort] = useState<'none' | 'asc' | 'desc'>('none');
  const [sortConfig, setSortConfig] = useState<{
    key: 'type' | 'knowledgePoint' | 'tags' | 'practice' | 'exam' | null;
    direction: 'asc' | 'desc';
  }>({ key: null, direction: 'asc' });
  const [formData, setFormData] = useState<QuestionFormData>({
    type: 'choice',
    content: '',
    options: ['', '', '', ''],
    answers: [''],
    explanation: '',
    knowledge_point_id: '',
    practice_enabled: true,
    exam_enabled: false,
    tags: '',
  });
  const [aiFormData, setAiFormData] = useState<AIFormData>({
    type: 'choice',
    customPrompt: '',
    api_key: '',
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
  // AI 聚类相关状态
  const [showClusterModal, setShowClusterModal] = useState(false);
  const [clustering, setClustering] = useState(false);
  const [clusterResult, setClusterResult] = useState<any>(null);
  const [clusterStats, setClusterStats] = useState<{ total: number; clustered: number; unclustered: number; clusters: { cluster_id: string; cnt: number }[] } | null>(null);
  const { profile } = useAuth();

  useEffect(() => {
    fetchData();
    fetchClusterStats();
  }, []);

  useEffect(() => {
    if (showAccuracy) {
      fetchAccuracyData();
    }
  }, [showAccuracy]);

  useEffect(() => {
    applyFilters();
  }, [questions, filters]);

  const fetchData = async () => {
    const [{ data: questionsData }, { data: pointsData }, { data: configData }] = await Promise.all([
      backendClient.from('questions').select('*').order('created_at', { ascending: false }),
      backendClient.from('knowledge_points').select('*').order('order_index', { ascending: true }),
      backendClient.from('system_config').select('*'),
    ]);

    if (questionsData) {
      setQuestions(questionsData as Question[]);
      const tagsSet = new Set<string>();
      questionsData.forEach((q: Question) => {
        parseTags(q.tags).forEach((tag) => tagsSet.add(tag));
      });
      setAllTags(Array.from(tagsSet).sort());
    }
    if (pointsData) setKnowledgePoints(pointsData as KnowledgePoint[]);
    
    if (configData) {
      const configMap: Record<string, any> = {};
      configData.forEach((item) => {
        configMap[item.key] = (item.value as any).value;
      });
      setAiConfig(configMap);
    }
    
    setLoading(false);
  };

  const fetchAccuracyData = async () => {
    const { data: answersData } = await backendClient
      .from('student_answers')
      .select('question_id, is_correct');

    if (answersData) {
      const accuracyMap: Record<string, { total: number; correct: number }> = {};
      answersData.forEach((record: { question_id: string | null; is_correct: boolean }) => {
        if (!record.question_id) return;
        if (!accuracyMap[record.question_id]) {
          accuracyMap[record.question_id] = { total: 0, correct: 0 };
        }
        accuracyMap[record.question_id].total++;
        if (record.is_correct) {
          accuracyMap[record.question_id].correct++;
        }
      });

      const accuracyResult: Record<string, QuestionAccuracy> = {};
      Object.entries(accuracyMap).forEach(([questionId, stats]) => {
        accuracyResult[questionId] = {
          question_id: questionId,
          total_count: stats.total,
          correct_count: stats.correct,
          accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
        };
      });
      setQuestionAccuracy(accuracyResult);
    }
  };

  const applyFilters = () => {
    let result = [...questions];

    if (filters.type) {
      result = result.filter((q) => q.type === filters.type);
    }

    if (filters.knowledgePointId) {
      result = result.filter((q) => q.knowledge_point_id === filters.knowledgePointId);
    }

    if (tagFilterEnabled && filters.tags.length > 0) {
      result = result.filter((q) => filters.tags.some((tag) => parseTags(q.tags).includes(tag)));
    }

    if (filters.practiceEnabled) {
      result = result.filter((q) =>
        filters.practiceEnabled === 'enabled' ? q.practice_enabled : !q.practice_enabled
      );
    }

    if (filters.examEnabled) {
      result = result.filter((q) =>
        filters.examEnabled === 'enabled' ? q.exam_enabled : !q.exam_enabled
      );
    }

    if (filters.searchText) {
      const search = filters.searchText.toLowerCase();
      result = result.filter(
        (q) =>
          htmlToPlainText(q.content).toLowerCase().includes(search) ||
          htmlToPlainText(q.explanation || '').toLowerCase().includes(search) ||
          parseTags(q.tags).some((tag) => tag.toLowerCase().includes(search))
      );
    }

    setFilteredQuestions(result);
  };

  const handleSave = async () => {
    if (!profile) return;

    const cleanContent = sanitizeHtml(formData.content);
    const cleanOptions = formData.options.map(opt => sanitizeHtml(opt));
    const cleanExplanation = sanitizeHtml(formData.explanation);

    const answersData = formData.type === 'composite'
      ? formData.answers[0] || JSON.stringify([])
      : { answers: formData.answers.filter(Boolean) };
    
    const data = {
      type: formData.type,
      content: cleanContent,
      options: formData.type === 'choice' ? { options: cleanOptions.filter(o => htmlToPlainText(o).trim() !== '') } : null,
      answers: answersData,
      explanation: cleanExplanation,
      knowledge_point_id: formData.knowledge_point_id || null,
      practice_enabled: formData.practice_enabled,
      exam_enabled: formData.exam_enabled,
      tags: formData.tags ? formData.tags.split(',').map((t) => t.trim()) : [],
      created_by: profile.id,
    };

    if (editingQuestion) {
      await backendClient.from('questions').update(data).eq('id', editingQuestion.id);
    } else {
      await backendClient.from('questions').insert(data);
    }

    setShowModal(false);
    setEditingQuestion(null);
    resetForm();
    fetchData();
  };

  const handleDelete = async () => {
    const ids = deleteTargetId ? [deleteTargetId] : deleteTargetIds;
    if (ids.length === 0) return;

    try {
      for (const id of ids) {
        const { error } = await backendClient.from('questions').delete().eq('id', id);
        if (error) {
          console.error(`删除题目 ${id} 失败:`, error);
        }
      }
      setSelectedIds([]);
      setDeleteTargetId(null);
      setDeleteTargetIds([]);
      setShowDeleteConfirm(false);
      fetchData();
    } catch (error) {
      console.error('删除失败:', error);
      alert('删除失败: ' + (error as Error).message);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`确定要删除选中的 ${selectedIds.length} 道题吗？此操作不可恢复！`)) return;

    try {
      const batchSize = 50;
      for (let i = 0; i < selectedIds.length; i += batchSize) {
        const batch = selectedIds.slice(i, i + batchSize);
        const { error } = await backendClient.from('questions').delete().in('id', batch);
        if (error) {
          console.error('批量删除失败:', error);
          alert('删除失败: ' + error.message);
          return;
        }
      }
      setSelectedIds([]);
      fetchData();
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('删除失败: ' + (error as Error).message);
    }
  };

  const handleBatchUpdate = async (field: 'practice_enabled' | 'exam_enabled', value: boolean) => {
    if (selectedIds.length === 0) return;

    const batchSize = 50;
    for (let i = 0; i < selectedIds.length; i += batchSize) {
      const batch = selectedIds.slice(i, i + batchSize);
      const { error } = await backendClient.from('questions').update({ [field]: value }).in('id', batch);
      if (error) {
        console.error('批量更新失败:', error);
        alert('批量更新失败: ' + error.message);
        return;
      }
    }

    setSelectedIds([]);
    fetchData();
  };

  const handleBatchTagOperation = async () => {
    if (selectedIds.length === 0 || !batchTagInput.trim()) return;

    const tagsToProcess = batchTagInput.split(',').map((t) => t.trim()).filter(Boolean);
    const questionsToUpdate = questions.filter((q) => selectedIds.includes(q.id));

    const batchSize = 20;
    for (let i = 0; i < questionsToUpdate.length; i += batchSize) {
      const batch = questionsToUpdate.slice(i, i + batchSize);
      const updates = batch.map((question) => {
        const currentTags = parseTags(question.tags);
        let newTags: string[];
        if (batchTagAction === 'add') {
          newTags = Array.from(new Set([...currentTags, ...tagsToProcess]));
        } else {
          newTags = currentTags.filter((tag: string) => !tagsToProcess.includes(tag));
        }
        return backendClient.from('questions').update({ tags: newTags }).eq('id', question.id);
      });

      const results = await Promise.all(updates);
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) {
        console.error('批量标签操作失败:', errors);
        alert('批量标签操作失败');
        return;
      }
    }

    setShowBatchTagModal(false);
    setBatchTagInput('');
    setSelectedIds([]);
    fetchData();
  };

  // AI 批量聚类：调用后端 /api/teacher/questions/cluster
  // 支持两种模式：聚类选中题 / 聚类全部题（可按 type/tag 过滤）
  const handleAiCluster = async (mode: 'selected' | 'all') => {
    if (mode === 'selected' && selectedIds.length === 0) {
      alert('请先选择要聚类的题目');
      return;
    }
    if (!window.confirm(
      mode === 'selected'
        ? `确认为选中的 ${selectedIds.length} 道题执行 AI 聚类？每批 50 题，预计消耗少量 Token。`
        : '确认为题库中所有题目执行 AI 聚类？这可能需要 1~2 分钟，预计消耗约 0.2~0.3 元 Token。'
    )) return;

    setClustering(true);
    setClusterResult(null);
    try {
      const body = mode === 'selected'
        ? { questionIds: selectedIds }
        : { all: true, type: filters.type || undefined, tag: tagFilterEnabled ? (filters.tags[0] || undefined) : undefined };
      const result = await backendClient.post('/api/teacher/questions/cluster', body);
      if (result.error) throw new Error(result.error);
      setClusterResult(result.data);
      // 聚类后刷新题库和统计
      await fetchData();
      await fetchClusterStats();
      // 清空选择
      if (mode === 'selected') setSelectedIds([]);
    } catch (e: any) {
      alert('AI 聚类失败: ' + (e.message || e));
    } finally {
      setClustering(false);
    }
  };

  // 拉取聚类统计
  const fetchClusterStats = async () => {
    try {
      const result = await backendClient.get('/api/teacher/questions/cluster-stats');
      if (!result.error && result.data) {
        setClusterStats(result.data);
      }
    } catch {
      // 静默失败
    }
  };

  const generateAIQuestions = async () => {
    if (!profile) return;

    if (!aiFormData.customPrompt.trim()) {
      alert('请在"额外要求"中填写出题要求');
      return;
    }

    setAiGenerating(true);
    setAiProgress('正在加载AI配置...');

    // 从服务器加载最新的AI配置
    setAiProgress('正在加载AI配置...');
    let apiBaseUrl = '';
    let apiKey = '';
    let model = 'deepseek-v4-flash';

    // 如果用户在弹窗中手动填写了API密钥，优先使用
    if (aiFormData.api_key.trim()) {
      apiKey = aiFormData.api_key.trim();
    }

    try {
      const { data: freshConfig } = await backendClient.from('system_config').select('*');
      if (freshConfig) {
        const configMap: Record<string, any> = {};
        freshConfig.forEach((item: any) => {
          configMap[item.key] = (item.value as any).value;
        });
        apiBaseUrl = configMap.ai_api_base_url || '';
        apiKey = apiKey || (configMap.ai_api_key || '');
        model = (configMap.ai_model || 'deepseek-v4-flash').toString().trim();
      }
    } catch (e) {
      console.warn('刷新AI配置失败，使用缓存配置:', e);
      apiBaseUrl = apiBaseUrl || (aiConfig.ai_api_base_url || '');
      apiKey = apiKey || (aiConfig.ai_api_key || '');
      model = model || (aiConfig.ai_model || 'deepseek-v4-flash');
    }

    // 清理URL中的非法字符（反引号、引号、空格等）
    apiBaseUrl = apiBaseUrl.replace(/[`'"'"'"'"\u2018\u2019\u201c\u201d\s]/g, '');
    // 清理末尾的斜杠
    apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');

    // 验证配置
    if (!apiBaseUrl) {
      alert('请先在系统设置中配置 AI API 地址（系统设置 → AI设置）');
      setAiProgress('');
      setAiGenerating(false);
      return;
    }

    if (!apiKey) {
      alert('AI API密钥未配置！请在下方"API密钥"输入框中填写您的DeepSeek API密钥，\n或前往 系统设置 → AI设置 中配置并保存。');
      setAiProgress('');
      setAiGenerating(false);
      return;
    }

    const apiUrl = `${apiBaseUrl}/chat/completions`;

    console.log('AI出题配置:', { apiBaseUrl, model, hasKey: !!apiKey, apiUrl });

    // 如果弹窗中输入了密钥，自动保存到系统配置中（下次不用再输入）
    if (aiFormData.api_key.trim()) {
      try {
        await backendClient.from('system_config').insert({
          id: 'config_ai_api_key',
          key: 'ai_api_key',
          value: { value: apiKey }
        });
        console.log('API密钥已自动保存到系统配置');
      } catch (e) {
        console.warn('自动保存API密钥失败:', e);
      }
    }
    // 如果URL变了，也自动保存
    if (apiBaseUrl) {
      try {
        await backendClient.from('system_config').insert({
          id: 'config_ai_api_base_url',
          key: 'ai_api_base_url',
          value: { value: apiBaseUrl }
        });
      } catch (e) {
        console.warn('自动保存API URL失败:', e);
      }
    }

    const systemPrompt = `你是一位专业的Python编程教育专家，擅长为江苏省高中生设计信息技术课程题目。
请严格按照用户的出题要求生成题目。`;

    const isChoice = aiFormData.type === 'choice';

    const userPrompt = `请生成题目，根据以下要求：

============================
【出题要求】
${aiFormData.customPrompt}
============================

请严格按照以下JSON格式返回，不要包含任何其他文字：
[
  {
    "content": "题目内容",
    "options": ${isChoice ? '["选项A", "选项B", "选项C", "选项D"]' : 'null'},
    "answers": ${isChoice ? '["A"]' : '["正确答案"]'},
    "explanation": "答案解析",
    "tags": ["标签1", "标签2"]
  }
]

重要要求：
1. 题目要符合江苏省高中信息技术课程标准
2. 选项要具有迷惑性，避免过于明显的答案
3. 解析要详细，说明为什么正确以及常见错误
4. 标签是固定的["py","ai出题"]
${isChoice ? `5. 对于选择题，answers字段必须填写选项字母（A、B、C或D），而不是选项内容
6. 例如：如果正确答案是第一个选项，answers应该填["A"]而不是["选项A的内容"]` : `5. 对于填空题，answers字段必须填写正确的答案内容，而不是选项字母
6. 例如：如果正确答案是"print()"，answers应该填["print()"]而不是["A"]`}`;

    try {
      // 使用本地变量（已从服务器加载）
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          model: model,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('AI API错误:', response.status, errorText);
        throw new Error(`AI请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      if (!content) {
        throw new Error('AI返回内容为空，请检查模型名称是否正确');
      }

      let generatedQuestions;
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          generatedQuestions = JSON.parse(jsonMatch[0]);
        } else {
          generatedQuestions = JSON.parse(content);
        }
      } catch (e) {
        throw new Error('解析AI返回结果失败');
      }

      if (!Array.isArray(generatedQuestions)) {
        throw new Error('AI返回格式不正确');
      }

      setAiProgress(`成功生成 ${generatedQuestions.length} 道题，正在保存...`);

      const insertData = generatedQuestions.map((q: any) => ({
        type: aiFormData.type,
        content: q.content,
        options: aiFormData.type === 'choice' ? { options: q.options || [] } : null,
        answers: { answers: Array.isArray(q.answers) ? q.answers : [q.answers] },
        explanation: q.explanation || '',
        knowledge_point_id: null,
        practice_enabled: true,
        exam_enabled: false,
        tags: q.tags || [],
        created_by: profile.id,
      }));

      const { error } = await backendClient.from('questions').insert(insertData);
      if (error) throw error;

      setAiProgress('保存成功！');
      setTimeout(() => {
        setShowAIGenerateModal(false);
        setAiGenerating(false);
        setAiProgress('');
        fetchData();
      }, 1000);
    } catch (error) {
      setAiProgress('生成失败：' + (error as Error).message);
      setTimeout(() => {
        setAiGenerating(false);
        setAiProgress('');
      }, 3000);
    }
  };

  const resetForm = () => {
    setFormData({
      type: 'choice',
      content: '',
      options: ['', '', '', ''],
      answers: [''],
      explanation: '',
      knowledge_point_id: '',
      practice_enabled: true,
      exam_enabled: false,
      tags: '',
    });
    setCompositeSubQuestions([]);
    setEditingSubQuestion(null);
  };

  const openEdit = (question: Question) => {
    setEditingQuestion(question);
    const opts = question.type === 'composite' ? ['', '', '', ''] : (getOptions(question.options) || ['', '', '', '']);
    let answersValue: string[] = question.type === 'composite' ? [''] : (getAnswers(question.answers) || ['']);
    
    if (question.type === 'composite') {
      const subQs = parseJsonField(question.answers);
      answersValue = Array.isArray(subQs) ? [JSON.stringify(subQs)] : [''];
    }
    
    setFormData({
      type: question.type,
      content: plainTextToHtml(question.content || ''),
      options: Array.isArray(opts) ? opts.map((opt: string) => plainTextToHtml(opt || '')) : ['', '', '', ''],
      answers: answersValue,
      explanation: plainTextToHtml(question.explanation || ''),
      knowledge_point_id: question.knowledge_point_id || '',
      practice_enabled: question.practice_enabled || false,
      exam_enabled: question.exam_enabled || false,
      tags: parseTags(question.tags).join(', ') || '',
    });
    
    if (question.type === 'composite') {
      const subQs = parseJsonField(question.answers);
      setCompositeSubQuestions(Array.isArray(subQs) ? subQs : []);
    } else {
      setCompositeSubQuestions([]);
    }
    
    setShowModal(true);
  };

  const addSubQuestion = () => {
    setSubQuestionForm({
      index: compositeSubQuestions.length + 1,
      type: 'choice',
      content: '',
      options: ['', '', '', ''],
      answers: ['A'],
      score: 2,
      multiple: false,
    });
    setEditingSubQuestion(compositeSubQuestions.length);
  };

  const normalizeBlankAnswers = (answers: any): any[] => {
    if (!Array.isArray(answers)) return [[]];
    if (answers.length === 0) return [[]];
    if (answers.some(item => Array.isArray(item))) {
      return answers.map(item => Array.isArray(item) ? item : item ? [item] : []);
    }
    return answers.map(item => item ? [item] : []);
  };

  const editSubQuestion = (index: number) => {
    const sq = compositeSubQuestions[index];
    const isFillBlank = sq.type === 'fill_blank';
    setSubQuestionForm({
      index: sq.index,
      type: sq.type || 'choice',
      content: sq.content || '',
      options: Array.isArray(sq.options) ? sq.options : ['', '', '', ''],
      answers: isFillBlank ? normalizeBlankAnswers(sq.answers) : (Array.isArray(sq.answers) ? sq.answers : ['']),
      score: sq.score || 2,
      multiple: sq.multiple || false,
    });
    setEditingSubQuestion(index);
  };

  const saveSubQuestion = () => {
    let updated: any[];
    if (editingSubQuestion !== null && editingSubQuestion < compositeSubQuestions.length) {
      updated = [...compositeSubQuestions];
      updated[editingSubQuestion] = { ...subQuestionForm };
    } else {
      updated = [...compositeSubQuestions, { ...subQuestionForm }];
    }
    setCompositeSubQuestions(updated);
    setEditingSubQuestion(null);
    setFormData({
      ...formData,
      answers: [JSON.stringify(updated)],
    });
  };

  const deleteSubQuestion = (index: number) => {
    const updated = compositeSubQuestions.filter((_, i) => i !== index);
    const renumbered = updated.map((sq, i) => ({ ...sq, index: i + 1 }));
    setCompositeSubQuestions(renumbered);
    setFormData({
      ...formData,
      answers: [JSON.stringify(renumbered)],
    });
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleTagFilter = (tag: string) => {
    if (!tagFilterEnabled) {
      setTagFilterEnabled(true);
    }
    setFilters((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
    }));
  };

  const toggleTagFilterEnabled = () => {
    setTagFilterEnabled((prev) => !prev);
  };

  const clearFilters = () => {
    setFilters({
      type: '',
      knowledgePointId: '',
      tags: [],
      searchText: '',
      practiceEnabled: '',
      examEnabled: '',
    });
    setSearchInput('');
    setTagFilterEnabled(false);
  };

  const hasActiveFilters = useMemo(() => {
    return !!(filters.type || filters.knowledgePointId || tagFilterEnabled || filters.searchText || filters.practiceEnabled || filters.examEnabled);
  }, [filters, tagFilterEnabled]);

  const displayQuestions = useMemo(() => {
    if (!hasActiveFilters) {
      return [];
    }

    let result = filteredQuestions;

    if (showAccuracy && accuracySort !== 'none') {
      result = [...result].sort((a, b) => {
        const accuracyA = questionAccuracy[a.id]?.accuracy ?? -1;
        const accuracyB = questionAccuracy[b.id]?.accuracy ?? -1;
        if (accuracyA === -1 && accuracyB === -1) return 0;
        if (accuracyA === -1) return accuracySort === 'asc' ? -1 : 1;
        if (accuracyB === -1) return accuracySort === 'asc' ? 1 : -1;
        return accuracySort === 'asc' ? accuracyA - accuracyB : accuracyB - accuracyA;
      });
    } else if (sortConfig.key) {
      result = [...result].sort((a, b) => {
        let comparison = 0;
        switch (sortConfig.key) {
          case 'type':
            comparison = a.type.localeCompare(b.type);
            break;
          case 'knowledgePoint':
            const kpA = knowledgePoints.find((p) => p.id === a.knowledge_point_id)?.title || '';
            const kpB = knowledgePoints.find((p) => p.id === b.knowledge_point_id)?.title || '';
            comparison = kpA.localeCompare(kpB);
            break;
          case 'tags':
            const tagsA = parseTags(a.tags).join(',');
            const tagsB = parseTags(b.tags).join(',');
            comparison = tagsA.localeCompare(tagsB);
            break;
          case 'practice':
            comparison = (a.practice_enabled ? 1 : 0) - (b.practice_enabled ? 1 : 0);
            break;
          case 'exam':
            comparison = (a.exam_enabled ? 1 : 0) - (b.exam_enabled ? 1 : 0);
            break;
        }
        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [filteredQuestions, questions, filters, showAccuracy, accuracySort, questionAccuracy, sortConfig, knowledgePoints]);

  const handleExport = () => {
    const dataToExport = selectedIds.length > 0
      ? questions.filter((q) => selectedIds.includes(q.id))
      : questions;

    const exportData = dataToExport.map((q) => ({
      type: q.type,
      content: q.content,
      options: q.type === 'choice' ? getOptions(q.options) : [],
      answers: getAnswers(q.answers) || [],
      explanation: q.explanation || '',
      knowledge_point_id: q.knowledge_point_id || '',
      knowledge_point_title: knowledgePoints.find((p) => p.id === q.knowledge_point_id)?.title || '',
      practice_enabled: q.practice_enabled,
      exam_enabled: q.exam_enabled,
      tags: q.tags || [],
    }));

    const jsonContent = JSON.stringify(exportData, null, 2);

    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `题库导出_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const parseRichTextQuestions = (html: string): any[] => {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    const questions: any[] = [];
    let currentQuestion: any = null;
    let currentOptionIndex = -1;
    
    const children = Array.from(temp.children);
    
    for (const child of children) {
      const text = child.textContent?.trim() || '';
      const innerHtml = child.innerHTML;
      
      const questionNumMatch = text.match(/^(\d+)[\.、\s]/);
      const optionLetterMatch = text.match(/^([A-Z])[\.、\s]/i);
      const answerMatch = text.match(/^答案[:：\s]/i);
      const analysisMatch = text.match(/^(解析|答案解析)[:：\s]/i);
      
      if (questionNumMatch) {
        if (currentQuestion) {
          questions.push(currentQuestion);
        }
        const cleanHtml = innerHtml.replace(/^\d+[\.、\s]/, '').trim();
        currentQuestion = {
          type: 'choice',
          content: `<p>${cleanHtml}</p>`,
          options: [],
          answers: [],
          explanation: '',
        };
        currentOptionIndex = -1;
      } else if (optionLetterMatch && currentQuestion) {
        currentOptionIndex++;
        const cleanHtml = innerHtml.replace(/^[A-Z][\.、\s]/i, '').trim();
        currentQuestion.options.push(`<p>${cleanHtml}</p>`);
      } else if (answerMatch && currentQuestion) {
        const answerText = text.replace(/^答案[:：\s]/i, '').trim();
        const answers = answerText.split(/[，,、\s]+/).filter(Boolean);
        currentQuestion.answers = answers;
      } else if (analysisMatch && currentQuestion) {
        const cleanHtml = innerHtml.replace(/^(解析|答案解析)[:：\s]/i, '').trim();
        currentQuestion.explanation = `<p>${cleanHtml}</p>`;
      } else if (currentQuestion) {
        if (currentOptionIndex >= 0) {
          currentQuestion.options[currentOptionIndex] += innerHtml;
        } else if (currentQuestion.explanation) {
          currentQuestion.explanation += innerHtml;
        } else {
          currentQuestion.content += innerHtml;
        }
      }
    }
    
    if (currentQuestion) {
      questions.push(currentQuestion);
    }
    
    return questions.map(q => ({
      ...q,
      options: q.options.length > 0 ? q.options : ['', '', '', ''],
    }));
  };

  const handleRichTextParse = () => {
    if (!richImportHtml.trim()) {
      setParsedQuestions([]);
      return;
    }
    const parsed = parseRichTextQuestions(richImportHtml);
    setParsedQuestions(parsed);
  };

  const handleRichImport = async () => {
    if (parsedQuestions.length === 0 || !profile) return;

    setImporting(true);
    setImportProgress(`正在导入 ${parsedQuestions.length} 道题...`);

    try {
      const questionsWithImages = [];
      for (let i = 0; i < parsedQuestions.length; i++) {
        setImportProgress(`正在处理第 ${i + 1}/${parsedQuestions.length} 道题的图片...`);
        const q = parsedQuestions[i];
        const cleanContent = await uploadImagesFromHtml(q.content, 'content');
        const cleanOptions = await Promise.all(
          q.options.map((opt: string) => uploadImagesFromHtml(opt, 'options'))
        );
        const cleanExplanation = q.explanation ? await uploadImagesFromHtml(q.explanation, 'explanation') : '';
        questionsWithImages.push({
          ...q,
          content: sanitizeHtml(cleanContent),
          options: cleanOptions,
          explanation: sanitizeHtml(cleanExplanation),
        });
      }

      setImportProgress(`正在导入 ${questionsWithImages.length} 道题...`);

      for (let i = 0; i < questionsWithImages.length; i++) {
        const q = questionsWithImages[i];
        const data = {
          type: q.type || 'choice',
          content: q.content,
          options: q.type === 'choice' ? { options: q.options.filter((o: string) => htmlToPlainText(o).trim() !== '') } : null,
          answers: { answers: q.answers || [] },
          explanation: q.explanation || '',
          knowledge_point_id: null,
          practice_enabled: true,
          exam_enabled: false,
          tags: ['图文导入'],
          created_by: profile.id,
        };
        await backendClient.from('questions').insert(data);
        setImportProgress(`已导入 ${i + 1}/${questionsWithImages.length} 道题`);
      }

      setImportProgress('导入成功！');
      setTimeout(() => {
        setShowImportModal(false);
        setImporting(false);
        setRichImportHtml('');
        setParsedQuestions([]);
        fetchData();
      }, 1000);
    } catch (error) {
      console.error('导入失败:', error);
      setImportProgress('导入失败：' + (error as Error).message);
      setTimeout(() => setImporting(false), 2000);
    }
  };

  const handleImport = async () => {
    if (!importData.trim() || !profile) return;

    setImporting(true);
    setImportProgress('正在解析数据...');

    try {
      let questionsToInsert: any[] = [];

      let trimmedData = importData.trim();

      if (trimmedData.startsWith('[') || trimmedData.startsWith('{')) {
        let parsedData;
        try {
          parsedData = JSON.parse(trimmedData);
        } catch (jsonError) {
          const cleanData = trimmedData
            .replace(/\n/g, ' ')
            .replace(/\r/g, ' ')
            .replace(/\t/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          try {
            parsedData = JSON.parse(cleanData);
          } catch {
            throw new Error('JSON格式错误，请检查数据格式');
          }
        }
        const importQuestions = Array.isArray(parsedData) ? parsedData : [parsedData];

        questionsToInsert = importQuestions.map((q: any) => {
          const isValidKnowledgePointId = q.knowledge_point_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q.knowledge_point_id);

          const normalizedType = (() => {
            const t = String(q.type || '').toLowerCase();
            if (t === 'choice' || t === '选择题' || t === 'single') return 'choice';
            if (t === 'fill_blank' || t === '填空题' || t === 'blank') return 'fill_blank';
            if (t === 'composite' || t === '综合题' || t === 'mixed') return 'composite';
            return 'choice';
          })();

          const normalizedAnswers = (() => {
            if (q.answers) {
              return Array.isArray(q.answers) ? q.answers : [q.answers].filter(Boolean);
            }
            if (q.answer) {
              return Array.isArray(q.answer) ? q.answer : [q.answer].filter(Boolean);
            }
            return [];
          })();

          return {
            type: normalizedType,
            content: q.content,
            options: normalizedType === 'choice' ? { options: Array.isArray(q.options) ? q.options : [] } : null,
            answers: { answers: normalizedAnswers },
            explanation: q.explanation || '',
            knowledge_point_id: isValidKnowledgePointId ? q.knowledge_point_id : null,
            practice_enabled: q.practice_enabled === true || q.practice_enabled === '是',
            exam_enabled: q.exam_enabled === true || q.exam_enabled === '是',
            tags: parseTags(q.tags),
            created_by: profile.id,
          };
        }).filter((q: any) => q.content);
      } else {
        const lines = trimmedData.split('\n');
        const headers = lines[0].split(',').map((h) => h.trim());

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line.trim()) continue;

          const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

          const type = values[0] === '选择题' ? 'choice' : values[0] === '综合题' ? 'composite' : 'fill_blank';
          const content = values[1];
          const optionsStr = values[2] || '';
          const answersStr = values[3] || '';
          const explanation = values[4] || '';
          const knowledgePointId = values[5] || '';
          const practiceEnabled = values[7] === '是';
          const examEnabled = values[8] === '是';
          const tagsStr = values[9] || '';

          if (!content) continue;

          const isValidKnowledgePointId = knowledgePointId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(knowledgePointId);

          questionsToInsert.push({
            type,
            content,
            options: type === 'choice' ? { options: optionsStr.split('|||').filter(Boolean) } : null,
            answers: { answers: answersStr.split(',').map((a) => a.trim()).filter(Boolean) },
            explanation,
            knowledge_point_id: isValidKnowledgePointId ? knowledgePointId : null,
            practice_enabled: practiceEnabled,
            exam_enabled: examEnabled,
            tags: tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [],
            created_by: profile.id,
          });
        }
      }

      if (questionsToInsert.length === 0) {
        throw new Error('未找到有效数据');
      }

      setImportProgress(`正在导入 ${questionsToInsert.length} 道题...`);

      const { error } = await backendClient.from('questions').insert(questionsToInsert);
      if (error) throw error;

      setImportProgress('导入成功！');
      setTimeout(() => {
        setShowImportModal(false);
        setImportData('');
        setImporting(false);
        setImportProgress('');
        fetchData();
      }, 1000);
    } catch (error) {
      setImportProgress('导入失败：' + (error as Error).message);
      setTimeout(() => {
        setImporting(false);
        setImportProgress('');
      }, 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">题库管理</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            <i className="fa-solid fa-file-import mr-2"></i>
            批量导入
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            <i className="fa-solid fa-file-export mr-2"></i>
            导出{selectedIds.length > 0 ? `(${selectedIds.length})` : '全部'}
          </button>
          <button
            onClick={async () => {
              setShowAIGenerateModal(true);
              // 打开弹窗时自动加载已保存的API密钥
              try {
                const { data: cfg } = await backendClient.from('system_config').select('*').eq('key', 'ai_api_key');
                if (cfg && cfg.length > 0) {
                  const val = cfg[0].value;
                  const savedKey = typeof val === 'object' ? (val as any).value : val;
                  if (savedKey) {
                    setAiFormData(prev => ({ ...prev, api_key: savedKey }));
                  }
                }
              } catch (e) {
                // 静默失败
              }
            }}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
          >
            <i className="fa-solid fa-robot mr-2"></i>
            AI出题
          </button>
          <button
            onClick={() => {
              setEditingQuestion(null);
              resetForm();
              setShowModal(true);
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <i className="fa-solid fa-plus mr-2"></i>
            添加题目
          </button>
          <button
            onClick={() => {
              setShowClusterModal(true);
              fetchClusterStats();
            }}
            className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
            title="使用 AI 为题目自动分类知识点，便于学生端做错后推荐同类题"
          >
            <i className="fa-solid fa-layer-group mr-2"></i>
            AI聚类
          </button>
        </div>
      </div>

      {/* 聚类统计概览（仅在有聚类数据时显示） */}
      {clusterStats && clusterStats.clustered > 0 && (
        <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3 mb-4 text-sm text-cyan-800 flex items-center gap-4 flex-wrap">
          <i className="fa-solid fa-circle-info"></i>
          <span>已聚类 <b>{clusterStats.clustered}</b> / {clusterStats.total} 题</span>
          <span>剩余未聚类 <b>{clusterStats.unclustered}</b> 题</span>
          <span>聚类簇数 <b>{clusterStats.clusters.length}</b></span>
          {clusterStats.clusters.length > 0 && (
            <span className="text-xs">
              最大簇: {clusterStats.clusters[0].cluster_id} ({clusterStats.clusters[0].cnt}题)
            </span>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">类型：</span>
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">全部</option>
              <option value="choice">选择题</option>
              <option value="fill_blank">填空题</option>
              <option value="composite">综合题</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">知识点：</span>
            <select
              value={filters.knowledgePointId}
              onChange={(e) => setFilters({ ...filters, knowledgePointId: e.target.value })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm max-w-xs"
            >
              <option value="">全部</option>
              {knowledgePoints.map((point) => (
                <option key={point.id} value={point.id}>{point.title}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">练习：</span>
            <select
              value={filters.practiceEnabled}
              onChange={(e) => setFilters({ ...filters, practiceEnabled: e.target.value as '' | 'enabled' | 'disabled' })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">全部</option>
              <option value="enabled">启用</option>
              <option value="disabled">禁用</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">考试：</span>
            <select
              value={filters.examEnabled}
              onChange={(e) => setFilters({ ...filters, examEnabled: e.target.value as '' | 'enabled' | 'disabled' })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">全部</option>
              <option value="enabled">启用</option>
              <option value="disabled">禁用</option>
            </select>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <span className="text-sm text-gray-600">搜索：</span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setFilters({ ...filters, searchText: searchInput });
                }
              }}
              onBlur={() => setFilters({ ...filters, searchText: searchInput })}
              placeholder="输入关键字后回车搜索..."
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showAccuracy}
                onChange={(e) => {
                  setShowAccuracy(e.target.checked);
                  if (!e.target.checked) {
                    setAccuracySort('none');
                  }
                }}
                className="rounded"
              />
              <span className="text-sm text-gray-600">显示正确率</span>
            </label>
          </div>

          {(filters.type || filters.knowledgePointId || tagFilterEnabled || filters.searchText || filters.practiceEnabled || filters.examEnabled) && (
            <button
              onClick={clearFilters}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <i className="fa-solid fa-times mr-1"></i>
              清除筛选
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600">标签筛选：</span>
            <button
              onClick={toggleTagFilterEnabled}
              className={`px-2 py-1 rounded-full text-xs transition-colors ${
                tagFilterEnabled
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
            >
              全部标签
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTagFilter(tag)}
                className={`px-2 py-1 rounded-full text-xs transition-colors ${
                  tagFilterEnabled && filters.tags.includes(tag)
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-4 mb-4 flex items-center gap-4">
          <span className="text-blue-700">已选择 {selectedIds.length} 道题</span>
          <div className="flex gap-2">
            <button
              onClick={() => handleBatchUpdate('practice_enabled', true)}
              className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600 transition-colors"
            >
              启用练习
            </button>
            <button
              onClick={() => handleBatchUpdate('practice_enabled', false)}
              className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 transition-colors"
            >
              禁用练习
            </button>
            <button
              onClick={() => handleBatchUpdate('exam_enabled', true)}
              className="px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600 transition-colors"
            >
              启用考试
            </button>
            <button
              onClick={() => handleBatchUpdate('exam_enabled', false)}
              className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 transition-colors"
            >
              禁用考试
            </button>
            <button
              onClick={() => setShowBatchTagModal(true)}
              className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-colors"
            >
              <i className="fa-solid fa-tags mr-1"></i>
              批量标签
            </button>
            <button
              onClick={() => setShowBatchKnowledgeModal(true)}
              className="px-3 py-1 bg-indigo-500 text-white rounded text-sm hover:bg-indigo-600 transition-colors"
            >
              <i className="fa-solid fa-book mr-1"></i>
              批量知识点
            </button>
            <button
              onClick={() => handleAiCluster('selected')}
              disabled={clustering}
              className="px-3 py-1 bg-cyan-500 text-white rounded text-sm hover:bg-cyan-600 transition-colors disabled:opacity-50"
              title="使用 AI 为选中题自动分类知识点"
            >
              <i className="fa-solid fa-layer-group mr-1"></i>
              {clustering ? '聚类中...' : 'AI聚类选中'}
            </button>
            <button
              onClick={() => {
                setDeleteTargetIds(selectedIds);
                setDeleteTargetId(null);
                setShowDeleteConfirm(true);
              }}
              className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors"
            >
              <i className="fa-solid fa-trash mr-1"></i>
              批量删除
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.length === displayQuestions.length && displayQuestions.length > 0}
                  onChange={(e) => setSelectedIds(e.target.checked ? displayQuestions.map((q) => q.id) : [])}
                  className="rounded"
                  title="全选/取消全选"
                />
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">题目 {selectedIds.length > 0 && <span className="text-xs text-blue-500">(已选 {selectedIds.length} 道)</span>}</th>
              <th
                className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => {
                  if (sortConfig.key === 'type') {
                    setSortConfig({ key: 'type', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' });
                  } else {
                    setSortConfig({ key: 'type', direction: 'asc' });
                  }
                }}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>类型</span>
                  <span className="text-xs">
                    {sortConfig.key !== 'type' && <i className="fa-solid fa-sort text-gray-400"></i>}
                    {sortConfig.key === 'type' && sortConfig.direction === 'asc' && <i className="fa-solid fa-sort-up"></i>}
                    {sortConfig.key === 'type' && sortConfig.direction === 'desc' && <i className="fa-solid fa-sort-down"></i>}
                  </span>
                </div>
              </th>
              <th
                className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => {
                  if (sortConfig.key === 'knowledgePoint') {
                    setSortConfig({ key: 'knowledgePoint', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' });
                  } else {
                    setSortConfig({ key: 'knowledgePoint', direction: 'asc' });
                  }
                }}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>知识点</span>
                  <span className="text-xs">
                    {sortConfig.key !== 'knowledgePoint' && <i className="fa-solid fa-sort text-gray-400"></i>}
                    {sortConfig.key === 'knowledgePoint' && sortConfig.direction === 'asc' && <i className="fa-solid fa-sort-up"></i>}
                    {sortConfig.key === 'knowledgePoint' && sortConfig.direction === 'desc' && <i className="fa-solid fa-sort-down"></i>}
                  </span>
                </div>
              </th>
              <th
                className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => {
                  if (sortConfig.key === 'tags') {
                    setSortConfig({ key: 'tags', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' });
                  } else {
                    setSortConfig({ key: 'tags', direction: 'asc' });
                  }
                }}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>标签</span>
                  <span className="text-xs">
                    {sortConfig.key !== 'tags' && <i className="fa-solid fa-sort text-gray-400"></i>}
                    {sortConfig.key === 'tags' && sortConfig.direction === 'asc' && <i className="fa-solid fa-sort-up"></i>}
                    {sortConfig.key === 'tags' && sortConfig.direction === 'desc' && <i className="fa-solid fa-sort-down"></i>}
                  </span>
                </div>
              </th>
              {showAccuracy && (
                <th
                  className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => {
                    if (accuracySort === 'none') {
                      setAccuracySort('desc');
                    } else if (accuracySort === 'desc') {
                      setAccuracySort('asc');
                    } else {
                      setAccuracySort('none');
                    }
                  }}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>正确率</span>
                    <span className="text-xs">
                      {accuracySort === 'none' && <i className="fa-solid fa-sort text-gray-400"></i>}
                      {accuracySort === 'asc' && <i className="fa-solid fa-sort-up"></i>}
                      {accuracySort === 'desc' && <i className="fa-solid fa-sort-down"></i>}
                    </span>
                  </div>
                </th>
              )}
              <th
                className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => {
                  if (sortConfig.key === 'practice') {
                    setSortConfig({ key: 'practice', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' });
                  } else {
                    setSortConfig({ key: 'practice', direction: 'asc' });
                  }
                }}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>练习</span>
                  <span className="text-xs">
                    {sortConfig.key !== 'practice' && <i className="fa-solid fa-sort text-gray-400"></i>}
                    {sortConfig.key === 'practice' && sortConfig.direction === 'asc' && <i className="fa-solid fa-sort-up"></i>}
                    {sortConfig.key === 'practice' && sortConfig.direction === 'desc' && <i className="fa-solid fa-sort-down"></i>}
                  </span>
                </div>
              </th>
              <th
                className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => {
                  if (sortConfig.key === 'exam') {
                    setSortConfig({ key: 'exam', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' });
                  } else {
                    setSortConfig({ key: 'exam', direction: 'asc' });
                  }
                }}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>考试</span>
                  <span className="text-xs">
                    {sortConfig.key !== 'exam' && <i className="fa-solid fa-sort text-gray-400"></i>}
                    {sortConfig.key === 'exam' && sortConfig.direction === 'asc' && <i className="fa-solid fa-sort-up"></i>}
                    {sortConfig.key === 'exam' && sortConfig.direction === 'desc' && <i className="fa-solid fa-sort-down"></i>}
                  </span>
                </div>
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {displayQuestions.map((question) => {
              const accuracy = questionAccuracy[question.id];
              return (
                <tr key={question.id} className="hover:bg-gray-50" onClick={(e) => e.stopPropagation()}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(question.id)}
                      onChange={() => toggleSelection(question.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-800 max-w-md text-sm leading-relaxed">
                      <div className="line-clamp-3" dangerouslySetInnerHTML={{ __html: sanitizeHtml(question.content) }} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {knowledgePoints.find((p) => p.id === question.knowledge_point_id)?.title || '未分类'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        question.type === 'choice' ? 'bg-blue-100 text-blue-600' :
                        question.type === 'composite' ? 'bg-purple-100 text-purple-600' :
                        'bg-green-100 text-green-600'
                      }`}>
                        {question.type === 'choice' ? '选择题' :
                         question.type === 'composite' ? '综合题' : '填空题'}
                      </span>
                      {question.type === 'composite' && (() => {
                        try {
                          const subQs = JSON.parse(question.answers || '[]');
                          return <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                            {Array.isArray(subQs) ? subQs.length : 0}小题
                          </span>;
                        } catch {
                          return null;
                        }
                      })()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-1 bg-indigo-100 text-indigo-600 rounded-full text-xs">
                      {knowledgePoints.find((p) => p.id === question.knowledge_point_id)?.title || '未分类'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-wrap gap-1 justify-center">
                      {parseTags(question.tags).slice(0, 3).map((tag, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                          {tag}
                        </span>
                      ))}
                      {parseTags(question.tags).length > 3 && (
                        <span className="text-xs text-gray-400">+{parseTags(question.tags).length - 3}</span>
                      )}
                    </div>
                  </td>
                  {showAccuracy && (
                    <td className="px-4 py-3 text-center">
                      {accuracy ? (
                        <div className="flex flex-col items-center">
                          <span className={`text-sm font-medium ${
                            accuracy.accuracy >= 80 ? 'text-green-600' :
                            accuracy.accuracy >= 60 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {accuracy.accuracy}%
                          </span>
                          <span className="text-xs text-gray-400">
                            {accuracy.correct_count}/{accuracy.total_count}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      question.practice_enabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {question.practice_enabled ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      question.exam_enabled ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {question.exam_enabled ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => openEdit(question)}
                        className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                      >
                        <i className="fa-solid fa-edit"></i>
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeleteTargetId(question.id);
                          setDeleteTargetIds([]);
                          setShowDeleteConfirm(true);
                        }}
                        className="text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                        type="button"
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!hasActiveFilters && (
          <div className="text-center py-12 text-gray-500">
            <i className="fa-solid fa-filter text-4xl mb-3 text-gray-300"></i>
            <p>请选择筛选条件查看题目</p>
          </div>
        )}
        {hasActiveFilters && displayQuestions.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <i className="fa-solid fa-inbox text-4xl mb-3 text-gray-300"></i>
            <p>暂无符合条件的题目</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                {editingQuestion ? '编辑题目' : '添加题目'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">题目类型</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'choice' | 'fill_blank' | 'composite' })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  >
                    <option value="choice">选择题</option>
                    <option value="fill_blank">填空题</option>
                    <option value="composite">综合题</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">题干</label>
                  <RichTextEditor
                    value={formData.content}
                    onChange={(html) => setFormData({ ...formData, content: html })}
                    placeholder="请输入题目内容..."
                    imageType="content"
                    minHeight="120px"
                  />
                </div>

                {formData.type === 'choice' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">选项</label>
                    <div className="space-y-3">
                      {formData.options.map((opt, index) => (
                        <div key={index} className="flex items-start gap-2">
                          <span className="w-6 h-10 flex items-center justify-center text-sm font-medium text-gray-500 pt-3">
                            {String.fromCharCode(65 + index)}.
                          </span>
                          <div className="flex-1">
                            <RichTextEditor
                              value={opt}
                              onChange={(html) => {
                                const newOptions = [...formData.options];
                                newOptions[index] = html;
                                setFormData({ ...formData, options: newOptions });
                              }}
                              placeholder={`选项 ${String.fromCharCode(65 + index)}`}
                              imageType="options"
                              minHeight="60px"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {formData.type === 'composite' ? (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="block text-sm font-medium text-purple-700">
                        子题目列表（共 {compositeSubQuestions.length} 道，总分 {compositeSubQuestions.reduce((sum, sq) => sum + (sq.score || 0), 0)} 分）
                      </label>
                      <button
                        onClick={addSubQuestion}
                        className="px-3 py-1 bg-purple-500 text-white text-xs rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1"
                      >
                        <i className="fa-solid fa-plus"></i> 添加小题
                      </button>
                    </div>
                    
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {compositeSubQuestions.map((sq, idx) => (
                        <div key={idx} className="bg-white rounded-lg p-3 border border-purple-100">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">({sq.index})</span>
                              <span className={`px-2 py-0.5 rounded text-xs ${sq.type === 'choice' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                                {sq.type === 'choice' ? '选择题' : '填空题'}
                              </span>
                              <span className="text-xs text-gray-500">{sq.score}分</span>
                              {sq.multiple && <span className="px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded text-xs">多选</span>}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => editSubQuestion(idx)}
                                className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
                                title="编辑"
                              >
                                <i className="fa-solid fa-edit"></i>
                              </button>
                              <button
                                onClick={() => deleteSubQuestion(idx)}
                                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                title="删除"
                              >
                                <i className="fa-solid fa-trash"></i>
                              </button>
                            </div>
                          </div>
                          <div className="text-sm text-gray-700 line-clamp-2 mb-1" dangerouslySetInnerHTML={{ __html: sanitizeHtml(sq.content) }} />
                          {sq.type === 'choice' && Array.isArray(sq.options) && (
                            <div className="text-xs text-gray-500 mb-1">
                              选项: {sq.options.filter((o: string) => o).join(', ')}
                            </div>
                          )}
                          <div className="text-xs text-gray-600">
                            答案: {sq.type === 'fill_blank' 
                              ? (() => {
                                  const normalized = normalizeBlankAnswers(sq.answers);
                                  return normalized.map((ba: any[], i: number) => `第${i+1}空:${Array.isArray(ba) ? ba.join('/') : ba}`).join('; ');
                                })()
                              : (Array.isArray(sq.answers) ? sq.answers.join(', ') : sq.answers)}
                          </div>
                        </div>
                      ))}
                      {compositeSubQuestions.length === 0 && (
                        <div className="text-center py-6 text-gray-400">
                          <i className="fa-solid fa-list text-2xl mb-2"></i>
                          <p className="text-sm">暂无子题目，请点击上方按钮添加</p>
                        </div>
                      )}
                    </div>
                    
                    {editingSubQuestion !== null && (
                      <div className="mt-4 bg-white rounded-lg p-4 border-2 border-purple-300">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-medium text-purple-700">
                            {editingSubQuestion < compositeSubQuestions.length ? '编辑子题目' : '添加子题目'}
                          </h4>
                          <button
                            onClick={() => setEditingSubQuestion(null)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">小题序号</label>
                            <input
                              type="number"
                              value={subQuestionForm.index}
                              onChange={(e) => setSubQuestionForm({ ...subQuestionForm, index: parseInt(e.target.value) || 1 })}
                              className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">题型</label>
                            <select
                              value={subQuestionForm.type}
                              onChange={(e) => setSubQuestionForm({ ...subQuestionForm, type: e.target.value as 'choice' | 'fill_blank' })}
                              className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                            >
                              <option value="choice">选择题</option>
                              <option value="fill_blank">填空题</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">分值</label>
                            <input
                              type="number"
                              value={subQuestionForm.score}
                              onChange={(e) => setSubQuestionForm({ ...subQuestionForm, score: parseInt(e.target.value) || 2 })}
                              className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                            />
                          </div>
                          {subQuestionForm.type === 'choice' && (
                            <div className="flex items-end">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={subQuestionForm.multiple}
                                  onChange={(e) => setSubQuestionForm({ ...subQuestionForm, multiple: e.target.checked })}
                                  className="rounded"
                                />
                                <span className="text-xs text-gray-600">多选题</span>
                              </label>
                            </div>
                          )}
                        </div>
                        <div className="mt-3">
                          <label className="block text-xs font-medium text-gray-600 mb-1">题目内容</label>
                          <RichTextEditor
                            value={subQuestionForm.content}
                            onChange={(html) => setSubQuestionForm({ ...subQuestionForm, content: html })}
                            placeholder="输入小题内容..."
                            imageType="content"
                            minHeight="80px"
                          />
                        </div>
                        {subQuestionForm.type === 'choice' && (
                          <div className="mt-3">
                            <label className="block text-xs font-medium text-gray-600 mb-1">选项</label>
                            <div className="space-y-2">
                              {subQuestionForm.options.map((opt, oIdx) => (
                                <div key={oIdx} className="flex items-start gap-2">
                                  <span className="w-6 h-10 flex items-center justify-center text-sm font-medium text-gray-500 pt-3">
                                    {String.fromCharCode(65 + oIdx)}.
                                  </span>
                                  <div className="flex-1">
                                    <RichTextEditor
                                      value={opt}
                                      onChange={(html) => {
                                        const newOptions = [...subQuestionForm.options];
                                        newOptions[oIdx] = html;
                                        setSubQuestionForm({ ...subQuestionForm, options: newOptions });
                                      }}
                                      placeholder={`选项 ${String.fromCharCode(65 + oIdx)}`}
                                      imageType="options"
                                      minHeight="60px"
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {subQuestionForm.type === 'choice' && (
                          <div className="mt-3">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              正确答案 {subQuestionForm.multiple && '(多选答案用逗号分隔)'}
                            </label>
                            <input
                              type="text"
                              value={subQuestionForm.answers.join(', ')}
                              onChange={(e) => {
                                const val = e.target.value;
                                const parts = val.split(',');
                                const hasTrailingComma = val.endsWith(',');
                                const result = parts.map((s) => s.trim()).filter((s, i) => i < parts.length - 1 || hasTrailingComma || s);
                                setSubQuestionForm({ ...subQuestionForm, answers: result });
                              }}
                              className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                              placeholder={subQuestionForm.multiple ? 'A,B,C' : 'A'}
                            />
                          </div>
                        )}
                        {subQuestionForm.type === 'fill_blank' && (
                          <div className="mt-3">
                            <label className="block text-xs font-medium text-gray-600 mb-2">
                              填空题答案（每个空可设置多个正确答案，用 | 分隔）
                            </label>
                            <div className="space-y-2">
                              {(subQuestionForm.answers as any[]).map((blankAnswers: any, bIdx: number) => (
                                <div key={bIdx} className="flex items-start gap-2">
                                  <span className="w-16 h-9 flex items-center justify-center text-xs font-medium text-gray-500 bg-gray-100 rounded flex-shrink-0">
                                    第{bIdx + 1}空
                                  </span>
                                  <input
                                    type="text"
                                    value={Array.isArray(blankAnswers) ? blankAnswers.join(' | ') : blankAnswers || ''}
                                    onChange={(e) => {
                                      const newAnswers = [...(subQuestionForm.answers as any[])];
                                      const val = e.target.value;
                                      const parts = val.split('|');
                                      const hasTrailingPipe = val.endsWith('|');
                                      const parsed = parts.map((s) => s.trim()).filter((s, i) => i < parts.length - 1 || hasTrailingPipe || s);
                                      newAnswers[bIdx] = parsed.length > 0 ? parsed : [];
                                      setSubQuestionForm({ ...subQuestionForm, answers: newAnswers });
                                    }}
                                    className="flex-1 p-2 border border-gray-300 rounded-lg text-sm"
                                    placeholder="多个正确答案用 | 分隔，如：AI|人工智能"
                                  />
                                  <button
                                    onClick={() => {
                                      const newAnswers = [...(subQuestionForm.answers as any[])];
                                      newAnswers.splice(bIdx, 1);
                                      setSubQuestionForm({ ...subQuestionForm, answers: newAnswers });
                                    }}
                                    className="p-2 text-red-400 hover:text-red-600 transition-colors"
                                    title="删除此空"
                                  >
                                    <i className="fa-solid fa-minus-circle"></i>
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => {
                                setSubQuestionForm({
                                  ...subQuestionForm,
                                  answers: [...(subQuestionForm.answers as any[]), []]
                                });
                              }}
                              className="mt-2 text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
                            >
                              <i className="fa-solid fa-plus"></i> 添加一个空
                            </button>
                          </div>
                        )}
                        <div className="mt-3 flex justify-end">
                          <button
                            onClick={saveSubQuestion}
                            className="px-4 py-1.5 bg-purple-500 text-white text-sm rounded-lg hover:bg-purple-600 transition-colors"
                          >
                            保存子题目
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      正确答案 {formData.type === 'fill_blank' && '(多个答案用逗号分隔)'}
                    </label>
                    <input
                      type="text"
                      value={formData.answers.join(', ')}
                      onChange={(e) => setFormData({ ...formData, answers: e.target.value.split(',').map((s) => s.trim()) })}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                      placeholder="请输入正确答案"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">答案解析</label>
                  <RichTextEditor
                    value={formData.explanation}
                    onChange={(html) => setFormData({ ...formData, explanation: html })}
                    placeholder="请输入答案解析..."
                    imageType="explanation"
                    minHeight="80px"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">所属知识点</label>
                  <select
                    value={formData.knowledge_point_id}
                    onChange={(e) => setFormData({ ...formData, knowledge_point_id: e.target.value })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  >
                    <option value="">请选择知识点</option>
                    {knowledgePoints.map((point) => (
                      <option key={point.id} value={point.id}>{point.title}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标签</label>
                  <input
                    type="text"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                    placeholder="多个标签用逗号分隔"
                  />
                </div>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.practice_enabled}
                      onChange={(e) => setFormData({ ...formData, practice_enabled: e.target.checked })}
                      className="rounded"
                    />
                    <span>练习启用</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.exam_enabled}
                      onChange={(e) => setFormData({ ...formData, exam_enabled: e.target.checked })}
                      className="rounded"
                    />
                    <span>考试启用</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={!htmlToPlainText(formData.content).trim() || !formData.answers[0]}
                  className="flex-1 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50 hover:bg-blue-600 transition-colors"
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBatchTagModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowBatchTagModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">批量管理标签</h3>
              <p className="text-sm text-gray-600 mb-4">已选择 {selectedIds.length} 道题</p>

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setBatchTagAction('add')}
                  className={`flex-1 py-2 rounded-lg transition-colors ${
                    batchTagAction === 'add' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  <i className="fa-solid fa-plus mr-1"></i>
                  添加标签
                </button>
                <button
                  onClick={() => setBatchTagAction('remove')}
                  className={`flex-1 py-2 rounded-lg transition-colors ${
                    batchTagAction === 'remove' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  <i className="fa-solid fa-minus mr-1"></i>
                  删除标签
                </button>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {batchTagAction === 'add' ? '要添加的标签（多个用逗号分隔）' : '要删除的标签（多个用逗号分隔）'}
                </label>
                <input
                  type="text"
                  value={batchTagInput}
                  onChange={(e) => setBatchTagInput(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                  placeholder="例如：基础, 进阶, 重点"
                />
              </div>

              {allTags.length > 0 && batchTagAction === 'add' && (
                <div className="mb-4">
                  <label className="block text-sm text-gray-600 mb-2">已有标签（点击快速添加）：</label>
                  <div className="flex flex-wrap gap-2">
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setBatchTagInput((prev) => (prev ? prev + ', ' + tag : tag))}
                        className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200 transition-colors"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowBatchTagModal(false)}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchTagOperation}
                  disabled={!batchTagInput.trim()}
                  className={`flex-1 py-2 text-white rounded-lg disabled:opacity-50 transition-colors ${
                    batchTagAction === 'add' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-red-500 hover:bg-red-600'
                  }`}
                >
                  确认
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBatchKnowledgeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowBatchKnowledgeModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                <i className="fa-solid fa-book text-indigo-500 mr-2"></i>
                批量设置知识点
              </h3>
              <p className="text-sm text-gray-600 mb-4">已选择 {selectedIds.length} 道题</p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">选择知识点</label>
                <select
                  value={batchKnowledgeId}
                  onChange={(e) => setBatchKnowledgeId(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                >
                  <option value="">请选择知识点</option>
                  {knowledgePoints.map((point) => (
                    <option key={point.id} value={point.id}>{point.title}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowBatchKnowledgeModal(false)}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    if (!batchKnowledgeId || selectedIds.length === 0) return;
                    await backendClient.from('questions').update({ knowledge_point_id: batchKnowledgeId }).in('id', selectedIds);
                    setSelectedIds([]);
                    setBatchKnowledgeId('');
                    setShowBatchKnowledgeModal(false);
                    fetchData();
                  }}
                  disabled={!batchKnowledgeId}
                  className="flex-1 py-2 bg-indigo-500 text-white rounded-lg disabled:opacity-50 hover:bg-indigo-600 transition-colors"
                >
                  确认设置
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAIGenerateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => !aiGenerating && setShowAIGenerateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-lg w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                <i className="fa-solid fa-robot text-purple-500 mr-2"></i>
                AI智能出题
              </h3>

              {!aiGenerating ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">题目类型</label>
                    <select
                      value={aiFormData.type}
                      onChange={(e) => setAiFormData({ ...aiFormData, type: e.target.value as 'choice' | 'fill_blank' })}
                      className="w-full p-3 border border-gray-300 rounded-lg"
                    >
                      <option value="choice">选择题</option>
                      <option value="fill_blank">填空题</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      额外要求 <span className="text-xs font-normal text-purple-600">（必填，用于指导AI出题）</span>
                    </label>
                    <textarea
                      value={aiFormData.customPrompt}
                      onChange={(e) => setAiFormData({ ...aiFormData, customPrompt: e.target.value })}
                      className="w-full p-3 border border-gray-300 rounded-lg h-20"
                      placeholder="例如：生成5道关于Python循环结构的题目，包括for循环和while循环的应用..."
                    />
                  </div>

                  <div className="pt-3 border-t border-gray-200">
                    <details>
                      <summary className="text-sm text-purple-600 cursor-pointer hover:text-purple-800">
                        <i className="fa fa-cog mr-1"></i>AI API设置（可选未配置时可在此填写）
                      </summary>
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">API密钥</label>
                          <input
                            type="password"
                            value={aiFormData.api_key}
                            onChange={(e) => setAiFormData({ ...aiFormData, api_key: e.target.value })}
                            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-sm"
                          />
                          <p className="text-xs text-gray-500 mt-1">不填写则使用系统设置中的密钥</p>
                        </div>
                      </div>
                    </details>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowAIGenerateModal(false)}
                      className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={generateAIQuestions}
                      disabled={!aiFormData.customPrompt.trim()}
                      className="flex-1 py-2 bg-purple-500 text-white rounded-lg disabled:opacity-50 hover:bg-purple-600 transition-colors"
                    >
                      开始生成
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <i className="fa-solid fa-circle-notch fa-spin text-4xl text-purple-500 mb-4"></i>
                  <p className="text-gray-700">{aiProgress}</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => !importing && setShowImportModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                <i className="fa-solid fa-file-import text-green-500 mr-2"></i>
                批量导入题目
              </h3>

              {!importing ? (
                <div className="space-y-4">
                  <div className="flex border-b border-gray-200 mb-2">
                    <button
                      onClick={() => setImportTab('text')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        importTab === 'text'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      JSON/CSV 导入
                    </button>
                    <button
                      onClick={() => setImportTab('rich')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        importTab === 'rich'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      图文粘贴导入
                    </button>
                  </div>

                  {importTab === 'text' && (
                    <>
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <h4 className="font-medium text-blue-800 mb-2">导入格式说明</h4>
                        <p className="text-sm text-blue-700 mb-2">支持 JSON 或 CSV 格式，系统会自动识别：</p>
                        <p className="text-sm text-blue-700 mb-2"><strong>推荐 JSON 格式：</strong></p>
                        <code className="text-xs bg-blue-100 px-2 py-1 rounded block mb-2 overflow-x-auto">
                          {`[{"type":"choice","content":"题目内容","options":["选项A","选项B"],"answers":["答案"],"explanation":"解析","knowledge_point_id":"uuid","practice_enabled":true,"exam_enabled":false,"tags":["标签"]}]`}
                        </code>
                        <p className="text-sm text-blue-700 mb-2"><strong>CSV 格式（兼容旧数据）：</strong></p>
                        <code className="text-xs bg-blue-100 px-2 py-1 rounded block mb-2">
                          类型,题干,选项,答案,解析,知识点ID,知识点名称,练习启用,考试启用,标签
                        </code>
                        <ul className="text-xs text-blue-600 list-disc list-inside space-y-1">
                          <li>type：choice(选择题) / fill_blank(填空题) / composite(综合题)</li>
                          <li>options：选择题选项数组</li>
                          <li>answers：正确答案数组</li>
                          <li>practice_enabled/exam_enabled：true/false</li>
                          <li>tags：标签数组</li>
                        </ul>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">导入数据 (JSON 或 CSV)</label>
                        <textarea
                          value={importData}
                          onChange={(e) => setImportData(e.target.value)}
                          className="w-full p-3 border border-gray-300 rounded-lg h-64 font-mono text-sm"
                          placeholder={`[
  {
    "type": "choice",
    "content": "Python中print函数的作用是？",
    "options": ["输出内容到控制台", "获取用户输入", "定义变量", "导入模块"],
    "answers": ["输出内容到控制台"],
    "explanation": "print函数用于将内容输出到控制台",
    "knowledge_point_id": "123e4567-e89b-12d3-a456-426614174000",
    "practice_enabled": true,
    "exam_enabled": false,
    "tags": ["基础", "入门"]
  }
]`}
                        />
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowImportModal(false)}
                          className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleImport}
                          disabled={!importData.trim()}
                          className="flex-1 py-2 bg-green-500 text-white rounded-lg disabled:opacity-50 hover:bg-green-600 transition-colors"
                        >
                          开始导入
                        </button>
                      </div>
                    </>
                  )}

                  {importTab === 'rich' && (
                    <>
                      <div className="bg-amber-50 p-4 rounded-lg">
                        <h4 className="font-medium text-amber-800 mb-2">图文粘贴导入说明</h4>
                        <ul className="text-sm text-amber-700 list-disc list-inside space-y-1">
                          <li>从 Word 或其他文档中复制题目，直接粘贴到下方</li>
                          <li>支持带图片的题目，图片会自动上传到服务器</li>
                          <li>题目格式要求：题号开头（如"1."、"2、"），选项用A/B/C/D开头</li>
                          <li>答案用"答案："开头，解析用"解析："开头</li>
                          <li>先点击"解析预览"查看识别结果，确认无误再导入</li>
                        </ul>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">粘贴题目内容（支持Word图文粘贴）</label>
                        <div
                          contentEditable
                          onInput={(e) => setRichImportHtml((e.target as HTMLDivElement).innerHTML)}
                          onPaste={(e) => {
                            setTimeout(() => {
                              setRichImportHtml((e.target as HTMLDivElement).innerHTML);
                            }, 10);
                          }}
                          className="w-full p-3 border border-gray-300 rounded-lg min-h-64 max-h-80 overflow-y-auto bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          style={{ whiteSpace: 'pre-wrap' }}
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(richImportHtml) }}
                          suppressContentEditableWarning
                        />
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={handleRichTextParse}
                          disabled={!richImportHtml.trim()}
                          className="flex-1 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50 hover:bg-blue-600 transition-colors"
                        >
                          <i className="fa-solid fa-eye mr-1"></i>
                          解析预览 ({parsedQuestions.length} 道)
                        </button>
                      </div>

                      {parsedQuestions.length > 0 && (
                        <div className="border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto bg-gray-50">
                          <p className="text-sm font-medium text-gray-700 mb-2">
                            识别到 {parsedQuestions.length} 道题：
                          </p>
                          <div className="space-y-3">
                            {parsedQuestions.map((q, idx) => (
                              <div key={idx} className="bg-white p-3 rounded border border-gray-200">
                                <div className="text-sm font-medium text-gray-800 mb-1">
                                  第 {idx + 1} 题（{q.type === 'choice' ? '选择题' : q.type === 'composite' ? '综合题' : '填空题'}）
                                </div>
                                <div
                                  className="text-xs text-gray-600 mb-2 line-clamp-2"
                                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.content) }}
                                />
                                {q.type === 'choice' && q.options.length > 0 && (
                                  <div className="text-xs text-gray-500">
                                    选项数：{q.options.filter((o: string) => htmlToPlainText(o).trim()).length}
                                  </div>
                                )}
                                <div className="text-xs text-green-600 mt-1">
                                  答案：{q.answers?.join(', ') || '未识别'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowImportModal(false)}
                          className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleRichImport}
                          disabled={parsedQuestions.length === 0}
                          className="flex-1 py-2 bg-green-500 text-white rounded-lg disabled:opacity-50 hover:bg-green-600 transition-colors"
                        >
                          确认导入 {parsedQuestions.length > 0 && `(${parsedQuestions.length}道)`}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <i className="fa-solid fa-circle-notch fa-spin text-4xl text-green-500 mb-4"></i>
                  <p className="text-gray-700">{importProgress}</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                <i className="fa-solid fa-exclamation-triangle text-red-500 mr-2"></i>
                确认删除
              </h3>
              <p className="text-gray-600 mb-6">
                确定要删除选中的 {deleteTargetId ? '1' : deleteTargetIds.length} 道题吗？此操作不可恢复！
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteTargetId(null);
                    setDeleteTargetIds([]);
                  }}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  确定删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI 聚类弹窗 */}
      <AnimatePresence>
        {showClusterModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => !clustering && setShowClusterModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <i className="fa-solid fa-layer-group text-cyan-500"></i>
                  AI 题目聚类
                </h3>
                <button
                  onClick={() => !clustering && setShowClusterModal(false)}
                  disabled={clustering}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                >
                  <i className="fa-solid fa-times text-xl"></i>
                </button>
              </div>

              {/* 当前聚类状态 */}
              {clusterStats && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-3 gap-3 text-center mb-3">
                    <div>
                      <div className="text-2xl font-bold text-cyan-600">{clusterStats.clustered}</div>
                      <div className="text-xs text-gray-500">已聚类</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-amber-600">{clusterStats.unclustered}</div>
                      <div className="text-xs text-gray-500">未聚类</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-purple-600">{clusterStats.clusters.length}</div>
                      <div className="text-xs text-gray-500">聚类簇数</div>
                    </div>
                  </div>
                  {clusterStats.clusters.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-500 mb-2">聚类分布（按题目数倒序，前 15）:</div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {clusterStats.clusters.slice(0, 15).map((c, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-gray-700">{c.cluster_id}</span>
                            <span className="bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded">{c.cnt} 题</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 操作按钮 */}
              {!clustering && !clusterResult && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    AI 聚类会为每道题分配一个「一级类目/二级类目」格式的知识点路径（如「信息系统/分类与类型」），
                    存入 cluster_id 字段。<b>此字段不暴露给学生筛选页</b>，仅用于学生做错后推荐同类题。
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleAiCluster('selected')}
                      disabled={selectedIds.length === 0}
                      className="flex-1 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <i className="fa-solid fa-check-double mr-1"></i>
                      聚类选中题 ({selectedIds.length})
                    </button>
                    <button
                      onClick={() => handleAiCluster('all')}
                      className="flex-1 py-3 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
                    >
                      <i className="fa-solid fa-database mr-1"></i>
                      聚类全部题
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">
                    参考 Token 消耗：1000 题约 16 万 token，DeepSeek 价格约 ¥0.25。
                    分批 50 题/次，支持失败重试。
                  </p>
                </div>
              )}

              {/* 进行中 */}
              {clustering && (
                <div className="flex flex-col items-center justify-center py-8">
                  <i className="fa-solid fa-circle-notch fa-spin text-4xl text-cyan-500 mb-3"></i>
                  <p className="text-gray-700">AI 正在聚类，请稍候（每批 50 题，预计 1~2 分钟）...</p>
                </div>
              )}

              {/* 完成结果 */}
              {clusterResult && !clustering && (
                <div className="space-y-3">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                      <i className="fa-solid fa-circle-check"></i>
                      聚类完成
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center text-sm">
                      <div>
                        <div className="text-xl font-bold text-green-700">{clusterResult.updated}</div>
                        <div className="text-xs text-gray-500">成功</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold text-amber-700">{clusterResult.skipped}</div>
                        <div className="text-xs text-gray-500">跳过</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold text-gray-700">{clusterResult.total}</div>
                        <div className="text-xs text-gray-500">总计</div>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setClusterResult(null);
                    }}
                    className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    继续聚类其他题目
                  </button>
                  <button
                    onClick={() => setShowClusterModal(false)}
                    className="w-full py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    关闭
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
