import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/services/apiClient';
import type { ParticipantView } from '../../src/types';

vi.mock('../../src/services/participantService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/participantService')>();
  return { ...actual, participantService: { list: vi.fn(), exportXlsx: vi.fn() } };
});

const { participantService, participantQuery } = await import('../../src/services/participantService');
const { ParticipantsPage } = await import('../../src/pages/ParticipantsPage');

const view: ParticipantView = {
  competition: {
    id: 'c1',
    name: 'Endgame Cup',
    status: 'RUNNING',
    durationSeconds: 1800,
    questionCount: 3,
    startedAt: '2026-10-28T09:00:00Z',
    endsAt: '2026-10-28T09:30:00Z',
    completedAt: null,
  },
  rows: [
    {
      studentId: 's1', name: 'Alice Kale', email: 'alice@gmail.com', prn: 'PRN0001', department: 'Computer Engineering', academicYear: 'SE',
      status: 'PLAYING', online: true, registeredAt: null, joinedAt: '2026-10-28T08:55:00Z', lastSeenAt: null,
      rank: 1, totalPoints: 20, correct: 2, answered: 2, accuracy: 1, avgCorrectResponseMs: 4000, completedAt: null,
    },
    {
      studentId: 's2', name: 'Bob Shah', email: 'bob@gmail.com', prn: 'PRN0002', department: 'Mechanical', academicYear: 'TE',
      status: 'DISCONNECTED', online: false, registeredAt: null, joinedAt: '2026-10-28T08:56:00Z', lastSeenAt: null,
      rank: 2, totalPoints: 0, correct: 0, answered: 0, accuracy: null, avgCorrectResponseMs: null, completedAt: null,
    },
  ],
  counts: { REGISTERED: 0, JOINED: 0, PLAYING: 1, DISCONNECTED: 1, COMPLETED: 0, CANCELLED: 0, total: 2 },
  departments: ['Computer Engineering', 'Mechanical'],
  generatedAt: '2026-10-28T09:05:00Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/host/competitions/c1/participants']}>
      <Routes>
        <Route path="/host/competitions/:id/participants" element={<ParticipantsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('participantQuery', () => {
  it('sends only the filters that are set', () => {
    expect(participantQuery({}).toString()).toBe('');
    expect(participantQuery({ search: '  bob ', status: 'PLAYING', includeRegistered: true }).toString()).toBe('search=bob&status=PLAYING&includeRegistered=true');
  });
});

describe('ParticipantsPage', () => {
  beforeEach(() => {
    vi.mocked(participantService.list).mockReset().mockResolvedValue(view);
    vi.mocked(participantService.exportXlsx).mockReset().mockResolvedValue(undefined);
  });

  it('shows real participant rows with their status, email and year', async () => {
    renderPage();
    expect(await screen.findByText('Alice Kale')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('bob@gmail.com')).toBeInTheDocument();
    expect(table.getByText('Playing')).toBeInTheDocument();
    expect(table.getByText('Disconnected')).toBeInTheDocument();
    expect(table.getByText('TE')).toBeInTheDocument();
    expect(participantService.list).toHaveBeenCalledWith('c1', expect.objectContaining({ includeRegistered: false }));
  });

  it('sends search and filters to the server and exports with the same filters', async () => {
    renderPage();
    await screen.findByText('Alice Kale');
    await userEvent.type(screen.getByLabelText('Search'), 'alice');
    await userEvent.selectOptions(screen.getByLabelText('Year of study'), 'SE');
    await waitFor(() =>
      expect(participantService.list).toHaveBeenLastCalledWith('c1', expect.objectContaining({ search: 'alice', academicYear: 'SE' })),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
    expect(participantService.exportXlsx).toHaveBeenCalledWith('c1', expect.objectContaining({ search: 'alice', academicYear: 'SE' }));
  });

  it('refreshes on demand', async () => {
    renderPage();
    await screen.findByText('Alice Kale');
    const calls = vi.mocked(participantService.list).mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(vi.mocked(participantService.list).mock.calls.length).toBe(calls + 1));
  });

  it('shows the server refusal when the host does not own the competition', async () => {
    vi.mocked(participantService.list).mockRejectedValue(new ApiError('Only the host who created this competition can view its participants.', 403, 'FORBIDDEN'));
    renderPage();
    expect(await screen.findByText(/Only the host who created this competition/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export to Excel' })).not.toBeInTheDocument();
  });
});
