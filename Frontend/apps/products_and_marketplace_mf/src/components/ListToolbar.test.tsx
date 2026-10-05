import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ListToolbar } from './ListToolbar';

/**
 * The search box above every list.
 *
 * The subtle part is keeping the box and the committed search in step without either overwriting the other:
 * a pause that fires while the person is still typing must not put older text back, and Reset must clear
 * what is on screen. Fake timers stand in for the pause.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const PLACEHOLDER = 'Search things…';
const box = () => screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

/** A host that owns the committed search, the way a page's store does. */
function Harness({ onCommit, canReset = true }: { onCommit: (search: string) => void; canReset?: boolean }) {
  const [search, setSearch] = useState('');
  return (
    <ListToolbar
      searchLabel="Search things"
      searchPlaceholder={PLACEHOLDER}
      search={search}
      onSearchChange={(value) => { setSearch(value); onCommit(value); }}
      canReset={canReset}
      onReset={() => setSearch('')}
    />
  );
}

describe('ListToolbar search', () => {
  it('does not query on every keystroke — only after a pause', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    type('h');
    type('ho');
    type('hom');
    wait(100);
    expect(onCommit).not.toHaveBeenCalled();

    wait(300);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('hom');
  });

  it('keeps what the person is still typing when an earlier pause commits', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    type('ho');
    wait(350);
    expect(onCommit).toHaveBeenLastCalledWith('ho');

    // They keep typing while the committed value flows back into the box.
    type('hom');

    expect(box().value).toBe('hom');
  });

  it('commits again for the further typing', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    type('ho');
    wait(350);
    type('home');
    wait(350);

    expect(onCommit.mock.calls.map((call) => call[0])).toEqual(['ho', 'home']);
  });

  it('does not re-commit text that has not changed', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    type('home');
    wait(350);
    type('home');
    wait(350);

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('clears the box when the search is reset from outside', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    type('home');
    wait(350);
    expect(box().value).toBe('home');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(box().value).toBe('');
  });
});

describe('ListToolbar reset', () => {
  it('is only offered when it would do something', () => {
    const { rerender } = render(<ListToolbar searchLabel="s" searchPlaceholder={PLACEHOLDER} search="" onSearchChange={() => undefined} canReset={false} onReset={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();

    rerender(<ListToolbar searchLabel="s" searchPlaceholder={PLACEHOLDER} search="" onSearchChange={() => undefined} canReset onReset={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
  });

  it('calls back when pressed', () => {
    const onReset = vi.fn();
    render(<ListToolbar searchLabel="s" searchPlaceholder={PLACEHOLDER} search="" onSearchChange={() => undefined} canReset onReset={onReset} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
