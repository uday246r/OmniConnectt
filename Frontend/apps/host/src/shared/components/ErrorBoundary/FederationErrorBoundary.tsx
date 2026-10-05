import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@omniconnect/ui'
import styles from './FederationErrorBoundary.module.css'

/** Delays between automatic retries, in ms. After the last one, only a manual retry remains. */
const AUTO_RETRY_DELAYS_MS = [2_000, 5_000, 10_000]

export interface FederationErrorBoundaryProps {
  appDisplayName: string
  children: ReactNode
  /**
   * Called before the boundary clears its own error state. Required for a genuine retry: a
   * React.lazy()'s internal promise is cached forever once it rejects — simply re-rendering the
   * SAME lazy component reference re-throws the exact same cached rejection without ever calling
   * the loader again. The caller must evict/replace whatever produced the failed lazy component
   * (see RemoteAppPage's lazyComponentCache) so a retry performs an actual fresh fetch attempt.
   */
  onRetry?: () => void
}

interface State {
  error: Error | null
  /** How many automatic retries have already been spent for the current failure streak. */
  autoRetriesUsed: number
  /** Seconds remaining until the next automatic retry; null when no retry is scheduled. */
  countdown: number | null
  showDetails: boolean
}

/**
 * Catches a remote app's load/render failures — a bad manifest URL, a network blip, a runtime
 * error thrown by the remote itself — and shows a distinct, recoverable state instead of taking
 * down the whole host shell. Deliberately separate from MaintenancePage: this is an unplanned
 * failure, not an admin-set status.
 *
 * The overwhelmingly common cause in practice is simply that the remote's server was momentarily
 * unavailable — a restart, a redeploy, a laptop waking up. So this retries a few times on its own
 * with a widening delay before asking the user to do anything, and shows a plain-language message
 * rather than the raw Module Federation error (`RUNTIME-003 ... args: {...}`), which is developer
 * diagnostics, not something an operator or a bank's end user can act on. The real text is kept,
 * one disclosure away, because it IS what a developer needs.
 */
/** By name rather than instanceof, so a class from another bundle copy is still recognised. */
const isIncompatible = (error: Error) => error.name === 'RemoteIncompatibleError'

export class FederationErrorBoundary extends Component<FederationErrorBoundaryProps, State> {
  state: State = { error: null, autoRetriesUsed: 0, countdown: null, showDetails: false }

  private countdownTimer: number | null = null

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Failed to render remote app "${this.props.appDisplayName}":`, error, info.componentStack)
    // An incompatible build stays incompatible: retrying would only hammer the server.
    if (!isIncompatible(error)) {
      this.scheduleAutoRetry()
    }
  }

  componentWillUnmount() {
    this.clearTimer()
  }

  private clearTimer() {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
  }

  private scheduleAutoRetry() {
    const delay = AUTO_RETRY_DELAYS_MS[this.state.autoRetriesUsed]
    if (delay === undefined) {
      // Out of automatic attempts — stop and leave it to the user, rather than hammering a remote
      // that is genuinely down.
      this.setState({ countdown: null })
      return
    }

    this.clearTimer()
    this.setState({ countdown: Math.ceil(delay / 1000) })

    this.countdownTimer = window.setInterval(() => {
      this.setState((prev) => {
        if (prev.countdown === null) {
          return null
        }
        if (prev.countdown <= 1) {
          this.clearTimer()
          // Defer out of the updater: retry() calls the parent's onRetry, and triggering a parent
          // state update synchronously from inside our own setState updater is not safe.
          window.setTimeout(() => this.retry({ automatic: true }), 0)
          return { countdown: 0 }
        }
        return { countdown: prev.countdown - 1 }
      })
    }, 1000)
  }

  private retry = ({ automatic }: { automatic: boolean }) => {
    this.clearTimer()
    this.props.onRetry?.()
    this.setState((prev) => ({
      error: null,
      countdown: null,
      showDetails: false,
      // A manual retry resets the budget: the user is explicitly asserting it's worth trying again,
      // and if it fails they get the full automatic sequence once more.
      autoRetriesUsed: automatic ? prev.autoRetriesUsed + 1 : 0,
    }))
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    if (isIncompatible(this.state.error)) {
      return (
        <div className={styles.wrapper} role="alert" aria-live="assertive">
          <div className={styles.icon} aria-hidden="true">
            ⚠
          </div>
          <h1>{this.props.appDisplayName} needs a platform update</h1>
          <p className={styles.message}>
            The version of this app that is published was built for a newer version of the platform than
            the one running here. Please contact your administrator — reloading will not help.
          </p>
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>Technical details</summary>
            <pre className={styles.detailsBody}>{this.state.error.message}</pre>
          </details>
        </div>
      )
    }

    const { countdown, autoRetriesUsed } = this.state
    const isRetrying = countdown !== null
    const exhausted = autoRetriesUsed >= AUTO_RETRY_DELAYS_MS.length

    return (
      <div className={styles.wrapper} role="alert" aria-live="assertive">
        <div className={styles.icon} aria-hidden="true">
          ⚠
        </div>
        <h1>{this.props.appDisplayName} isn't responding</h1>

        <p className={styles.message}>
          {exhausted
            ? "This app's server didn't respond after several attempts. It may be restarting or offline — please try again shortly, or contact your administrator if it persists."
            : "This usually means the app's server is momentarily unavailable."}
        </p>

        {isRetrying && (
          <p className={styles.retryStatus} aria-live="polite">
            {countdown === 0 ? 'Retrying…' : `Retrying automatically in ${countdown}s…`}
          </p>
        )}

        <Button variant="secondary" onClick={() => this.retry({ automatic: false })}>
          {isRetrying ? 'Retry now' : 'Try again'}
        </Button>

        <details
          className={styles.details}
          open={this.state.showDetails}
          onToggle={(e) => this.setState({ showDetails: (e.currentTarget as HTMLDetailsElement).open })}
        >
          <summary className={styles.detailsSummary}>Technical details</summary>
          <pre className={styles.detailsBody}>{this.state.error.message}</pre>
        </details>
      </div>
    )
  }
}
