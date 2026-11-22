import type {
  NesEdit,
  NesEditPlan
} from '../../../../../shared/code-completion/code-completion-types'

/** Where the cursor sits, in the editor's own 1-based line and column numbers. */
export type NesCursorPosition = { lineNumber: number; column: number }

export type NesPlanStore = {
  /** Binds a Monaco model to the file it shows, so a model key can be resolved to a path. */
  bindModel(modelKey: string, filePath: string): void
  /** Drops the binding of a model that is gone. */
  unbindModel(modelKey: string): void
  /** The plan the model answered with. */
  setPlan(filePath: string, plan: NesEditPlan): void
  /**
   * The plan Orca worked out on its own, without asking anybody.
   *
   * Why it is kept apart: a request that failed must not take the local suggestions with it, and
   * the local suggestions must not hide the answer the model gave.
   */
  setLocalPlan(filePath: string, plan: NesEditPlan): void
  getPlan(filePath: string): NesEditPlan | null
  /** The edit of the bound file whose range ends at the cursor, if there is one. */
  editAt(modelKey: string, position: NesCursorPosition): NesEdit | null
  /** Every edit any stored plan makes in the file, so a file the user is not in still shows its marker. */
  editsForPath(filePath: string): NesEdit[]
  /** Drops every plan the file holds. */
  remove(filePath: string): void
  /** Drops only the plan the model answered with. */
  removeModelPlan(filePath: string): void
  clear(): void
}

/** An edit matches the cursor when the cursor sits at the edit's range end. */
export function nesEditMatchesPosition(edit: NesEdit, position: NesCursorPosition): boolean {
  return edit.range.endLine === position.lineNumber && edit.range.endColumn === position.column
}

export function createNesPlanStore(): NesPlanStore {
  const modelPaths = new Map<string, string>()
  const plans = new Map<string, NesEditPlan>()
  const localPlans = new Map<string, NesEditPlan>()
  const editsOf = (plan: NesEditPlan | undefined): NesEdit[] => plan?.edits ?? []
  return {
    bindModel(modelKey: string, filePath: string): void {
      modelPaths.set(modelKey, filePath)
    },
    unbindModel(modelKey: string): void {
      // Why: the plan belongs to the file, so a second editor on it still wants it.
      modelPaths.delete(modelKey)
    },
    setPlan(filePath: string, plan: NesEditPlan): void {
      plans.set(filePath, plan)
    },
    setLocalPlan(filePath: string, plan: NesEditPlan): void {
      localPlans.set(filePath, plan)
    },
    getPlan(filePath: string): NesEditPlan | null {
      return plans.get(filePath) ?? null
    },
    editAt(modelKey: string, position: NesCursorPosition): NesEdit | null {
      const filePath = modelPaths.get(modelKey)
      if (filePath === undefined) {
        return null
      }
      const candidates = [...editsOf(plans.get(filePath)), ...editsOf(localPlans.get(filePath))]
      // Why: an edit of another file cannot be applied at this cursor.
      return (
        candidates.find(
          (edit) => edit.path === filePath && nesEditMatchesPosition(edit, position)
        ) ?? null
      )
    },
    editsForPath(filePath: string): NesEdit[] {
      const edits: NesEdit[] = []
      for (const plan of [...plans.values(), ...localPlans.values()]) {
        for (const edit of plan.edits) {
          if (edit.path === filePath) {
            edits.push(edit)
          }
        }
      }
      return edits
    },
    remove(filePath: string): void {
      plans.delete(filePath)
      localPlans.delete(filePath)
    },
    removeModelPlan(filePath: string): void {
      plans.delete(filePath)
    },
    clear(): void {
      modelPaths.clear()
      plans.clear()
      localPlans.clear()
    }
  }
}

/** The store the provider and the editor hook share, so both see the same plan. */
export const nesPlanStore: NesPlanStore = createNesPlanStore()
