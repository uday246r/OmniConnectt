/**
 * The platform icon set — ONE import path for every app.
 *
 * Before this the host rendered 57 hand-drawn inline SVGs (371 usages) while both remotes imported
 * `lucide-react` directly, on **different majors** (`^1.16.0` and `^1.31.0`). Three icon sources in
 * one product, two of which disagreed with each other.
 *
 * Both sets are drawn to the same grid — 24x24 viewBox, `stroke-width: 2`, round caps and joins —
 * so unifying is a question of source, not of redrawing.
 *
 *   - 35 names the host ALREADY draws are exported as the host's own glyph, so those now render
 *     identically in all three apps. The host is the design reference and is left untouched.
 *   - 33 names only lucide has are re-exported from it, pinned to one version here.
 *
 * The host keeps using `Icon.Foo` from the main entry; nothing there changes. Remotes import named
 * icons from `@omniremit/ui/icons` and keep their existing `<Foo size={16} />` call sites — the
 * shim below maps lucide's `size` onto the hand-drawn components' `width`/`height`.
 */
import type { ReactElement, SVGProps } from 'react'
import { Icon } from './primitives/Icon/Icon'

type LucideLikeProps = SVGProps<SVGSVGElement> & { size?: number | string }

/**
 * Lets a hand-drawn icon accept lucide's `size` prop, so a call site can move between the two
 * sources without being rewritten.
 */
function withSize(C: (p: SVGProps<SVGSVGElement>) => ReactElement) {
  return function Wrapped({ size, ...rest }: LucideLikeProps) {
    return <C {...(size !== undefined ? { width: size, height: size } : {})} {...rest} />
  }
}

/* ---- Drawn by the platform (host reference) ---- */
export const Activity = withSize(Icon.Activity)
export const AlertCircle = withSize(Icon.AlertCircle)
export const AlertTriangle = withSize(Icon.AlertTriangle)
export const ArrowRight = withSize(Icon.ArrowRight)
export const Box = withSize(Icon.Box)
export const Briefcase = withSize(Icon.Briefcase)
export const Building = withSize(Icon.Building)
export const Calendar = withSize(Icon.Calendar)
export const Check = withSize(Icon.Check)
export const ChevronDown = withSize(Icon.ChevronDown)
export const ChevronLeft = withSize(Icon.ChevronLeft)
export const ChevronRight = withSize(Icon.ChevronRight)
export const Clock = withSize(Icon.Clock)
export const Copy = withSize(Icon.Copy)
export const DollarSign = withSize(Icon.DollarSign)
export const Download = withSize(Icon.Download)
export const Eye = withSize(Icon.Eye)
export const EyeOff = withSize(Icon.EyeOff)
export const FileText = withSize(Icon.FileText)
export const Filter = withSize(Icon.Filter)
export const Globe = withSize(Icon.Globe)
export const Home = withSize(Icon.Home)
export const Info = withSize(Icon.Info)
export const Key = withSize(Icon.Key)
export const Layers = withSize(Icon.Layers)
export const Mail = withSize(Icon.Mail)
export const Package = withSize(Icon.Package)
export const Search = withSize(Icon.Search)
export const Settings = withSize(Icon.Settings)
export const Shield = withSize(Icon.Shield)
export const ShieldCheck = withSize(Icon.ShieldCheck)
export const TrendingUp = withSize(Icon.TrendingUp)
export const User = withSize(Icon.User)
export const UserCheck = withSize(Icon.UserCheck)
export const Users = withSize(Icon.Users)

/* ---- Supplied by lucide-react, pinned here to a single version ---- */
export {
  ArrowLeft,
  BookOpen,
  Building2,
  CheckCircle2,
  CheckSquare,
  Coins,
  CreditCard,
  Edit3,
  Flag,
  FolderKanban,
  GitCommit,
  GripVertical,
  Hash,
  Hourglass,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  MapPin,
  MessageSquare,
  Percent,
  Phone,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
