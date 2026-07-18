export interface NPC {
  id: string;
  name: string;
  title: string;
  description: string;
  avatar: string;
}

export interface DialogueLine {
  npcId: string;
  text: string;
  delay?: number;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  template: string;
  hint: string;
  expectedOutput?: string;
  xpReward: number;
}

export interface BossBattle {
  id: string;
  title: string;
  description: string;
  template: string;
  hint: string;
  expectedOutput?: string;
  xpReward: number;
  timeLimit?: number;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface Chapter {
  id: number;
  title: string;
  subtitle: string;
  professor: NPC;
  dialogues: DialogueLine[];
  magicBook: {
    title: string;
    content: string[];
    examples: { code: string; description: string }[];
  };
  challenges: Challenge[];
  boss: BossBattle;
  badge: Badge;
}

export interface GameProgress {
  id: string;
  user_id: string;
  current_chapter: number;
  current_step: 'dialogue' | 'magicbook' | 'challenge' | 'boss' | 'completed';
  completed_challenges: string[];
  badges: string[];
  total_xp: number;
  created_at: string;
  updated_at: string;
  reward_claimed: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MagicAcademyAppProps {
  onClose: () => void;
}
