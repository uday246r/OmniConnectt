import { describe, it, expect } from 'vitest'
import { edgePoint } from './LoginHero'

/**
 * Worth testing because this geometry IS the fix for the login hero's beams appearing
 * on top of the module cards, and it is the part that cannot be seen to be right by
 * reading the stylesheet. Before this, every beam was drawn to the card's centre and a
 * bright dot was painted there; the overlap was hidden only by `backdrop-filter`, which
 * does nothing wherever GPU compositing is unavailable. A regression here is invisible
 * on a developer's machine and obvious on a deployed server, so it needs an assertion
 * rather than a screenshot.
 *
 * Every case places the hub at the origin and a 100x40 card (half-extents 50x20), the
 * proportions the real cards have.
 */
describe('edgePoint', () => {
  const HALF_W = 50
  const HALF_H = 20

  it('stops short of a card sitting directly to the right, on its left edge', () => {
    const end = edgePoint(0, 0, 300, 0, HALF_W, HALF_H)

    // 300 - 50 half-width - 2px gap.
    expect(end.x).toBeCloseTo(248)
    expect(end.y).toBeCloseTo(0)
  })

  it('stops on the top edge of a card directly below, where height is crossed first', () => {
    const end = edgePoint(0, 0, 0, 200, HALF_W, HALF_H)

    expect(end.x).toBeCloseTo(0)
    expect(end.y).toBeCloseTo(178)
  })

  it('never reaches the card centre, for a card at any angle', () => {
    for (const [cx, cy] of [[300, 120], [-260, 90], [140, -210], [-90, -310]]) {
      const end = edgePoint(0, 0, cx, cy, HALF_W, HALF_H)

      const toCentre = Math.hypot(cx, cy)
      const toEnd = Math.hypot(end.x, end.y)

      expect(toEnd).toBeLessThan(toCentre)
    }
  })

  it('keeps the endpoint on the hub→centre line, so the beam still points at the card', () => {
    const end = edgePoint(0, 0, 300, 120, HALF_W, HALF_H)

    // Same direction means the same ratio of the two components.
    expect(end.y / end.x).toBeCloseTo(120 / 300)
  })

  it('leaves a card overlapping the hub at the hub rather than flipping the beam past it', () => {
    // Centre is 10px away but the card's half-extent is 50px, so an unclamped retreat
    // would land on the far side of the hub and draw the beam backwards.
    const end = edgePoint(0, 0, 10, 0, HALF_W, HALF_H)

    expect(end.x).toBeCloseTo(0)
    expect(end.y).toBeCloseTo(0)
  })

  it('returns the centre unchanged when the card is exactly on the hub', () => {
    const end = edgePoint(140, 90, 140, 90, HALF_W, HALF_H)

    expect(end).toEqual({ x: 140, y: 90 })
  })
})
