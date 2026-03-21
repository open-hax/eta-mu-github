import type { EtaMuConfig } from "./types.js";

const splitCsv = (value: string | undefined, fallback: readonly string[]): readonly string[] => {
  if (!value) return fallback;
  const items = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
};

export const normalizeLogin = (login: string | undefined): string | undefined => login?.trim().toLowerCase();

export const loadConfig = (): EtaMuConfig => ({
  reviewActors: splitCsv(process.env.ETA_MU_REVIEW_ACTORS, ["coderabbitai", "app/coderabbitai"]),
  mentionTokens: splitCsv(process.env.ETA_MU_MENTION_TOKENS, ["@eta-mu", "@app/eta-mu"]),
  ignoreLogins: splitCsv(process.env.ETA_MU_IGNORE_LOGINS, ["github-actions[bot]", "app/eta-mu"]),
  appLogin: process.env.ETA_MU_LOGIN ?? "app/eta-mu",
  modelProvider: process.env.ETA_MU_MODEL_PROVIDER || undefined,
  modelId: process.env.ETA_MU_MODEL_ID || undefined,
});
