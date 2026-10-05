import { Link } from 'react-router-dom'
import styles from './NotFoundPage.module.css'
import { Button } from '@omniconnect/ui'

export function NotFoundPage() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.code}>404</div>
      <p>This page doesn't exist.</p>
      <Link to="/">
        <Button variant="secondary">Back to Dashboard</Button>
      </Link>
    </div>
  )
}
