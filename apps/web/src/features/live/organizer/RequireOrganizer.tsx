import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ShieldOff } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { hasRole } from '@/features/auth/session';
import { adm } from '@/i18n/admin';
import { tl } from '@/i18n/live';

/** Vollbild-Seiten der Terminführung brauchen ein Konto mit Organisator-/Trainerrolle. */
export function RequireOrganizer({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      {(me) =>
        hasRole(me, 'admin', 'verantwortlich', 'trainer') ? (
          children
        ) : (
          <div className="min-h-dvh bg-bg p-6">
            <Card className="mx-auto mt-10 max-w-xl">
              <EmptyState
                icon={<ShieldOff />}
                title={adm.auth.noAccessTitle}
                description={adm.auth.noAccessText}
                action={
                  <Button asChild variant="secondary">
                    <Link to="/verwaltung">{tl.common.back}</Link>
                  </Button>
                }
              />
            </Card>
          </div>
        )
      }
    </RequireAuth>
  );
}
