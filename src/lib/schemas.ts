/**
 * Agent I/O contracts (plan.md §4.7) — locked.
 *
 * For each agent we keep BOTH:
 *   - a Zod validator (defensive re-validation, §4.3)
 *   - a JSON Schema object for Cerebras strict structured output
 *
 * Strict mode rules (pinned to Cerebras docs): every object must set
 * additionalProperties:false and list every property in `required`.
 */
import { z } from 'zod';

/**
 * Defensive string cleaner. The model occasionally emits a stray leading comma
 * or surrounding whitespace on the first element of an array (strict mode
 * constrains JSON structure, not string content). Trim it everywhere.
 */
const cleanStr = z.string().transform((s) => s.replace(/^[\s,]+/, '').trim());
const cleanStrArray = z.array(cleanStr);

/* ----------------------------- Observer ----------------------------- */
export const ObserverZod = z.object({
  observations: cleanStrArray,
  visible_systems: cleanStrArray,
  possible_signals: cleanStrArray,
  uncertainties: cleanStrArray,
  image_summary: cleanStr,
});
export type Observer = z.infer<typeof ObserverZod>;

export const ObserverJsonSchema = {
  type: 'object',
  properties: {
    observations: { type: 'array', items: { type: 'string' } },
    visible_systems: { type: 'array', items: { type: 'string' } },
    possible_signals: { type: 'array', items: { type: 'string' } },
    uncertainties: { type: 'array', items: { type: 'string' } },
    image_summary: { type: 'string' },
  },
  required: ['observations', 'visible_systems', 'possible_signals', 'uncertainties', 'image_summary'],
  additionalProperties: false,
} as const;

/* ------------------------------ Triage ------------------------------ */
export const TriageZod = z.object({
  severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']),
  confidence: z.number().min(0).max(1),
  missing_evidence: cleanStrArray,
  affected_systems: cleanStrArray,
  likely_category: z.enum([
    'availability',
    'latency',
    'data',
    'security',
    'customer_support',
    'unknown',
  ]),
  primary_hypothesis: cleanStr,
  why_now: cleanStr,
});
export type Triage = z.infer<typeof TriageZod>;

export const TriageJsonSchema = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['SEV1', 'SEV2', 'SEV3', 'SEV4'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    missing_evidence: { type: 'array', items: { type: 'string' } },
    affected_systems: { type: 'array', items: { type: 'string' } },
    likely_category: {
      type: 'string',
      enum: ['availability', 'latency', 'data', 'security', 'customer_support', 'unknown'],
    },
    primary_hypothesis: { type: 'string' },
    why_now: { type: 'string' },
  },
  required: [
    'severity',
    'confidence',
    'missing_evidence',
    'affected_systems',
    'likely_category',
    'primary_hypothesis',
    'why_now',
  ],
  additionalProperties: false,
} as const;

/* ------------------- Observer callback answer (§4.4) ------------------- */
// The Observer answers ONE focused, code-generated question by re-checking the
// screenshot. Tiny schema — not a full perception object.
export const CallbackAnswerZod = z.object({
  answer: cleanStr,
  confirmed: z.boolean(),
});
export type CallbackAnswer = z.infer<typeof CallbackAnswerZod>;

export const CallbackAnswerJsonSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confirmed: { type: 'boolean' },
  },
  required: ['answer', 'confirmed'],
  additionalProperties: false,
} as const;

/* ----------------------------- Commander ---------------------------- */
export const CommanderZod = z.object({
  incident_title: cleanStr,
  situation_summary: cleanStr,
  immediate_actions: cleanStrArray,
  owners: z.array(
    z.object({
      role: cleanStr,
      task: cleanStr,
      priority: z.enum(['P0', 'P1', 'P2']),
    }),
  ),
  customer_update: cleanStr,
  executive_summary: cleanStr,
  next_15_minutes: cleanStrArray,
});
export type Commander = z.infer<typeof CommanderZod>;

export const CommanderJsonSchema = {
  type: 'object',
  properties: {
    incident_title: { type: 'string' },
    situation_summary: { type: 'string' },
    immediate_actions: { type: 'array', items: { type: 'string' } },
    owners: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          task: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
        },
        required: ['role', 'task', 'priority'],
        additionalProperties: false,
      },
    },
    customer_update: { type: 'string' },
    executive_summary: { type: 'string' },
    next_15_minutes: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'incident_title',
    'situation_summary',
    'immediate_actions',
    'owners',
    'customer_update',
    'executive_summary',
    'next_15_minutes',
  ],
  additionalProperties: false,
} as const;

/* ----------------- Critic (STUBBED — schema only, §4.6) ----------------- */
export const CriticZod = z.object({
  approved: z.boolean(),
  risks_or_gaps: z.array(z.string()),
  recommended_edits: z.array(z.string()),
  final_grade: z.enum(['safe', 'needs_review']),
});
export type Critic = z.infer<typeof CriticZod>;

export const CriticJsonSchema = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    risks_or_gaps: { type: 'array', items: { type: 'string' } },
    recommended_edits: { type: 'array', items: { type: 'string' } },
    final_grade: { type: 'string', enum: ['safe', 'needs_review'] },
  },
  required: ['approved', 'risks_or_gaps', 'recommended_edits', 'final_grade'],
  additionalProperties: false,
} as const;
