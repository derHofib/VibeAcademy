import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../button';
import { IconButton } from '../icon-button';

describe('Button', () => {
  it('rendert einen <button type="button"> und löst onClick aus', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Speichern</Button>);
    const btn = screen.getByRole('button', { name: 'Speichern' });
    expect(btn).toHaveAttribute('type', 'button');
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ist im deaktivierten Zustand nicht klickbar und nutzt die disabled-Tokens', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Verbindlich unterschreiben
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Verbindlich unterschreiben' });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('disabled:bg-disabled');
    expect(btn.className).toContain('disabled:text-disabled-text');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('rendert mit asChild das Kind-Element (Link) mit Button-Stil', () => {
    render(
      <Button asChild variant="secondary" size="lg">
        <a href="/anmelden">Zur Anmeldung</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Zur Anmeldung' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/anmelden');
    expect(link).not.toHaveAttribute('type');
    expect(link.className).toContain('rounded-pill');
    expect(link.className).toContain('h-14');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('setzt Varianten-Klassen und lässt className überschreiben', () => {
    render(
      <Button variant="dark" className="px-10">
        Schulung offiziell beenden
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-ink');
    expect(btn.className).toContain('px-10');
    expect(btn.className).not.toContain('px-5');
  });
});

describe('IconButton', () => {
  it('hat einen zugänglichen Namen über aria-label', () => {
    render(
      <IconButton aria-label="Schließen">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Schließen' })).toHaveClass('rounded-full', 'size-11');
  });
});
