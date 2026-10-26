import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnswerOptions } from '../../src/components/questions/AnswerOptions';

describe('AnswerOptions', () => {
  it('lets the student pick an option with the keyboard-accessible radio group', async () => {
    const onSelect = vi.fn();
    render(<AnswerOptions name="q" options={['40', '50', '60', '80']} selected={null} onSelect={onSelect} locked={false} />);
    await userEvent.click(screen.getByLabelText(/Option C/));
    expect(onSelect).toHaveBeenCalledWith('C');
  });

  it('locks inputs after submission and reveals the answer only when given', () => {
    const { rerender } = render(<AnswerOptions name="q" options={['40', '50', '60', '80']} selected="B" locked />);
    screen.getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled());
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();
    rerender(<AnswerOptions name="q" options={['40', '50', '60', '80']} selected="B" locked correctOption="C" />);
    expect(screen.getByText('Correct answer')).toBeInTheDocument();
    expect(screen.getByText('Your answer')).toBeInTheDocument();
  });
});
