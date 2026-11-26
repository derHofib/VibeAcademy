import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Stepper } from '../training/Stepper';
import { DataTable } from '../components/DataTable';

describe('Stepper', () => {
  it('markiert erledigte, aktuelle und gesperrte Schritte', () => {
    render(
      <MemoryRouter>
        <Stepper current={2} maxReachable={3} hrefFor={(s) => `/x?schritt=${s}`} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Schritte' });
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(within(items[0]!).getByRole('link')).toHaveAttribute('href', '/x?schritt=1');
    expect(items[0]).toHaveTextContent('Grunddaten – erledigt');
    expect(within(items[1]!).queryByRole('link')).toBeNull();
    expect(items[1]!.querySelector('[aria-current="step"]')).toHaveTextContent('Dokument & Regeln');
    expect(within(items[2]!).getByRole('link')).toHaveAttribute('href', '/x?schritt=3');
    expect(within(items[3]!).queryByRole('link')).toBeNull();
    expect(items[3]).toHaveTextContent('noch nicht verfügbar');
  });
});

describe('DataTable', () => {
  it('rendert mobil Karten und zeigt den leeren Zustand', () => {
    const { rerender } = render(
      <DataTable
        data={[{ id: '1', name: 'Anna' }]}
        columns={[{ id: 'name', header: 'Name', cell: ({ row }) => row.original.name }]}
        label="Personen"
        getRowId={(r) => r.id}
        renderCard={(r) => <span>Karte {r.name}</span>}
        empty={<p>Leer</p>}
      />,
    );
    // jsdom ohne matchMedia → mobile Kartenansicht
    expect(screen.getByRole('list', { name: 'Personen' })).toHaveTextContent('Karte Anna');
    rerender(
      <DataTable
        data={[] as Array<{ id: string; name: string }>}
        columns={[{ id: 'name', header: 'Name', cell: ({ row }) => row.original.name }]}
        label="Personen"
        empty={<p>Leer</p>}
      />,
    );
    expect(screen.getByText('Leer')).toBeInTheDocument();
  });
});
