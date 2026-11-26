import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonChip } from '../person-chip';
import { getInitials } from '../avatar';

describe('PersonChip', () => {
  it('zeigt Initialen und Namen und ruft onRemove über den ×-Button', async () => {
    const onRemove = vi.fn();
    render(<PersonChip name="Anna Schulz" onRemove={onRemove} />);
    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.getByText('Anna Schulz')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Anna Schulz entfernen' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('hat ohne onRemove keinen Entfernen-Button', () => {
    render(<PersonChip name="Lea Wagner" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('getInitials', () => {
  it.each([
    ['Anna Schulz', 'AS'],
    ['Mehmet Aydın', 'MA'],
    ['Hans-Peter Müller', 'HM'],
    ['Lea', 'LE'],
    ['  ', ''],
  ])('%s -> %s', (name, expected) => {
    expect(getInitials(name)).toBe(expected);
  });
});
