import type { ReactElement, SVGProps } from "react";
import { Icon as SharedIcon, type IconComponent } from "@omniconnect/ui";

/*
 * Every generic glyph (close, check, search, edit, trash, eye…) is drawn by the platform icon set, so
 * the same action looks the same here as in the host and the other remotes. Only product-domain
 * pictograms the platform has no equivalent for (loans, deposits, percent…) keep a local path.
 *
 * Several call sites passed names that did not exist ("file-text", "check-circle", "message-square",
 * "refresh-cw") and silently rendered the fallback package glyph; those are real names now.
 */
const SHARED: Partial<Record<IconName, IconComponent>> = {
  package: SharedIcon.Package,
  shield: SharedIcon.Shield,
  check: SharedIcon.Check,
  "check-circle": SharedIcon.CheckCircle,
  star: SharedIcon.Star,
  search: SharedIcon.Search,
  close: SharedIcon.X,
  "chevron-down": SharedIcon.ChevronDown,
  "chevron-left": SharedIcon.ChevronLeft,
  "chevron-right": SharedIcon.ChevronRight,
  plus: SharedIcon.Plus,
  grid: SharedIcon.Grid,
  download: SharedIcon.Download,
  "more-vertical": SharedIcon.MoreVertical,
  "more-horizontal": SharedIcon.MoreHorizontal,
  edit: SharedIcon.Edit,
  bell: SharedIcon.Bell,
  calendar: SharedIcon.Calendar,
  clock: SharedIcon.Clock,
  file: SharedIcon.FileText,
  "file-text": SharedIcon.FileText,
  "message-square": SharedIcon.Chat,
  "refresh-cw": SharedIcon.Activity,
  user: SharedIcon.User,
  building: SharedIcon.Building,
  trash: SharedIcon.Trash,
  eye: SharedIcon.Eye,
  "trending-up": SharedIcon.TrendingUp,
  info: SharedIcon.Info,
  settings: SharedIcon.Settings,
  briefcase: SharedIcon.Briefcase,
  lock: SharedIcon.Lock,
  dashboard: SharedIcon.Grid,
};

export type IconName =
  | "check-circle"
  | "file-text"
  | "message-square"
  | "refresh-cw"
  | "package"
  | "loan" | "loans"
  | "credit-card"
  | "accounts"
  | "investments"
  | "insurance"
  | "deposit" | "deposits"
  | "shield"
  | "check"
  | "star"
  | "star-filled"
  | "percent"
  | "search"
  | "close"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "plus"
  | "filter-x"
  | "grid"
  | "list"
  | "download"
  | "more-vertical"
  | "edit"
  | "bell"
  | "dashboard"
  | "calendar"
  | "arrow-up"
  | "arrow-down"
  | "clock"
  | "upload"
  | "file"
  | "user"
  | "building"
  | "trash"
  | "eye"
  | "tag"
  | "trending-up"
  | "arrow-left"
  | "more-horizontal"
  | "info"
  | "settings"
  | "briefcase"
  | "lock"
  | "slash"
  | "external-link";

/** Local pictograms; a name drawn by the platform set above never reaches this table. */
const paths: Partial<Record<IconName, ReactElement>> = {
  package: <><path d="M21 8L12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
  loan: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></>,
  loans: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></>,
  "credit-card": <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></>,
  accounts: <><path d="M4 21V9l8-5 8 5v12" /><path d="M9 21v-6h6v6" /></>,
  investments: <><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></>,
  insurance: <><path d="M12 2 4 5v6c0 5 3.5 8.7 8 11 4.5-2.3 8-6 8-11V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  deposit: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  deposits: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  shield: <path d="M12 2 4 5v6c0 5 3.5 8.7 8 11 4.5-2.3 8-6 8-11V5l-8-3Z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  star: <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21l1.2-6.9-5-4.9 6.9-1L12 2Z" />,
  "star-filled": <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21l1.2-6.9-5-4.9 6.9-1L12 2Z" fill="currentColor" stroke="none" />,
  percent: <><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  close: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  "chevron-down": <polyline points="6 9 12 15 18 9" />,
  "chevron-left": <polyline points="15 18 9 12 15 6" />,
  "chevron-right": <polyline points="9 18 15 12 9 6" />,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  "filter-x": <><path d="M4 5h16" /><path d="M7 12h7" /><path d="M10 19h1" /><line x1="17" y1="16" x2="22" y2="21" /><line x1="22" y1="16" x2="17" y2="21" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
  list: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  "more-vertical": <><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></>,
  "more-horizontal": <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  "arrow-up": <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>,
  "arrow-down": <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></>,
  "arrow-left": <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  building: <><rect x="4" y="2" width="16" height="20" rx="1" /><line x1="9" y1="7" x2="9" y2="7" /><line x1="9" y1="11" x2="9" y2="11" /><line x1="9" y1="15" x2="9" y2="15" /><line x1="15" y1="7" x2="15" y2="7" /><line x1="15" y1="11" x2="15" y2="15" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></>,
  tag: <><path d="M20.6 12.6 12.7 20.5a2 2 0 0 1-2.8 0l-8-8a2 2 0 0 1 0-2.8L9.8 1.9 20.6 12.6Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  "trending-up": <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
  info: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>,
  briefcase: <><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  slash: <><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></>,
  "external-link": <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
};

export function Icon({ name, size = 18, strokeWidth = 2, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  // Names arrive from data too (a category's or product's iconKey), so an unknown one falls back
  // to the package glyph instead of rendering nothing.
  const Shared = SHARED[name] ?? (paths[name] ? undefined : SharedIcon.Package);
  if (Shared) return <Shared width={size} height={size} strokeWidth={strokeWidth} {...rest} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
