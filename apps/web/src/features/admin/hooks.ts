import { useOutletContext } from 'react-router';
import type { Me } from '@/features/auth/session';

/** Das angemeldete Konto innerhalb von `/verwaltung/*` (aus AdminShell). */
export function useAdminMe(): Me {
  return useOutletContext<Me>();
}
