// Parses every config file with zod at module load, so a bad file fails
// `next build`, the tests and the eval run (design D39).
import { z } from "zod";
import crisisLinesJson from "./crisis-lines.json";
import riskKeywordsJson from "./risk-keywords.json";
import stockLinesJson from "./stock-lines.json";
import thresholdsJson from "./thresholds.json";
import limitsJson from "./limits.json";
import providersJson from "./providers.json";

const Lang = z.enum(["en-IN", "hi-Latn"]);
const ByLang = z.record(Lang, z.string().min(1));

const CrisisLineEntry = z.strictObject({
  id: z.string(),
  label: z.string(),
  number: z.string(),
  telHref: z.string().startsWith("tel:"),
  note: z.string(),
  sourceUrl: z.url(),
  checkedAt: z.iso.date(),
  when: z.enum(["always", "being_harmed"]),
});

const Pattern = z.strictObject({
  id: z.string(),
  lang: z.enum(["en", "hi"]),
  tier: z.enum(["elevated", "imminent"]),
  beingHarmed: z.boolean().optional(),
  pattern: z.string(),
});

const ConfigSchema = z.strictObject({
  crisisLines: z.array(CrisisLineEntry).min(1),
  riskKeywords: z.strictObject({
    exclusions: z.array(z.strictObject({ id: z.string(), pattern: z.string() })),
    patterns: z.array(Pattern).min(1),
  }),
  stockLines: z.strictObject({
    handoffSentence: ByLang,
    handoffFollowUp: ByLang,
    byReason: z.strictObject({
      diagnosis: ByLang,
      medical: ByLang,
      claims_human: ByLang,
    }),
    byStage: z.strictObject({
      understand: ByLang,
      recommend: ByLang,
      close: ByLang,
    }),
    limits: z.strictObject({
      conversation_turns: ByLang,
      daily_conversations: ByLang,
      hourly_turns: ByLang,
      spend: ByLang,
    }),
  }),
  thresholds: z.strictObject({
    understandMaxTurns: z.number().int().positive(),
    lengthCaps: z.strictObject({
      understand: z.number().int().positive(),
      recommend: z.number().int().positive(),
      close: z.number().int().positive(),
    }),
    historyWindow: z.number().int().positive(),
  }),
  limits: z.strictObject({
    conversationTurns: z.number().int().positive(),
    messageCodePoints: z.number().int().positive(),
    maxMessages: z.number().int().positive(),
    loginDays: z.number().int().positive(),
    turnDeadlineMs: z.number().int().positive(),
  }),
  providers: z.strictObject({
    chat: z
      .array(
        z.strictObject({
          id: z.enum(["openrouter", "google", "alibaba"]),
          model: z.string(),
          timeoutMs: z.number().int().positive(),
        }),
      )
      .min(1),
    localCli: z.strictObject({
      claude: z.strictObject({ model: z.string(), timeoutMs: z.number().int().positive() }),
    }),
    jev: z.strictObject({ model: z.string() }),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type CrisisLineConfig = z.infer<typeof CrisisLineEntry>;

export const config: Config = ConfigSchema.parse({
  crisisLines: crisisLinesJson,
  riskKeywords: riskKeywordsJson,
  stockLines: stockLinesJson,
  thresholds: thresholdsJson,
  limits: limitsJson,
  providers: providersJson,
});
