import { useRef, useState, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react'
import styles from './LoginHero.module.css'
import { APP_NAME } from '../../../shared/config/branding'
import { Icon } from '../../../shared/components/Icon/Icon'
import { BrandMark } from '../../../shared/components/BrandMark/BrandMark'

// ── App Registry ───────────────────────────────────────────────
// To add a new app: push ONE object — { id, label, icon }.
// Position  → auto-calculated from index (elliptical distribution).
// Icon color → auto-assigned from COLOR_PALETTE cycling by index.
// No posClass, no colorClass, no manual CSS needed.
interface AppNode {
  id:    string
  label: string[]
  icon:  ReactNode
}

// ── Color Palette (cycles automatically) ──────────────────────
// Add more entries to expand the palette for future apps.
const COLOR_PALETTE: { bg: string; shadow: string }[] = [
  { bg: 'linear-gradient(145deg,#7c3aed 0%,#4f46e5 100%)', shadow: '0 2px 8px rgba(109,40,217,0.45)' }, // violet
  { bg: 'linear-gradient(145deg,#0284c7 0%,#2563eb 100%)', shadow: '0 2px 8px rgba(37,99,235,0.45)'   }, // blue
  { bg: 'linear-gradient(145deg,#0d9488 0%,#0891b2 100%)', shadow: '0 2px 8px rgba(8,145,178,0.45)'   }, // teal
  { bg: 'linear-gradient(145deg,#d97706 0%,#b45309 100%)', shadow: '0 2px 8px rgba(180,83,9,0.40)'    }, // amber
  { bg: 'linear-gradient(145deg,#be185d 0%,#9d174d 100%)', shadow: '0 2px 8px rgba(157,23,77,0.45)'   }, // rose
  { bg: 'linear-gradient(145deg,#15803d 0%,#166534 100%)', shadow: '0 2px 8px rgba(21,128,61,0.40)'   }, // green
]

const APPS: AppNode[] = [
  { id: 'lead',     label: ['Lead',     'Management'], icon: <Icon.User width={15} height={15} /> },
  { id: 'market',   label: ['Market',   'Place'],      icon: <Icon.Headphones width={15} height={15} /> },
  { id: 'case',     label: ['Case',     'Management'], icon: <Icon.Package width={15} height={15} /> },
  { id: 'customer', label: ['Customer', '360°'],       icon: <Icon.Users width={15} height={15} /> },
  { id: 'product',  label: ['Api',  'Management'], icon: <Icon.Search width={15} height={15} /> },
]

// ── Auto-position helper ───────────────────────────────────────
// Distributes N cards evenly around an ellipse centred at (50 %, 50 %).
// rx / ry are the half-axes in percentage-of-container units.
// startAngleDeg lets you rotate the whole ring (−90 = first card at top).
function getCardStyle(
  index:         number,
  total:         number,
  rx = 41,        // horizontal radius  (% of stage width)
  ry = 42,        // vertical   radius  (% of stage height)
  startAngleDeg = -90,
): CSSProperties {
  const angleRad = ((startAngleDeg + (360 / total) * index) * Math.PI) / 180
  const cx = 50 + rx * Math.cos(angleRad)  // % from left
  const cy = 50 + ry * Math.sin(angleRad)  // % from top

  return {
    left:      `${cx}%`,
    top:       `${cy}%`,
    transform: 'translate(-50%, -50%)',
  }
}

interface LineCoord { x1: number; y1: number; x2: number; y2: number }

/** Gap between where a beam stops and the card it points at, in px. */
const BEAM_GAP = 2

/**
 * Where a beam from the hub should stop: on the near EDGE of the card it points at,
 * not at its centre.
 *
 * Drawing to the centre meant every beam ran straight through the card, with a bright
 * terminal dot sitting in the middle of it. That only ever looked right because
 * `backdrop-filter` smeared the part underneath — and that property silently no-ops
 * wherever GPU compositing is unavailable (RDP and VDI sessions, hardware acceleration
 * off, driver blocklists), which is why the deployed build showed the beams on top of
 * the cards while a dev machine did not. Stopping at the edge makes the geometry
 * correct on its own, so the fix does not depend on a card being opaque.
 *
 * Returns the point where the hub→centre ray leaves the card's bounding box, which for
 * a rectangle is whichever axis is crossed first.
 */
export function edgePoint(
  hubX: number, hubY: number,
  centreX: number, centreY: number,
  halfWidth: number, halfHeight: number,
): { x: number; y: number } {
  const dx = centreX - hubX
  const dy = centreY - hubY
  const length = Math.hypot(dx, dy)

  // The card is sitting on the hub (only possible mid-resize): nothing sensible to draw.
  if (length === 0) return { x: centreX, y: centreY }

  // Fraction of the hub→centre vector to walk back from the centre. Infinity for an
  // axis the ray does not travel along, so `min` ignores it.
  const alongX = dx === 0 ? Infinity : halfWidth / Math.abs(dx)
  const alongY = dy === 0 ? Infinity : halfHeight / Math.abs(dy)
  const back = Math.min(alongX, alongY) + BEAM_GAP / length

  // A card closer to the hub than its own half-extent would pull the endpoint behind
  // the hub and flip the beam, so never retreat past the hub itself.
  const clamped = Math.min(back, 1)

  return { x: centreX - dx * clamped, y: centreY - dy * clamped }
}

// ── Component ──────────────────────────────────────────────────
export function LoginHero() {
  const stageRef = useRef<HTMLDivElement>(null)
  const hubRef   = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [lines, setLines] = useState<LineCoord[]>([])

  const recalculate = useCallback(() => {
    const stage = stageRef.current
    const hub   = hubRef.current
    if (!stage || !hub) return

    const sr = stage.getBoundingClientRect()
    const hr = hub.getBoundingClientRect()
    const hubCX = hr.left - sr.left + hr.width  / 2
    const hubCY = hr.top  - sr.top  + hr.height / 2

    const next: LineCoord[] = []
    for (const app of APPS) {
      const el = cardRefs.current.get(app.id)
      if (!el) continue
      const cr = el.getBoundingClientRect()
      const end = edgePoint(
        hubCX, hubCY,
        cr.left - sr.left + cr.width  / 2,
        cr.top  - sr.top  + cr.height / 2,
        cr.width / 2, cr.height / 2,
      )
      next.push({ x1: hubCX, y1: hubCY, x2: end.x, y2: end.y })
    }
    setLines(next)
  }, [])

  useEffect(() => {
    // Recalculate after first paint (cards are positioned by CSS %)
    const id = requestAnimationFrame(recalculate)
    const ro = new ResizeObserver(recalculate)
    if (stageRef.current) ro.observe(stageRef.current)
    return () => { cancelAnimationFrame(id); ro.disconnect() }
  }, [recalculate])

  return (
    <div className={styles.heroContainer}>
      <div className={styles.bgDeepGlow}      aria-hidden="true" />
      <div className={styles.bgGridOverlay}   aria-hidden="true" />
      <div className={styles.bgGlowOrb}       aria-hidden="true" />
      <div className={styles.bgCenterHorizon} aria-hidden="true" />

      <div className={styles.heroInner}>

        {/* ── Brand Header ── */}
        <header className={styles.brandHeader}>
          <BrandMark size={36} variant="inverted" />
          <span className={styles.brandTitle}>
            Omni<span>Connect</span>
          </span>
        </header>

        {/* ── Eyebrow + Headline ── */}
        <div className={styles.headlineSection}>
          <span className={styles.eyebrowBadge}>
            <Icon.ShieldCheck width={12} height={12} />
            Enterprise micro-frontend platform
          </span>
          <h1 className={styles.mainHeading}>
            Everything your team<br />
            runs on, <span className={styles.gradientHeading}>in one place.</span>
          </h1>
          <p className={styles.subHeading}>
            Sign in for secure, role-based access to every application your
            organization runs — unified under one login.
          </p>
        </div>

        {/* ── Isometric Stage ── */}
        <div className={styles.isometricStage} ref={stageRef}>

          {/* Dynamic SVG lines — redrawn automatically */}
          <svg
            aria-hidden="true"
            className={
              lines.length > 0
                ? `${styles.overlayLayer} ${styles.overlayVisible}`
                : styles.overlayLayer
            }
          >
            <defs>
              <filter id="lineGlow">
                <feGaussianBlur stdDeviation="1.8" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            {lines.map((ln, i) => (
              <g key={i}>
                {/* Soft glow halo */}
                <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                  stroke="#ffffff" strokeWidth="4" strokeOpacity="0.16"
                  strokeLinecap="round" filter="url(#lineGlow)" />
                {/* Main animated dash */}
                <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                  stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.65"
                  strokeLinecap="round" strokeDasharray="6 5"
                  className={styles.pulseBeam} />
                {/* Terminal dot, on the card's edge rather than inside it */}
                <circle cx={ln.x2} cy={ln.y2} r="3.5"
                  fill="#ffffff" fillOpacity="0.85" />
              </g>
            ))}
          </svg>

          {/* Hub SVG */}
          <svg className={styles.hubSvg} viewBox="0 0 240 200"
            fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <radialGradient id="hubGlow2" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.40" />
                <stop offset="60%"  stopColor="#ffffff" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="pedTop2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#ffffff" />
                <stop offset="55%"  stopColor="#dbeafe" />
                <stop offset="100%" stopColor="#93c5fd" />
              </linearGradient>
              <linearGradient id="pedLeft2" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stopColor="#bfdbfe" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
              <linearGradient id="pedRight2" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stopColor="#93c5fd" />
                <stop offset="100%" stopColor="#1d4ed8" />
              </linearGradient>
              <linearGradient id="horizGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor="#ffffff" stopOpacity="0" />
                <stop offset="35%"  stopColor="#ffffff" stopOpacity="0.45" />
                <stop offset="50%"  stopColor="#ffffff" stopOpacity="0.85" />
                <stop offset="65%"  stopColor="#ffffff" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <filter id="pedGlow2" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <path d="M 0 130 Q 120 95 240 130" stroke="url(#horizGrad2)" strokeWidth="2" fill="none" />
            <ellipse cx="120" cy="125" rx="85" ry="36" fill="url(#hubGlow2)" />
            <ellipse cx="120" cy="132" rx="55" ry="20" fill="#1e3a8a" opacity="0.35" />
            <polygon points="60,125 120,155 180,125 120,95"  fill="#2563eb" fillOpacity="0.55" stroke="#93c5fd" strokeWidth="1" />
            <polygon points="60,125 120,155 120,165 60,135"  fill="#1e40af" fillOpacity="0.55" />
            <polygon points="120,155 180,125 180,135 120,165" fill="#1d4ed8" fillOpacity="0.55" />
            <polygon points="70,115 120,142 170,115 120,88"
              fill="url(#pedTop2)" stroke="#ffffff" strokeWidth="2.5" filter="url(#pedGlow2)" />
            <polygon points="70,115 120,142 120,151 70,124" fill="url(#pedLeft2)" />
            <polygon points="120,142 170,115 170,124 120,151" fill="url(#pedRight2)" />
            <polygon points="85,115 120,133 155,115 120,97" fill="#eff6ff" stroke="#ffffff" strokeWidth="1.4" />
            <g transform="translate(103,90)">
              <polygon points="17,2 30,9 30,23 17,30 4,23 4,9"
                fill="#2563eb" stroke="#ffffff" strokeWidth="2" filter="url(#pedGlow2)" />
              <path d="M17,2 L17,16 M30,9 L17,16 M4,9 L17,16 M17,16 L17,30" stroke="#bfdbfe" strokeWidth="1.2" />
              <polygon points="17,7 24,11 24,21 17,25 10,21 10,11" fill="#fff" opacity="0.95" />
              <path d="M17,7 L17,16 M24,11 L17,16 M10,11 L17,16 M17,16 L17,25" stroke="#1D4ED8" strokeWidth="1.2" />
            </g>
          </svg>

          {/* Invisible hub centre anchor */}
          <div ref={hubRef} className={styles.hubAnchor} aria-hidden="true" />

          {/* ── Auto-positioned App Cards ── */}
          {APPS.map((app, i) => {
            const color = COLOR_PALETTE[i % COLOR_PALETTE.length]
            return (
              <div
                key={app.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(app.id, el)
                  else    cardRefs.current.delete(app.id)
                }}
                className={styles.appCard}
                style={getCardStyle(i, APPS.length)}
              >
                {/* Icon box — color injected via CSS vars, no class per app */}
                <div
                  className={styles.cardIconBox}
                  style={{
                    ['--icon-bg'     as string]: color.bg,
                    ['--icon-shadow' as string]: color.shadow,
                  }}
                >
                  {app.icon}
                </div>
                <span className={styles.cardLabel}>
                  {app.label.map((line, li) => (
                    <span key={li}>{line}{li < app.label.length - 1 && <br />}</span>
                  ))}
                </span>
                <span className={styles.statusDot} aria-label="Active" />
              </div>
            )
          })}
        </div>

        {/* ── Feature Strip ── */}
        <div className={styles.featureStrip}>
          {[
            { Icon: Icon.ShieldCheck, title: 'Enterprise Security', sub: '256-bit TLS encryption' },
            { Icon: Icon.Lock,        title: 'Role-Based Access',    sub: 'Granular permissions'   },
            { Icon: Icon.FileText,    title: 'Audit Trails',         sub: 'Full activity log'       },
            { Icon: Icon.ShieldCheck, title: 'Compliance & Controls', sub: 'Governance & access controls'     },
          ].map(({ Icon: Ic, title, sub }) => (
            <div key={title} className={styles.featureItem}>
              <div className={styles.featureIconWrap}><Ic width={16} height={16} /></div>
              <div className={styles.featureTextCol}>
                <span className={styles.featureTitle}>{title}</span>
                <span className={styles.featureSub}>{sub}</span>
              </div>
            </div>
          ))}
        </div>

        <footer className={styles.heroFooter}>
          © 2026 {APP_NAME}. All rights reserved.
        </footer>
      </div>
    </div>
  )
}
