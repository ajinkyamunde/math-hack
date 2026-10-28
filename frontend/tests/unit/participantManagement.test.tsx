import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/services/apiClient';

vi.mock('../../src/services/participantService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/participantService')>();
  return {
    ...actual,
    participantService: {
      ...actual.participantService,
      assignableCompetitions: vi.fn(),
      create: vi.fn(),
      resetPassword: vi.fn(),
    },
  };
});

const { participantService } = await import('../../src/services/participantService');
const { AddParticipantForm } = await import('../../src/features/participants/AddParticipantForm');
const { ResetPasswordDialog } = await import('../../src/features/participants/ResetPasswordDialog');
const { generateParticipantPassword, validateNewParticipant, validateParticipantPassword } = await import('../../src/features/participants/participantValidation');

describe('participant validation', () => {
  it('requires exactly 4 letters or digits', () => {
    for (const ok of ['Ab12', '1234', 'abcd']) expect(validateParticipantPassword(ok)).toBeUndefined();
    expect(validateParticipantPassword('')).toBe('Enter a password.');
    expect(validateParticipantPassword('abc')).toMatch(/You entered 3/);
    expect(validateParticipantPassword('ab c')).toMatch(/Spaces and symbols/);
    expect(validateParticipantPassword('ab!c')).toMatch(/Spaces and symbols/);
  });

  it('checks every field and allows a blank PRN', () => {
    const errors = validateNewParticipant({ name: 'R', email: 'nope', prn: '12', department: '', academicYear: '', competitionId: '', password: 'abc' });
    expect(Object.keys(errors).sort()).toEqual(['academicYear', 'department', 'email', 'name', 'password', 'prn']);
    expect(validateNewParticipant({ name: 'Riya', email: 'r@gmail.com', prn: '', department: 'IT', academicYear: 'SE', competitionId: '', password: 'Ab12' })).toEqual({});
  });

  it('generates valid passwords', () => {
    for (let i = 0; i < 50; i += 1) expect(generateParticipantPassword()).toMatch(/^[A-Za-z0-9]{4}$/);
  });
});

describe('AddParticipantForm', () => {
  beforeEach(() => {
    vi.mocked(participantService.assignableCompetitions).mockReset().mockResolvedValue([{ id: 'c1', name: 'Avengers Maths Sprint', status: 'WAITING' }]);
    vi.mocked(participantService.create).mockReset();
  });

  async function fill() {
    await userEvent.type(screen.getByLabelText('Participant name'), 'Riya Mehta');
    await userEvent.type(screen.getByLabelText('Email address'), 'riya.mehta03@gmail.com');
    await userEvent.type(screen.getByLabelText('Department / branch'), 'Computer Engineering');
    await userEvent.selectOptions(screen.getByLabelText('Year of study'), 'FE');
  }

  it('blocks submission until the password is exactly 4 characters', async () => {
    render(<AddParticipantForm defaultCompetitionId="c1" onCreated={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /Avengers Maths Sprint/ });
    await fill();
    await userEvent.type(screen.getByLabelText('Initial password'), 'ab!');
    await userEvent.click(screen.getByRole('button', { name: 'Create participant' }));
    expect(await screen.findByText(/must be exactly 4 letters or numbers/)).toBeInTheDocument();
    expect(participantService.create).not.toHaveBeenCalled();
  });

  it('creates the participant, shows success without the password, and resets the form', async () => {
    vi.mocked(participantService.create).mockResolvedValue({
      participant: { _id: 's1', role: 'student', name: 'Riya Mehta', prn: 'MHABCDEFGH', email: 'riya.mehta03@gmail.com', department: 'Computer Engineering', academicYear: 'FE', createdAt: '' },
      competition: { id: 'c1', name: 'Avengers Maths Sprint' },
      generatedPrn: true,
    });
    const onCreated = vi.fn();
    render(<AddParticipantForm defaultCompetitionId="c1" onCreated={onCreated} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /Avengers Maths Sprint/ });
    expect(screen.getByLabelText('Competition')).toHaveValue('c1');
    await fill();
    await userEvent.type(screen.getByLabelText('Initial password'), 'Ab12');
    await userEvent.click(screen.getByRole('button', { name: 'Create participant' }));

    expect(await screen.findByText('Participant account created')).toBeInTheDocument();
    expect(participantService.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'riya.mehta03@gmail.com', password: 'Ab12', competitionId: 'c1', academicYear: 'FE' }));
    expect(onCreated).toHaveBeenCalled();
    expect(screen.getByText('MHABCDEFGH')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Ab12');
    expect(screen.getByLabelText('Initial password')).toHaveValue('');
  });

  it('shows a duplicate-email error on the email field', async () => {
    vi.mocked(participantService.create).mockRejectedValue(new ApiError('An account with this email already exists.', 409, 'CONFLICT', { field: 'email' }));
    render(<AddParticipantForm defaultCompetitionId="" onCreated={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /Avengers Maths Sprint/ });
    await fill();
    await userEvent.type(screen.getByLabelText('Initial password'), 'Ab12');
    await userEvent.click(screen.getByRole('button', { name: 'Create participant' }));
    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
  });

  it('does not preselect a competition the host cannot add to', async () => {
    render(<AddParticipantForm defaultCompetitionId="finished" onCreated={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /Avengers Maths Sprint/ });
    await waitFor(() => expect(screen.getByLabelText('Competition')).toHaveValue(''));
  });
});

describe('ResetPasswordDialog', () => {
  const target = { studentId: 's1', name: 'Riya Mehta', email: 'riya.mehta03@gmail.com' };
  beforeEach(() => {
    // Braces matter: a function returned from beforeEach is run as a teardown hook.
    vi.mocked(participantService.resetPassword).mockReset();
  });

  it('validates, saves and confirms the reset', async () => {
    vi.mocked(participantService.resetPassword).mockResolvedValue({ reset: true });
    render(<ResetPasswordDialog competitionId="c1" target={target} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('New password'), 'Zz9');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText(/You entered 3/)).toBeInTheDocument();
    expect(participantService.resetPassword).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('New password'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Password reset')).toBeInTheDocument();
    expect(participantService.resetPassword).toHaveBeenCalledWith('c1', 's1', 'Zz99');
  });

  it('shows the server error when the reset is refused', async () => {
    vi.mocked(participantService.resetPassword).mockRejectedValue(new ApiError('Only the host who created this competition can view its participants.', 403, 'FORBIDDEN'));
    render(<ResetPasswordDialog competitionId="c1" target={target} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('New password'), 'Zz99');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Password not changed')).toBeInTheDocument();
    expect(screen.getByText('Only the host who created this competition can view its participants.')).toBeInTheDocument();
    expect(screen.queryByText('Password reset')).not.toBeInTheDocument();
  });
});
