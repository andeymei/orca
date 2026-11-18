import type { LucideIcon } from 'lucide-react'
import { createContext } from 'react'

/** What a file pill shows; the editor's consumer owns the file, so it names it. */
export type PromptFileLabel = { label: string; icon: LucideIcon; title?: string }
export type PromptFileLabelResolver = (path: string, token: string) => PromptFileLabel | null

/** What an image pill shows; the consumer knows whether the image is still there. */
export type PromptImageLabel = { label: string; missing: boolean }
export type PromptImageLabelResolver = (attachmentId: string) => PromptImageLabel | null

export const PromptFileLabelContext = createContext<PromptFileLabelResolver | null>(null)
export const PromptImageLabelContext = createContext<PromptImageLabelResolver | null>(null)
