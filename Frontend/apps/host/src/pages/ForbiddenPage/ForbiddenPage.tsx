import { NotFoundPage } from '../NotFoundPage/NotFoundPage'

export interface ForbiddenPageProps {
  what?: string
}

/**
 * Access denial is unified to 404 (NotFoundPage) so external actors cannot infer
 * the existence of pages or features via permission denial.
 */
export function ForbiddenPage(_props: ForbiddenPageProps = {}) {
  return <NotFoundPage />
}
