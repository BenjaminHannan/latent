import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkSession } from '@shared/types';

vi.mock('../../api/client', () => ({
  api: { giveKudos: vi.fn(), removeKudos: vi.fn() },
}));

import { api } from '../../api/client';
import { ActivityCard } from '../ActivityCard';
import { WeeklyBars } from '../Charts';

const session: WorkSession = {
  id: 's1',
  user: { id: 'u1', username: 'ada', displayName: 'Ada Lovelace', avatarColor: '#3366ff' },
  title: 'Morning Study Session',
  description: '',
  category: 'study',
  visibility: 'public',
  startedAt: '2026-03-10T08:00:00.000Z',
  endedAt: '2026-03-10T09:42:00.000Z',
  focusMs: 102 * 60_000,
  frameCount: 1224,
  intervalSec: 5,
  videoDurationMs: 40_000,
  localDate: '2026-03-10',
  videoUrl: '',
  thumbnailUrl: '/media/s1.jpg',
  kudos: 3,
  hasKudoed: false,
  commentCount: 2,
  createdAt: '2026-03-10T09:43:00.000Z',
};

const renderCard = (s = session) =>
  render(
    <MemoryRouter>
      <ActivityCard session={s} />
    </MemoryRouter>,
  );

describe('ActivityCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders title, stats, category chip and thumbnail fallback', () => {
    renderCard();
    expect(screen.getByText('Morning Study Session')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('1h 42m')).toBeInTheDocument();
    expect(screen.getByText('1,224')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getByText('Study', { selector: '.chip' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Morning Study Session' })).toHaveAttribute('src', '/media/s1.jpg');
    expect(screen.getByLabelText('2 comments')).toHaveAttribute('href', '/s/s1#comments');
  });

  it('toggles kudos optimistically, then settles on the server value', async () => {
    let resolve!: (v: { kudos: number; hasKudoed: boolean }) => void;
    vi.mocked(api.giveKudos).mockReturnValue(new Promise((r) => (resolve = r)));
    renderCard();
    const btn = screen.getByRole('button', { name: 'Give kudos' });
    expect(screen.getByTestId('kudos-count')).toHaveTextContent('3');

    fireEvent.click(btn);
    // Optimistic: updated before the request resolves.
    expect(screen.getByTestId('kudos-count')).toHaveTextContent('4');
    expect(screen.getByRole('button', { name: 'Remove kudos' })).toHaveClass('active');
    expect(api.giveKudos).toHaveBeenCalledWith('s1');

    resolve({ kudos: 5, hasKudoed: true });
    await waitFor(() => expect(screen.getByTestId('kudos-count')).toHaveTextContent('5'));
  });

  it('reverts kudos when the request fails', async () => {
    vi.mocked(api.giveKudos).mockRejectedValue(new Error('nope'));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Give kudos' }));
    await waitFor(() => expect(screen.getByTestId('kudos-count')).toHaveTextContent('3'));
    expect(screen.getByRole('button', { name: 'Give kudos' })).not.toHaveClass('active');
  });

  it('removes kudos when already given', async () => {
    vi.mocked(api.removeKudos).mockResolvedValue({ kudos: 2, hasKudoed: false });
    renderCard({ ...session, hasKudoed: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove kudos' }));
    expect(screen.getByTestId('kudos-count')).toHaveTextContent('2');
    await waitFor(() => expect(api.removeKudos).toHaveBeenCalledWith('s1'));
  });
});

describe('WeeklyBars', () => {
  const weeks = Array.from({ length: 12 }, (_, i) => ({
    weekStart: `2026-0${1 + Math.floor(i / 5)}-${String(1 + (i % 5) * 6).padStart(2, '0')}`,
    focusMin: i * 30,
  }));

  it('renders 12 bars with the last highlighted', () => {
    render(<WeeklyBars weeks={weeks} />);
    const bars = screen.getAllByTestId('week-bar');
    expect(bars).toHaveLength(12);
    expect(bars[11]).toHaveClass('current');
    expect(bars.filter((b) => b.classList.contains('current'))).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('12 weeks'));
  });
});
