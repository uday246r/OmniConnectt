import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RowMenu } from './RowMenu';

/** The "…" at the end of a table row: opens a menu of that row's actions, and gets out of the way. */

function setup(items = [{ key: 'edit', label: 'Edit', onSelect: vi.fn() }, { key: 'delete', label: 'Delete', danger: true, onSelect: vi.fn() }]) {
  render(<RowMenu label="Actions for Loans" items={items} />);
  return { items, user: userEvent.setup(), trigger: () => screen.getByRole('button', { name: 'Actions for Loans' }) };
}

describe('RowMenu', () => {
  it('names the row it acts on, and starts closed', () => {
    const { trigger } = setup();

    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on click and lists every action', async () => {
    const { user, trigger } = setup();

    await user.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit', 'Delete']);
  });

  it('runs the chosen action and closes', async () => {
    const { user, trigger, items } = setup();
    await user.click(trigger());

    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(items[1].onSelect).toHaveBeenCalledTimes(1);
    expect(items[0].onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape without doing anything', async () => {
    const { user, trigger, items } = setup();
    await user.click(trigger());

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(items.every((item) => (item.onSelect as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });

  it('closes on a click elsewhere', async () => {
    const { user, trigger } = setup();
    await user.click(trigger());

    await user.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows a disabled action but does not run it', async () => {
    const onSelect = vi.fn();
    const { user, trigger } = setup([{ key: 'up', label: 'Move up', disabled: true, onSelect } as never]);
    await user.click(trigger());

    const item = screen.getByRole('menuitem', { name: 'Move up' });
    await user.click(item);

    expect(item).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
