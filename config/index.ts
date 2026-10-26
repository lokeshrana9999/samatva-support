// Parses every config file with zod at module load, so a bad file fails
// `next build`, the tests and the eval run (design D39).
import { z } from "zod";
import crisisLinesJson from "./crisis-lines.json";
import riskKeywordsJson from "./risk-keywords.json";
import stockLinesJson from "./stock-lines.json";
import thresholdsJson from "./thresholds.json";
import limitsJson from "./limits.json";
import providersJson from "./providers.json";
import helpRulesJson from "./help-rules.json";
import { HelpRule } from "../src/core/needs";

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
    risk: z.strictObject({
      riskTurns: z.number().int().positive(),
      imminentP: z.number().min(0).max(1),
      elevatedP: z.number().min(0).max(1),
      harmNoulP: z.number().min(0).max(1),
      beingHarmedNoulP: z.number().min(0).max(1),
    }),
    replyCheckP: z.number().min(0).max(1),
    needsP: z.number().min(0).max(1),
    toolLoopMaxCalls: z.number().int().positive(),
    jevTimeoutMs: z.number().int().positive(),
    jevMaxRetries: z.number().int().min(0),
    jevDeadlineMs: z.number().int().positive(),
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
      grok: z.strictObject({ model: z.string().nullable(), timeoutMs: z.number().int().positive() }),
    }),
    jev: z.strictObject({ model: z.string() }),
  }),
  helpRules: z.array(HelpRule).min(1),
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
  helpRules: helpRulesJson,
});
