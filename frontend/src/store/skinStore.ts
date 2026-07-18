import { create } from 'zustand';
import { WindowSkinConfig, DEFAULT_SKIN } from '../config/windowSkins';

interface SkinState {
  activeSkin: WindowSkinConfig;
  setActiveSkin: (skin: WindowSkinConfig | null) => void;
}

export const useSkinStore = create<SkinState>((set) => ({
  activeSkin: DEFAULT_SKIN,
  setActiveSkin: (skin) => set({ activeSkin: skin || DEFAULT_SKIN }),
}));
