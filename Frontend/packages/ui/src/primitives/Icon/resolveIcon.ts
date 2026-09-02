import { Icon } from './Icon'

export type IconComponent = (typeof Icon)[keyof typeof Icon]

/**
 * Resolve a registry-supplied `iconKey` to a real icon component.
 *
 * Remote applications were being rendered with a hardcoded Users icon everywhere they appeared — the
 * sidebar, the role editor's application accordions, the applications list — so a Helpdesk app and
 * an Inventory app looked identical, despite the module registry already storing an icon key per
 * app. This is the one place that mapping happens.
 *
 * The key is operator-supplied data, so an unrecognised or absent value must not crash the render:
 * it falls back to a neutral Box. That also means adding a new icon to `Icon.tsx` is enough to make
 * it selectable by an operator, with no further wiring here.
 */
export function resolveIcon(iconKey?: string | null, fallback: IconComponent = Icon.Box): IconComponent {
  if (iconKey) {
    const candidate = (Icon as Record<string, IconComponent | undefined>)[iconKey]
    if (candidate) return candidate
  }
  return fallback
}
