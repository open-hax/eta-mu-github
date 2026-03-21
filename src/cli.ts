#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { classifyGithubEvent } from "./event-classifier.js";
import { createGitHubClient, createIssueComment, fetchEventContext, parseRepoSlug, upsertStickyComment } from "./github.js";
import { runEtaMuPrompt } from "./pi-agent.js";
import { findTrackedUnresolvedThreads } from "./review-gate.js";
import type { EtaMuAgentDecision } from "./types.js";
import { readFile } from "node:fs/promises";

const usage = `eta-mu commands:\n  eta-mu review-gate --repo owner/repo --pr 123\n  eta-mu classify-event --repo owner/repo --event-name issue_comment --event-path /tmp/event.json\n  eta-mu run-event --repo owner/repo --event-name issue_comment --event-path /tmp/event.json --cwd /checkout/path [--dry-run]`;

const requireArg = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
};

const getArg = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const hasFlag = (args: readonly string[], flag: string): boolean => args.includes(flag);

const readJson = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const parseDecision = (value: string): EtaMuAgentDecision => {
  const parsed = JSON.parse(value) as Partial<EtaMuAgentDecision>;
  if (parsed.shouldRespond !== true) {
    return { shouldRespond: false, mode: "noop", body: "" };
  }
  if ((parsed.mode !== "reply" && parsed.mode !== "upsert-state") || typeof parsed.body !== "string") {
    throw new Error(`Invalid eta-mu response payload: ${value}`);
  }
  return { shouldRespond: true, mode: parsed.mode, body: parsed.body };
};

const buildSystemPrompt = (): string => [
  "You are eta-mu, a concise GitHub coordination bot built on pi.",
  "You comment as a collaborator between humans, review bots, and code review agents.",
  "Never invent repository facts.",
  "Prefer short, actionable markdown.",
  "Return JSON only with shape {\"shouldRespond\":boolean,\"mode\":\"reply\"|\"upsert-state\"|\"noop\",\"body\":string}.",
].join("\n");

const buildPrompt = (context: string): string => `${context}\n\nReturn JSON only.`;

const command = process.argv[2];
const args = process.argv.slice(3);

const main = async (): Promise<void> => {
  const config = loadConfig();
  if (!command) throw new Error(usage);

  if (command === "review-gate") {
    const repo = parseRepoSlug(requireArg("--repo", getArg(args, "--repo")));
    const pr = Number.parseInt(requireArg("--pr", getArg(args, "--pr")), 10);
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN or GH_TOKEN is required");
    const octokit = createGitHubClient(token);
    const context = await fetchEventContext(octokit, repo, {
      trigger: "pr-activity",
      shouldRun: true,
      reason: "review gate",
      pullRequestNumber: pr,
      issueNumber: pr,
      debounceKey: `${repo.owner}/${repo.name}:pr:${pr}`,
    }, {});
    const result = findTrackedUnresolvedThreads(context.unresolvedReviewThreads ?? [], config.reviewActors);
    console.log(JSON.stringify({
      repo: `${repo.owner}/${repo.name}`,
      pullRequestNumber: pr,
      trackedActors: result.trackedActors,
      unresolvedThreads: result.unresolvedThreads.length,
    }, null, 2));
    if (result.unresolvedThreads.length > 0) {
      throw new Error(`Unresolved tracked review threads: ${result.unresolvedThreads.length}`);
    }
    return;
  }

  if (command === "classify-event") {
    const repo = requireArg("--repo", getArg(args, "--repo"));
    const eventName = requireArg("--event-name", getArg(args, "--event-name"));
    const eventPath = requireArg("--event-path", getArg(args, "--event-path"));
    const payload = await readJson(eventPath);
    const classification = classifyGithubEvent(eventName, payload, config, repo);
    console.log(JSON.stringify(classification, null, 2));
    return;
  }

  if (command === "run-event") {
    const repo = parseRepoSlug(requireArg("--repo", getArg(args, "--repo")));
    const eventName = requireArg("--event-name", getArg(args, "--event-name"));
    const eventPath = requireArg("--event-path", getArg(args, "--event-path"));
    const cwd = requireArg("--cwd", getArg(args, "--cwd"));
    const payload = await readJson(eventPath);
    const classification = classifyGithubEvent(eventName, payload, config, `${repo.owner}/${repo.name}`);
    console.log(JSON.stringify({ phase: "classify", classification }, null, 2));
    if (!classification.shouldRun) return;
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN or GH_TOKEN is required");
    const octokit = createGitHubClient(token);
    const context = await fetchEventContext(octokit, repo, classification, payload);
    const decisionJson = await runEtaMuPrompt(
      cwd,
      buildSystemPrompt(),
      buildPrompt(JSON.stringify({ classification, context }, null, 2)),
      config.modelProvider,
      config.modelId,
    );
    const decision = parseDecision(decisionJson);
    console.log(JSON.stringify({ phase: "decide", decision }, null, 2));
    if (!decision.shouldRespond || hasFlag(args, "--dry-run")) return;
    const targetIssue = context.issueNumber ?? context.pullRequestNumber;
    if (!targetIssue) {
      throw new Error("No issue or pull request number available for commenting");
    }
    if (decision.mode === "upsert-state") {
      await upsertStickyComment(octokit, repo, targetIssue, "<!-- eta-mu:state -->", decision.body);
      return;
    }
    await createIssueComment(octokit, repo, targetIssue, decision.body);
    return;
  }

  throw new Error(usage);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
