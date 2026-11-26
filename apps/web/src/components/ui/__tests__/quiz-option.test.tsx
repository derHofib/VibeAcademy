import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuizOption } from '../quiz-option';

describe('QuizOption', () => {
  it('idle: aria-pressed=false und klickbar', async () => {
    const onClick = vi.fn();
    render(<QuizOption onClick={onClick}>Freischalten</QuizOption>);
    const btn = screen.getByRole('button', { name: 'Freischalten' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).not.toHaveAttribute('aria-disabled');
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('selected: aria-pressed=true', () => {
    render(<QuizOption state="selected">Freischalten</QuizOption>);
    expect(screen.getByRole('button', { name: 'Freischalten' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('correct: Name enthält „Richtige Antwort“, gewählt -> aria-pressed=true, gesperrt', async () => {
    const onClick = vi.fn();
    render(
      <QuizOption state="correct" picked onClick={onClick}>
        Freischalten
      </QuizOption>,
    );
    const btn = screen.getByRole('button', { name: 'Freischalten, Richtige Antwort' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('correct, aber nicht gewählt: aria-pressed=false', () => {
    render(<QuizOption state="correct">Freischalten</QuizOption>);
    expect(screen.getByRole('button', { name: /Richtige Antwort/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('wrong: Name enthält „Falsche Antwort“ und aria-pressed=true', () => {
    render(<QuizOption state="wrong">Erden und kurzschließen</QuizOption>);
    const btn = screen.getByRole('button', { name: 'Erden und kurzschließen, Falsche Antwort' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('dimmed: nicht gedrückt, gesperrt, ohne Bewertungstext', () => {
    render(<QuizOption state="dimmed">Benachbarte Teile abdecken</QuizOption>);
    const btn = screen.getByRole('button', { name: 'Benachbarte Teile abdecken' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('data-state', 'dimmed');
  });
});
