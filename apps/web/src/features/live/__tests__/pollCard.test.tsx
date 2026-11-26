import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { feedbackFrom, optionState, PollCard, type PollView } from '../participant/PollCard';

const poll: PollView = {
  id: 'p1',
  question: 'Was tust du bei einem Stromunfall zuerst?',
  options: ['Sofort mit der Herzdruckmassage beginnen', 'Den Stromkreis unterbrechen', 'Die Person vom Gerät wegziehen'],
  mode: 'wissenscheck',
  myAnswer: null,
};

describe('Kontrollfrage (Teilnehmer)', () => {
  it('Optionszustände nach der Antwort', () => {
    const fb = { mode: 'wissenscheck' as const, option: 0, correct: false, correctOption: 1, explanation: null };
    expect([0, 1, 2].map((k) => optionState(fb, k))).toEqual(['wrong', 'correct', 'dimmed']);
    expect(optionState(null, 0)).toBe('idle');
    expect([0, 1].map((k) => optionState({ mode: 'stimmungsbild', option: 1 }, k))).toEqual(['dimmed', 'selected']);
    expect(feedbackFrom({ ...poll, myAnswer: { option: 1, correct: true, correctOption: 1, explanation: 'x', late: false } }, null)).toMatchObject({ correct: true });
  });

  it('zeigt nach dem Antworten das Feedback mit Erklärung (13h)', async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn(async (option: number) => ({
      mode: 'wissenscheck' as const,
      option,
      correct: true,
      correctOption: 1,
      explanation: 'Eigenschutz zuerst – sonst wirst du selbst durchströmt.',
    }));
    render(<PollCard poll={poll} onAnswer={onAnswer} pending={false} />);
    expect(screen.getByRole('heading', { name: poll.question })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Den Stromkreis unterbrechen' }));
    expect(onAnswer).toHaveBeenCalledWith(1);
    expect(await screen.findByText(/Eigenschutz zuerst/)).toHaveTextContent('Richtig. Eigenschutz zuerst – sonst wirst du selbst durchströmt. Antwort gespeichert.');
    // zweiter Klick zählt nicht
    await user.click(screen.getByRole('button', { name: /Sofort/ }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
