import type { Icon } from '@omniconnect/ui';

/**
 * The icons a category, sub-category or product can be given.
 *
 * Typed against the shared icon set, so removing or renaming an icon there fails the build here instead
 * of rendering a blank tile. This is the one list: the picker and every check read it. (There used to be
 * two hand-typed copies that disagreed — one said "loans", the other "loan".)
 */
export const CATALOG_ICON_KEYS = [
  'Package', 'Box', 'Building', 'Briefcase', 'DollarSign', 'Home', 'Shield', 'ShieldCheck', 'Layers', 'TrendingUp',
  'PieChart', 'Users', 'Star', 'Crown', 'Globe', 'Key', 'FileText', 'Activity', 'Headset', 'Calendar', 'Settings', 'Grid',
] as const satisfies readonly (keyof typeof Icon)[];

export type CatalogIconKey = (typeof CATALOG_ICON_KEYS)[number];
