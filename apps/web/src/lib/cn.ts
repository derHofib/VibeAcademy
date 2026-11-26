import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** tailwind-merge kennt die eigenen Token-Namen (rounded-card, shadow-float …) nicht von selbst. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['chip', 'pill', 'input', 'box', 'card', 'card-lg', 'panel', 'sheet'],
      shadow: ['card', 'float', 'primary', 'soft', 'pill', 'dark', 'success', 'sheet'],
      font: ['heading', 'sans'],
    },
  },
});

/** Klassen zusammenführen; spätere Tailwind-Klassen überschreiben frühere. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
