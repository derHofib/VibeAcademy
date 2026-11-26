import type { DeStrings } from '../de';

/** English versions of the shared building blocks used in the participant view (E-39). */
export const deEnShared: Pick<DeStrings, 'common' | 'progress' | 'quiz' | 'ringButton'> = {
  common: {
    close: 'Close',
    remove: 'Remove',
    removeNamed: (name: string) => `Remove ${name}`,
    back: 'Back',
    menu: 'Menu',
    openMenu: 'Open menu',
    save: 'Save',
    cancel: 'Cancel',
    optional: 'optional',
    loading: 'Loading …',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
  },

  progress: {
    percent: (value: number) => `${value} %`,
    pagesCaptured: (done: number, total: number) => `${done} of ${total} pages recorded`,
    pageOf: (page: number, total: number) => `Page ${page} of ${total}`,
    pageLabel: 'Page progress',
  },

  quiz: {
    correct: 'Correct answer',
    wrong: 'Wrong answer',
  },

  ringButton: {
    counting: (seconds: number) => `Recording page, ${seconds} seconds left`,
    secondsUnit: 's',
    next: 'On to the next page',
    quiz: 'Choose an answer first',
    sign: 'On to the signature',
  },
};
