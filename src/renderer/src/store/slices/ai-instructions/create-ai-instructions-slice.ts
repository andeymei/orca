import type { StateCreator } from 'zustand'
import type { AppState } from '../../types'
import type { ResolvedAiInstruction } from '@/components/editor/ai-instructions/ai-instruction-status'

// Why a constant: readers select this list, so a fresh array per call would re-render on every commit.
const EMPTY_AI_INSTRUCTION_ENTRIES = Object.freeze([]) as unknown as ResolvedAiInstruction[]

export type AiInstructionsSlice = {
  aiInstructionEntriesByFile: Record<string, ResolvedAiInstruction[]>
  publishAiInstructionEntries: (
    key: string,
    entries: readonly ResolvedAiInstruction[] | null
  ) => void
  getAiInstructionEntries: (key: string) => ResolvedAiInstruction[]
}

export const createAiInstructionsSlice: StateCreator<AppState, [], [], AiInstructionsSlice> = (
  set,
  get
) => ({
  aiInstructionEntriesByFile: {},

  publishAiInstructionEntries: (key, entries) => {
    set((state) => {
      if (entries === null) {
        const { [key]: _removed, ...rest } = state.aiInstructionEntriesByFile
        return { aiInstructionEntriesByFile: rest }
      }
      // Why a copy: the caller's array may change later, and the store must not follow it silently.
      return {
        aiInstructionEntriesByFile: {
          ...state.aiInstructionEntriesByFile,
          [key]: [...entries]
        }
      }
    })
  },

  getAiInstructionEntries: (key) =>
    get().aiInstructionEntriesByFile[key] ?? EMPTY_AI_INSTRUCTION_ENTRIES
})
