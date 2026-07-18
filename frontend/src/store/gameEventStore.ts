import { create } from 'zustand';

export type PetMoodEvent = 'correct' | 'wrong' | 'crit' | 'perfect_10' | 'triple_crit' | 'wrong_3' | 'studious' | 'equipment_drop';

interface GameEventState {
  lastEvent: PetMoodEvent | null;
  eventCount: number;
  eventPayload: any | null;
  emitEvent: (event: PetMoodEvent, payload?: any) => void;
  clearEvent: () => void;
}

export const useGameEventStore = create<GameEventState>((set, get) => ({
  lastEvent: null,
  eventCount: 0,
  eventPayload: null,

  emitEvent: (event: PetMoodEvent, payload?: any) => {
    const count = get().eventCount + 1;
    set({ lastEvent: event, eventCount: count, eventPayload: payload ?? null });
  },

  clearEvent: () => {
    set({ lastEvent: null, eventPayload: null });
  },
}));
