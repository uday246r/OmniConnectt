import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Pagination } from './Pagination'

/**
 * The noun in "Showing 1 to 10 of 33 products".
 *
 * The bar adds an "s" to whatever it is given, which is right for "user" and wrong twice over for
 * anything else: the marketplace passed "products" and showed "33 productss" on every list it has,
 * and the honest fix of passing the singular would have produced "8 categorys". Both mistakes are in
 * one line of small grey text at the bottom of a table, which is exactly where nobody looks until a
 * customer does.
 */
describe('Pagination summary', () => {
  const noop = () => {}

  it('adds an s for any count but one', () => {
    render(<Pagination page={1} pageSize={10} total={33} itemLabel="product" onPageChange={noop} />)

    expect(screen.getByText(/33/).closest('span')).toHaveTextContent('Showing 1 to 10 of 33 products')
  })

  it('leaves a single item singular', () => {
    render(<Pagination page={1} pageSize={10} total={1} itemLabel="product" onPageChange={noop} onPageSizeChange={noop} />)

    expect(screen.getByText(/Showing/).closest('span')).toHaveTextContent('Showing 1 to 1 of 1 product')
    expect(screen.getByText(/Showing/).closest('span')).not.toHaveTextContent('products')
  })

  it('uses the plural it is given for a noun that does not take a plain s', () => {
    render(
      <Pagination page={1} pageSize={10} total={24} itemLabel="category" itemLabelPlural="categories" onPageChange={noop} />,
    )

    const summary = screen.getByText(/Showing/).closest('span')
    expect(summary).toHaveTextContent('of 24 categories')
    expect(summary).not.toHaveTextContent('categorys')
  })

  it('reads zero as a plural, and as 0 to 0 rather than 1 to 0', () => {
    render(<Pagination page={1} pageSize={10} total={0} itemLabel="event" onPageChange={noop} onPageSizeChange={noop} />)

    expect(screen.getByText(/Showing/).closest('span')).toHaveTextContent('Showing 0 to 0 of 0 events')
  })
})
