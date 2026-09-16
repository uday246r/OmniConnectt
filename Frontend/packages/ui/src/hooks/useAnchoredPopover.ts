import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

export interface AnchoredPopover<TAnchor extends HTMLElement> {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  /** Attach to whatever the popover hangs off — a `<th>`, a button, a wrapper. */
  anchorRef: React.RefObject<TAnchor | null>
  /** Attach to the portalled popover itself, so an outside click can tell it apart from outside. */
  popoverRef: React.RefObject<HTMLDivElement | null>
  /** Viewport coordinates, or null before the first measurement. Render nothing until it is set. */
  coords: { top: number; left: number } | null
  /** For `aria-controls` / `id`, so the trigger and the popover are associated. */
  popoverId: string
}

export interface AnchoredPopoverOptions {
  /** The popover's own width, used to keep it from running off the right edge. */
  minWidth?: number
  /** Gap between the anchor's bottom edge and the popover. */
  gap?: number
}

/**
 * Positions a portalled popover under an anchor, and closes it on an outside click or Escape.
 *
 * @remarks
 * The popover is portalled to `document.body` deliberately, and that is what makes this hook worth
 * extracting rather than inlining. A popover rendered inside a table is clipped by the table's own
 * `overflow`, which no amount of `z-index` escapes — but once portalled it is no longer inside the
 * anchor, so an outside-click check has to consider BOTH elements or clicking anything in the
 * popover dismisses it before the click lands. That subtlety was re-implemented three times in this
 * codebase and two of the copies also forgot Escape entirely.
 *
 * Portalling is safe here specifically because these are CSS Modules: modules are excluded from each
 * remote's selector-prefixing step and hash to unique names, and the `--omni-*` tokens live on the
 * real `:root`. A component styled by a GLOBAL stylesheet would lose its styling when portalled out
 * of a remote's scope; these do not.
 */
export function useAnchoredPopover<TAnchor extends HTMLElement>(
  options: AnchoredPopoverOptions = {},
): AnchoredPopover<TAnchor> {
  const { minWidth = 268, gap = 6 } = options

  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const anchorRef = useRef<TAnchor | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const popoverId = useId()

  useLayoutEffect(() => {
    if (!open) return

    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const left = Math.min(rect.left, window.innerWidth - minWidth)
      setCoords({ top: rect.bottom + gap, left: Math.max(8, left) })
    }

    update()
    // Capture phase on scroll, so the popover follows an anchor inside a scrolling container and
    // not only the window.
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, minWidth, gap])

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (!anchorRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return { open, setOpen, anchorRef, popoverRef, coords, popoverId }
}
