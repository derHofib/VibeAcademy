import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from '../sheet';
import { Button } from '../button';

describe('Sheet', () => {
  it('öffnet über den Trigger und schließt über „Schließen“', async () => {
    const user = userEvent.setup();
    render(
      <Sheet title="Inhalt" description="Die Erfassung pausiert." trigger={<Button>Inhalt öffnen</Button>}>
        <p>Kapitelliste</p>
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Inhalt öffnen' }));
    const dialog = screen.getByRole('dialog', { name: 'Inhalt' });
    expect(dialog).toHaveAccessibleDescription('Die Erfassung pausiert.');
    expect(screen.getByText('Kapitelliste')).toBeInTheDocument();
    // jsdom ohne matchMedia -> mobile Variante
    expect(dialog).toHaveAttribute('data-variant', 'sheet');
    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('schließt mit Escape und meldet onOpenChange', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="Frage an den Dozenten">
        <p>Formular</p>
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Frage an den Dozenten' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('nutzt auf Desktop das schwebende Panel', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('min-width: 768px'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      render(
        <Sheet defaultOpen title="Inhalt">
          <p>Panel</p>
        </Sheet>,
      );
      expect(screen.getByRole('dialog', { name: 'Inhalt' })).toHaveAttribute('data-variant', 'panel');
    } finally {
      window.matchMedia = original;
    }
  });
});
