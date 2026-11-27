import { createBrowserRouter } from 'react-router';
import { LoginRoute } from '@/pages/auth/LoginPage';
import { RegisterRoute } from '@/pages/auth/RegisterPage';

export const router = createBrowserRouter([
  { path: '/', lazy: async () => ({ Component: (await import('@/features/auth/HomeRedirect')).default }) },
  { path: '/anmelden', element: <LoginRoute /> },
  { path: '/registrieren', element: <RegisterRoute /> },
  // Phase 3 (E-36): Rückkehr von der Anmeldung mit Firmenkonto
  { path: '/anmelden/sso', lazy: async () => ({ Component: (await import('@/pages/sso/SsoLandingPage')).default }) },
  { path: '/passwort-festlegen', lazy: async () => ({ Component: (await import('@/pages/auth/SetPasswordPage')).default }) },
  // Verwaltung (Phase 1, Schritte 1.11/1.12) – Anmeldung erforderlich, lazy geladen
  {
    path: '/verwaltung',
    lazy: async () => ({ Component: (await import('@/features/admin/AdminShell')).default }),
    children: [
      { index: true, lazy: async () => ({ Component: (await import('@/pages/admin/DashboardPage')).default }) },
      { path: 'schulungen', lazy: async () => ({ Component: (await import('@/pages/admin/TrainingsPage')).default }) },
      { path: 'schulungen/neu', lazy: async () => ({ Component: (await import('@/pages/admin/TrainingWizardPage')).default }) },
      { path: 'schulungen/:id/einstellungen', lazy: async () => ({ Component: (await import('@/pages/admin/TrainingSettingsPage')).default }) },
      { path: 'schulungen/:id', lazy: async () => ({ Component: (await import('@/pages/admin/TrainingWizardPage')).default }) },
      { path: 'durchfuehrungen/:id', lazy: async () => ({ Component: (await import('@/pages/admin/RunDetailPage')).default }) },
      { path: 'nachweise/:invitationId', lazy: async () => ({ Component: (await import('@/pages/admin/EvidenceReportPage')).default }) },
      { path: 'termine', lazy: async () => ({ Component: (await import('@/pages/presence/TerminePage')).default }) },
      { path: 'personen', lazy: async () => ({ Component: (await import('@/pages/admin/PersonsPage')).default }) },
      { path: 'einstellungen', lazy: async () => ({ Component: (await import('@/pages/admin/SettingsPage')).default }) },
      // Phase 3 (E-37): REST-API-Schlüssel und Webhooks
      { path: 'schnittstellen', lazy: async () => ({ Component: (await import('@/pages/integrations/IntegrationsPage')).default }) },
      // Phase 2: externe Nachweise (2.10) und Pflichtmatrix (2.9)
      { path: 'extern', lazy: async () => ({ Component: (await import('@/pages/external/ExternalQueuePage')).default }) },
      { path: 'extern/neu', lazy: async () => ({ Component: (await import('@/pages/external/ExternalCapturePage')).default }) },
      { path: 'pflichtmatrix', lazy: async () => ({ Component: (await import('@/pages/matrix/MatrixPage')).default }) },
    ],
  },
  // Präsenz-/Live-Termine (Phase 2, Schritte 2.8/2.11/2.12): Vollbild-Ansichten ohne Seitenleiste
  { path: '/verwaltung/termine/:id', lazy: async () => ({ Component: (await import('@/pages/live/OrganizerLivePage')).default }) },
  { path: '/verwaltung/termine/:id/kiosk', lazy: async () => ({ Component: (await import('@/pages/presence/KioskPage')).default }) },
  { path: '/verwaltung/termine/:id/aushang', lazy: async () => ({ Component: (await import('@/pages/presence/PrintPage')).default }) },
  { path: '/teilnahme/:id/live', lazy: async () => ({ Component: (await import('@/pages/live/ParticipantLivePage')).default }) },
  { path: '/q/:token', lazy: async () => ({ Component: (await import('@/pages/live/QrLinkPage')).default }) },
  // Teilnehmersicht (Phase 1, Schritte 1.13–1.16) und öffentliche Prüfseite, lazy geladen
  { path: '/s/:token', lazy: async () => ({ Component: (await import('@/pages/participant/OpenLinkPage')).default }) },
  { path: '/teilnahme/:id', lazy: async () => ({ Component: (await import('@/pages/participant/StartPage')).default }) },
  { path: '/teilnahme/:id/lesen', lazy: async () => ({ Component: (await import('@/pages/participant/ReaderPage')).default }) },
  { path: '/teilnahme/:id/wissenscheck', lazy: async () => ({ Component: (await import('@/pages/participant/QuizPage')).default }) },
  { path: '/teilnahme/:id/abschluss', lazy: async () => ({ Component: (await import('@/pages/participant/SignaturePage')).default }) },
  // „Meine Nachweise“ – optionales Teilnehmerkonto (Phase 1, Schritt 1.18, E-25)
  { path: '/konto', lazy: async () => ({ Component: (await import('@/pages/account/AccountPage')).default }) },
  { path: '/konto/geloescht', lazy: async () => ({ Component: (await import('@/pages/account/AccountDeletedPage')).default }) },
  // Externen Nachweis mobil einreichen (Phase 2, Screen 10, E-34)
  { path: '/konto/extern/neu', lazy: async () => ({ Component: (await import('@/pages/external/SubmitExternalPage')).default }) },
  { path: '/konto/extern/:id', lazy: async () => ({ Component: (await import('@/pages/external/MyExternalRecordPage')).default }) },
  { path: '/verify/:code', lazy: async () => ({ Component: (await import('@/pages/verify/VerifyPage')).default }) },
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
