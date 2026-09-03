import { Link } from 'react-router-dom'
import styles from './NotFoundPage.module.css'
import { Button } from '@omniremit/ui'

export function NotFoundPage() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.code}>404</div>
      <p>This page doesn't exist, or you don't have access to it.</p>
      <Link to="/">
        <Button variant="secondary">Back to Dashboard</Button>
      </Link>
    </div>
  )
}
