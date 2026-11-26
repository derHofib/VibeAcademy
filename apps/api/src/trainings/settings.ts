import { z } from 'zod';

/** Einstellungen je Schulung (SPEZIFIKATION 3/4.1/4.2, E-24). Alle Werte überschreibbar. */
export const TrainingSettings = z.object({
  wordsPerMinute: z.number().int().min(50).max(600).default(200),
  factor: z.number().min(0.1).max(1).default(0.6),
  floorSeconds: z.number().int().min(1).max(600).default(4),
  capSeconds: z.number().int().min(1).max(1800).default(90),
  strictMode: z.boolean().default(true),
  passPct: z.number().int().min(1).max(100).default(80),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  quizQuestionCount: z.number().int().min(1).max(50).default(10),
  requireStepUp: z.boolean().default(true),
  allowDownload: z.boolean().default(false),
  deadlineDays: z.number().int().min(1).max(365).default(14),
  intervalMonths: z.number().int().min(1).max(120).default(12),
  completenessPct: z.number().int().min(1).max(100).default(90),
}).refine((s) => s.floorSeconds <= s.capSeconds, { message: 'Minimum je Seite darf das Maximum nicht übersteigen', path: ['floorSeconds'] });

export type TrainingSettings = z.infer<typeof TrainingSettings>;

export function parseSettings(raw: unknown): TrainingSettings {
  return TrainingSettings.parse(raw ?? {});
}

export function readingRule(s: TrainingSettings) {
  return { wordsPerMinute: s.wordsPerMinute, factor: s.factor, floorSeconds: s.floorSeconds, capSeconds: s.capSeconds };
}
