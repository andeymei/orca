import React from 'react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'

function KeyCap({
  label,
  className
}: {
  label: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded border border-border/80 bg-secondary/70 px-1.5 py-0.5 text-xs font-medium text-muted-foreground shadow-sm',
        className
      )}
    >
      {label}
    </span>
  )
}

type ShortcutKeyComboProps = {
  keys: string[]
  className?: string
  separatorClassName?: string
  // Override cap colors when chips sit on a non-default surface (e.g. a filled primary card).
  keyCapClassName?: string
  /**
   * `compact`: a small flat cap that sits inside a line of text or a button label.
   * `inline`: the keys read as plain glyphs in a menu row instead of key caps.
   */
  size?: 'default' | 'compact' | 'inline'
  renderKey?: (key: string) => React.ReactNode
  // Double taps use repeated labels/glyphs with a space instead of +.
  doubleTap?: boolean
}

export function ShortcutKeyCombo({
  keys,
  className,
  separatorClassName,
  keyCapClassName,
  size = 'default',
  renderKey,
  doubleTap = false
}: ShortcutKeyComboProps): React.JSX.Element {
  const t = useTranslate()
  const isMac = navigator.userAgent.includes('Mac')
  const separatorClasses =
    separatorClassName ?? (size === 'inline' ? 'text-2xs' : 'mx-0.5 text-xs text-muted-foreground')

  return (
    <span
      className={cn('inline-flex items-center gap-1', size === 'inline' && 'gap-0', className)}
      title={
        doubleTap && keys.length > 0
          ? t('auto.components.ShortcutKeyCombo.07eb4985a1', 'Double-tap {{value0}}', {
              value0: keys[0]
            })
          : undefined
      }
    >
      {keys.map((key, index) => (
        <React.Fragment key={`${key}-${index}`}>
          <KeyCap
            label={renderKey ? renderKey(key) : key}
            className={cn(
              size === 'compact' && 'min-w-0 px-1 py-0 text-2xs shadow-none',
              size === 'inline' &&
                'min-w-0 border-0 bg-transparent p-0 text-2xs font-medium text-current shadow-none',
              keyCapClassName
            )}
          />
          {/* Mac uses adjacent glyphs; Windows/Linux use +. Double taps use a space. */}
          {!isMac && !doubleTap && index < keys.length - 1 ? (
            <span className={separatorClasses}>+</span>
          ) : null}
        </React.Fragment>
      ))}
    </span>
  )
}
