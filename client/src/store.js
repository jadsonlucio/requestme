import { create } from 'zustand';

const useStore = create((set) => ({
  activeRequest: null,
  activeEnvironmentId: null,
  setActiveRequest: (request) => set({ activeRequest: request }),
  setActiveEnvironmentId: (id) => set({ activeEnvironmentId: id }),
  updateActiveRequest: (updates) =>
    set((state) => ({
      activeRequest: state.activeRequest ? { ...state.activeRequest, ...updates } : null,
    })),
}));

export default useStore;
