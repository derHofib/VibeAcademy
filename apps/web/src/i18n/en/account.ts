import type { AccountStrings } from '../account';
import type { ExternalAccountStrings } from '../external';
import { PASSWORD_MIN_LENGTH } from '@sn/shared';

/** „4 minutes“, „1 hour“ – rounded up, like formatWaitDe. */
function formatWaitEn(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return s === 1 ? '1 second' : `${s} seconds`;
  const m = Math.ceil(s / 60);
  if (m < 60) return m === 1 ? '1 minute' : `${m} minutes`;
  const h = Math.ceil(m / 60);
  return h === 1 ? '1 hour' : `${h} hours`;
}

/** English texts for “My records” (E-39). Register/login stay German (shared with the admin sign-up, E-39). */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Register/login/nav are taken over from German in account.ts */
export const taEn: Omit<AccountStrings, 'register' | 'login' | 'nav'> = {

  page: {
    title: 'My records',
    eyebrow: (name: string) => name,
    greeting: (first: string | null) => (first ? `Hello ${first}!` : 'Hello!'),
    intro: 'Here you will find your trainings and records from all companies your account is linked to.',
    stats: {
      done: 'done',
      open: 'open',
      expiring: (n: number) => plural(n, 'expires soon', 'expire soon'),
    },
    toAdmin: 'To administration',
    logout: 'Sign out',
    loading: 'Loading records …',
    loadError: 'Your records could not be loaded.',
    retry: 'Try again',
  },

  groups: {
    open: 'Open',
    openHint: 'These trainings are still waiting for you.',
    done: 'Done',
  },

  empty: {
    title: 'No records yet',
    text: 'As soon as your account is linked to an invitation, your trainings appear here. Link them below via your e-mail address.',
  },

  status: {
    offen: 'New',
    geoeffnet: 'Started',
    gelesen: 'Read',
    bestanden: 'Signature missing',
    ueberfaellig: 'Overdue',
    befreit: 'Exempt',
    bestaetigt: 'Done',
  } as Record<string, string>,

  card: {
    version: (n: number) => `Version ${n}`,
    versionLabel: 'Version',
    continue: 'Continue',
    continueAria: (title: string) => `Continue: ${title}`,
    nr: 'Record no.',
    completedAt: 'Completed on',
    validUntil: 'Valid until',
    daysLeft: (n: number) => (n <= 0 ? 'today' : `${n} ${plural(n, 'day', 'days')} left`),
    valid: 'Valid',
    expiring: 'Expires soon',
    expired: 'Expired',
    exempt: 'Exempt',
    exemptText: 'You are exempt from this training – there is no record.',
    download: 'Download record',
    downloadAria: (title: string) => `Download record: ${title}`,
    verify: 'Verify authenticity',
    verifyAria: (title: string) => `Verify authenticity: ${title}`,
    pending: 'Creating record …',
    failed: 'The record is still being created. Please check back later.',
  },

  link: {
    title: 'Link more records',
    intro: 'Did you take trainings at other companies? We look for invitations sent to your e-mail address.',
    verifyTitle: 'Confirm your e-mail address first',
    verifyText: (email: string) => `We will send a 6-digit code to ${email}.`,
    requestCode: 'Send code',
    codeLabel: 'Code from your e-mail',
    codePlaceholder: '6-digit code',
    codeSent: 'The code is on its way – please check your inbox.',
    resend: 'Send code again',
    confirmCode: 'Confirm',
    codeInvalid: 'Please enter the 6-digit code.',
    verified: 'E-mail address confirmed',
    candidatesLoading: 'Searching for entries …',
    noCandidates: 'No further entries with your e-mail address found.',
    allLinked: 'All entries with your e-mail address are linked.',
    linkedChip: 'Linked',
    listLabel: 'Entries found',
    consent: 'Only people with your confirmed e-mail address. The organisations do not see anything additional as a result.',
    submit: 'Link selection',
    submitCount: (n: number) => (n ? `Link ${n} ${plural(n, 'entry', 'entries')}` : 'Link selection'),
    selectFirst: 'Select at least one entry.',
    linked: (n: number) => `${n} ${plural(n, 'entry', 'entries')} linked.`,
    linkedNone: 'Nothing new was linked.',
  },

  account: {
    title: 'Account',
    emailVerified: 'confirmed',
    emailUnverified: 'not confirmed',
    delete: 'Delete account',
  },

  password: {
    title: 'Change password',
    intro: 'After the change you will be signed out on all other devices.',
    current: 'Current password',
    next: 'New password',
    repeat: 'Repeat new password',
    hint: `At least ${PASSWORD_MIN_LENGTH} characters.`,
    submit: 'Change password',
    saving: 'Saving …',
    success: 'Password changed. Other devices have been signed out.',
    required: 'Please fill in',
    tooShort: `The password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
    mismatch: 'The passwords do not match',
    wrongCurrent: 'The current password is incorrect',
    sameAsOld: 'The new password must be different from the old one',
    locked: (seconds: number) => `Too many failed attempts. Please try again in ${formatWaitEn(seconds)}.`,
    failed: 'The password could not be changed. Please try again later.',
  },

  deleteSheet: {
    title: 'Delete account?',
    description: 'This cannot be undone.',
    stays: 'Your records stay with the respective company – it is legally required to keep them.',
    removed: 'Only your account and the link to your records are deleted.',
    later: 'You can still take part in trainings via your personal invitation link.',
    confirm: 'Delete account permanently',
    deleting: 'Deleting …',
    cancel: 'Cancel',
    membership: 'Your account still belongs to the administration of an organisation. Please contact its administrator.',
  },

  deleted: {
    title: 'Account deleted',
    text: 'Your account has been deleted. Your records remain with the companies you took the trainings for.',
    back: 'To sign in',
  },
};

export const txAccountEn: ExternalAccountStrings = {
  entryTitle: 'Submit an external record',
  entryText: 'First aid course, forklift licence or manufacturer training? Take a photo, check it, submit it.',
  entryAction: 'Submit record',
  submissions: 'My submissions',
  submissionsHint: 'Approved records can be found under “Done”.',
  open: (title: string) => `Open: ${title}`,
  untitled: 'External record',
  kind: { online: 'Online', praesenz: 'Classroom', live: 'Live', extern: 'External' } as Record<string, string>,
  push: {
    title: 'Notifications on this device',
    text: 'We let you know when a record is approved or returned or a deadline is approaching.',
    on: 'Notifications are active on this device.',
    denied: 'Notifications are blocked in the browser. Please allow them in the site settings.',
    unsupported: 'This browser does not support push notifications.',
    failed: 'Something went wrong. Please try again.',
    busy: 'Setting up …',
  },
};
