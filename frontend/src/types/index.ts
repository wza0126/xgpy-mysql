import { Database } from './database';

export type Tables = Database['public']['Tables'];
export type Enums = Database['public']['Enums'];

export type Profile = Tables['profiles']['Row'];
export type Class = Tables['classes']['Row'];
export type KnowledgePoint = Tables['knowledge_points']['Row'];
export type Question = Tables['questions']['Row'];
export type StudentAnswer = Tables['student_answers']['Row'];
export type WrongQuestion = Tables['wrong_questions']['Row'];
export type Test = Tables['tests']['Row'];
export type TestRecord = Tables['test_records']['Row'];
export type Note = Tables['notes']['Row'];
export type Pet = Tables['pets']['Row'];
export type StudentPet = Tables['student_pets']['Row'];
export type PetFood = Tables['pet_foods']['Row'];
export type PetTip = Tables['pet_tips']['Row'];
export type Prize = Tables['prizes']['Row'];
export type InternetCode = Tables['internet_codes']['Row'];
export type ExchangeRecord = Tables['exchange_records']['Row'];
export type PrizeClassVisibility = Tables['prize_class_visibility']['Row'];
export type SystemConfig = Tables['system_config']['Row'];

export type AppRole = Enums['app_role'];
export type QuestionType = Enums['question_type'];
export type AnswerSource = Enums['answer_source'];
export type PrizeType = Enums['prize_type'];

export interface WindowState {
  id: string;
  title: string;
  icon: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  component: React.ReactNode;
  initialData?: any;
}

export interface DesktopIcon {
  id: string;
  title: string;
  icon: string;
  color: string;
}

export interface PracticeStats {
  total: number;
  correct: number;
  wrong: number;
  accuracy: number;
  mastered: number;
}

export interface TestResult {
  score: number;
  correctCount: number;
  totalCount: number;
  pointsEarned: number;
}

export interface PetLevel {
  level: number;
  minGrowth: number;
  maxGrowth: number;
  name: string;
}

// 固定5个阶段名称，用于图片显示
export const PET_STAGE_NAMES = ['幼年期', '成长期', '成熟期', '完全体', '究极体'];

// 默认PET_LEVELS（向后兼容）
export const PET_LEVELS: PetLevel[] = [
  { level: 1, minGrowth: 0, maxGrowth: 50, name: '幼年期' },
  { level: 2, minGrowth: 50, maxGrowth: 150, name: '成长期' },
  { level: 3, minGrowth: 150, maxGrowth: 300, name: '成熟期' },
  { level: 4, minGrowth: 300, maxGrowth: 500, name: '完全体' },
  { level: 5, minGrowth: 500, maxGrowth: 1000, name: '究极体' },
];

// 动态计算等级配置
// baseThreshold: 1级到2级的基础成长值
// increment: 每升一级阈值增加量
export function getPetLevelConfig(baseThreshold: number, increment: number, maxStage: number = 5): PetLevel[] {
  const levels: PetLevel[] = [];
  let cumulative = 0;
  for (let i = 1; i <= maxStage; i++) {
    const threshold = baseThreshold + (i - 1) * increment;
    const minGrowth = cumulative;
    cumulative += threshold;
    levels.push({
      level: i,
      minGrowth,
      maxGrowth: cumulative,
      name: PET_STAGE_NAMES[i - 1] || `阶段${i}`,
    });
  }
  return levels;
}

// 计算指定等级需要的累计成长值
export function getCumulativeThresholdForLevel(level: number, baseThreshold: number, increment: number): number {
  let cumulative = 0;
  for (let i = 1; i < level; i++) {
    cumulative += baseThreshold + (i - 1) * increment;
  }
  return cumulative;
}

// 根据成长值计算等级
export function calculatePetLevel(growthValue: number, baseThreshold: number, increment: number): number {
  let cumulative = 0;
  for (let lvl = 1; ; lvl++) {
    const threshold = baseThreshold + (lvl - 1) * increment;
    cumulative += threshold;
    if (growthValue < cumulative) {
      return lvl;
    }
  }
}

export const POINTS_CORRECT = 10;
export const POINTS_WRONG = -5;
export const PET_ADOPTION_THRESHOLD = 100;
