import { render, screen } from '@testing-library/react';
import { ProgressRing, SegmentProgress } from '../progress';

describe('ProgressRing', () => {
  it('meldet den Wert als progressbar (aria-valuenow in Prozent)', () => {
    render(<ProgressRing value={0.43} label="Gesamtfortschritt" />);
    const ring = screen.getByRole('progressbar', { name: 'Gesamtfortschritt' });
    expect(ring).toHaveAttribute('aria-valuenow', '43');
    expect(ring).toHaveAttribute('aria-valuemin', '0');
    expect(ring).toHaveAttribute('aria-valuemax', '100');
    expect(ring).toHaveAttribute('aria-valuetext', '43 %');
  });

  it('begrenzt Werte auf 0–100', () => {
    const { rerender } = render(<ProgressRing value={1.7} label="Ring" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressRing value={-1} label="Ring" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('ist ohne Label dekorativ und rendert den Inhalt in der Mitte', () => {
    render(
      <ProgressRing value={0.5} size={72} stroke={5}>
        <span>5</span>
      </ProgressRing>,
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});

describe('SegmentProgress', () => {
  it('zählt vollständige Seiten und markiert die aktuelle', () => {
    const { container } = render(<SegmentProgress segments={[1, 1, 0.4, 0]} current={2} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '4');
    expect(bar).toHaveAttribute('aria-valuetext', '2 von 4 Seiten erfasst');
    expect(container.querySelectorAll('[role=progressbar] > span')).toHaveLength(4);
  });
});
