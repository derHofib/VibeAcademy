import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from '../segmented-control';

function Demo({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('einzel');
  return (
    <SegmentedControl
      aria-label="Art der Erfassung"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      options={[
        { value: 'einzel', label: 'Einzelperson' },
        { value: 'gruppe', label: 'Gruppe', count: 4 },
      ]}
    />
  );
}

describe('SegmentedControl', () => {
  it('rendert eine Radiogruppe mit aktivem Segment', () => {
    render(<Demo onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Art der Erfassung' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Einzelperson' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Gruppe 4' })).toHaveAttribute('aria-checked', 'false');
  });

  it('wählt per Tastatur: Pfeil rechts + Leertaste', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Demo onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Einzelperson' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const gruppe = screen.getByRole('radio', { name: 'Gruppe 4' });
    expect(gruppe).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('gruppe');
    expect(gruppe).toHaveAttribute('aria-checked', 'true');
    expect(gruppe).toHaveAttribute('data-state', 'on');
  });

  it('lässt das aktive Segment nicht abwählen', async () => {
    const onChange = vi.fn();
    render(<Demo onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Einzelperson' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Einzelperson' })).toHaveAttribute('aria-checked', 'true');
  });
});
