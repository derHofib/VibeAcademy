import { createBrowserRouter } from 'react-router';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { de } from '@/i18n/de';

export const router = createBrowserRouter([
  { path: '/', element: <main className="p-8">{de.app.name}</main> },
  { path: '/anmelden', element: <LoginPage /> },
  { path: '/registrieren', element: <RegisterPage /> },
  // Entwicklungsseiten (Design-System), lazy geladen
  {
    path: '/dev/komponenten',
    lazy: async () => ({ Component: (await import('@/pages/dev/ComponentGallery')).default }),
  },
  {
    path: '/dev/layout-admin',
    lazy: async () => ({ Component: (await import('@/pages/dev/AdminLayoutDemo')).default }),
  },
  {
    path: '/dev/layout-teilnehmer',
    lazy: async () => ({ Component: (await import('@/pages/dev/ParticipantLayoutDemo')).default }),
  },
]);
