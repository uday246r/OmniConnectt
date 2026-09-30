import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { ApprovalPendingError } from '../services/httpClient';

/**
 * Asking before doing something that matters, and reporting the server's answer.
 *
 * The server refuses some of these on purpose — a category that still has sub-categories cannot be
 * deleted — and that refusal is the useful part. It must reach the person, in the dialog that asked, with
 * the way back left open. A change held for approval is neither a success nor a failure.
 */

const pending = new ApprovalPendingError({ approvalRequestId: 'r', module: 'm', action: 'Delete', checkerName: 'Ben Ito', message: '' });

function setup(onConfirm: () => Promise<void>, over: { destructive?: boolean } = {}) {
  const onClose = vi.fn();
  render(<ConfirmDialog open title="Delete category?" message="It will be removed." confirmLabel="Delete category" onConfirm={onConfirm} onClose={onClose} {...over} />);
  return { onClose, user: userEvent.setup() };
}

describe('ConfirmDialog', () => {
  it('says what is about to happen and offers both ways out', () => {
    setup(async () => undefined);

    expect(screen.getByRole('heading', { name: 'Delete category?' })).toBeInTheDocument();
    expect(screen.getByText('It will be removed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete category' })).toBeEnabled();
  });

  it('closes after the action succeeds', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { onClose, user } = setup(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Delete category' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows the server\'s refusal in the dialog, and stays open with both buttons free', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Cannot delete a category that still has sub-categories.'));
    const { onClose, user } = setup(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Delete category' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot delete a category that still has sub-categories.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete category' })).toBeEnabled();
  });

  it('closes quietly, without an error, when the change was sent for approval instead', async () => {
    const { onClose, user } = setup(vi.fn().mockRejectedValue(pending));

    await user.click(screen.getByRole('button', { name: 'Delete category' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cannot be double-submitted or cancelled while the action is running', async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { onClose, user } = setup(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Delete category' }));

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete category/ })).toBeDisabled();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('lets the person back out with Cancel', async () => {
    const onConfirm = vi.fn();
    const { onClose, user } = setup(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
