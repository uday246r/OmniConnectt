import type { ReactNode } from "react";
import { Button, EmptyState as SharedEmptyState, SkeletonBlock } from "@omniremit/ui";
import { Icon, type IconName } from "./Icon";

/*
 * Empty, error and loading states on the platform components. These were local markup and CSS that
 * looked different from the same states in the host and the other remotes; the call sites keep their
 * props, the rendering is shared.
 */

export function EmptyState({
  icon = "info",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return <SharedEmptyState icon={<Icon name={icon} size={32} />} title={title} description={description} action={action} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert">
      <SharedEmptyState
        icon={<Icon name="info" size={32} className="pm-error-state-icon" />}
        title="Something went wrong"
        description={message}
        action={
          onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

export function LoadingSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="pm-skeleton-grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="pm-card pm-skeleton-card">
          <SkeletonBlock width={40} height={40} />
          <SkeletonBlock width="70%" height={16} />
          <SkeletonBlock width="90%" height={12} />
          <SkeletonBlock width="50%" height={12} />
          <SkeletonBlock width="100%" height={32} />
        </div>
      ))}
    </div>
  );
}

export function LoadingSkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="pm-skeleton-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} width="100%" height={44} />
      ))}
    </div>
  );
}
