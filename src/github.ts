import { Octokit } from "@octokit/rest";
import type { EventClassification, EventCommentContext, GitHubEventContext, RepoSlug, ReviewThreadSummary } from "./types.js";

interface GraphqlReviewThreadsResponse {
  repository?: {
    pullRequest?: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        nodes: Array<{
          id: string;
          isResolved: boolean;
          comments: {
            nodes: Array<{
              author?: { login?: string | null } | null;
              body?: string | null;
              path?: string | null;
              url?: string | null;
            }>;
          };
        }>;
      };
    };
  };
}

const truncate = (value: string | undefined, limit = 500): string | undefined => {
  if (!value) return undefined;
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
};

export const parseRepoSlug = (input: string): RepoSlug => {
  const [owner, name] = input.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo slug: ${input}`);
  }
  return { owner, name };
};

export const createGitHubClient = (token: string): Octokit => new Octokit({ auth: token });

const fetchReviewThreads = async (
  octokit: Octokit,
  repo: RepoSlug,
  pullRequestNumber: number,
): Promise<readonly ReviewThreadSummary[]> => {
  const threads: ReviewThreadSummary[] = [];
  let cursor: string | null = null;
  while (true) {
    const response: GraphqlReviewThreadsResponse = await octokit.graphql(
      `query ReviewThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                comments(first: 20) {
                  nodes {
                    author { login }
                    body
                    path
                    url
                  }
                }
              }
            }
          }
        }
      }`,
      {
        owner: repo.owner,
        name: repo.name,
        number: pullRequestNumber,
        after: cursor,
      },
    );
    const reviewThreads = response.repository?.pullRequest?.reviewThreads;
    if (!reviewThreads) break;
    threads.push(
      ...reviewThreads.nodes.map((thread): ReviewThreadSummary => ({
        id: thread.id,
        isResolved: thread.isResolved,
        comments: thread.comments.nodes.map((comment) => ({
          authorLogin: comment.author?.login ?? undefined,
          body: truncate(comment.body ?? undefined, 400),
          path: comment.path ?? undefined,
          url: comment.url ?? undefined,
        })),
      })),
    );
    if (!reviewThreads.pageInfo.hasNextPage) break;
    cursor = reviewThreads.pageInfo.endCursor ?? null;
  }
  return threads;
};

const fetchPullRequestFiles = async (
  octokit: Octokit,
  repo: RepoSlug,
  pullRequestNumber: number,
): Promise<readonly string[]> => {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: repo.owner,
    repo: repo.name,
    pull_number: pullRequestNumber,
    per_page: 100,
  });
  return files.slice(0, 20).map((file) => {
    const patchPreview = truncate(file.patch ?? undefined, 240);
    return patchPreview ? `${file.filename}\n${patchPreview}` : file.filename;
  });
};

const commentContext = (payload: Record<string, unknown>): EventCommentContext | undefined => {
  const comment = payload.comment as { body?: unknown; html_url?: unknown; user?: { login?: unknown } } | undefined;
  if (!comment) return undefined;
  return {
    body: typeof comment.body === "string" ? comment.body : undefined,
    url: typeof comment.html_url === "string" ? comment.html_url : undefined,
    authorLogin: typeof comment.user?.login === "string" ? comment.user.login : undefined,
  };
};

export const fetchEventContext = async (
  octokit: Octokit,
  repo: RepoSlug,
  classification: EventClassification,
  payload: Record<string, unknown>,
): Promise<GitHubEventContext> => {
  const base: GitHubEventContext = {
    repo,
    trigger: classification.trigger,
    issueNumber: classification.issueNumber,
    pullRequestNumber: classification.pullRequestNumber,
    comment: commentContext(payload),
  };

  if (classification.pullRequestNumber) {
    const pull = await octokit.rest.pulls.get({
      owner: repo.owner,
      repo: repo.name,
      pull_number: classification.pullRequestNumber,
    });
    const unresolvedReviewThreads = await fetchReviewThreads(octokit, repo, classification.pullRequestNumber);
    return {
      ...base,
      pullRequestTitle: pull.data.title,
      pullRequestBody: truncate(pull.data.body ?? undefined, 4000),
      pullRequestUrl: pull.data.html_url,
      issueNumber: classification.issueNumber ?? classification.pullRequestNumber,
      issueTitle: pull.data.title,
      issueBody: truncate(pull.data.body ?? undefined, 4000),
      issueUrl: pull.data.html_url,
      pullRequestFiles: await fetchPullRequestFiles(octokit, repo, classification.pullRequestNumber),
      reviewSummary: typeof (payload.review as { body?: unknown } | undefined)?.body === "string"
        ? (payload.review as { body?: string }).body
        : undefined,
      unresolvedReviewThreads,
    };
  }

  if (classification.issueNumber) {
    const issue = await octokit.rest.issues.get({
      owner: repo.owner,
      repo: repo.name,
      issue_number: classification.issueNumber,
    });
    return {
      ...base,
      issueTitle: issue.data.title,
      issueBody: truncate(issue.data.body ?? undefined, 4000),
      issueUrl: issue.data.html_url,
    };
  }

  return base;
};

export const createIssueComment = async (
  octokit: Octokit,
  repo: RepoSlug,
  issueNumber: number,
  body: string,
): Promise<void> => {
  await octokit.rest.issues.createComment({
    owner: repo.owner,
    repo: repo.name,
    issue_number: issueNumber,
    body,
  });
};

export const upsertStickyComment = async (
  octokit: Octokit,
  repo: RepoSlug,
  issueNumber: number,
  marker: string,
  body: string,
): Promise<void> => {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: repo.owner,
    repo: repo.name,
    issue_number: issueNumber,
    per_page: 100,
  });
  const existing = comments.find((comment) => comment.body?.includes(marker));
  const nextBody = `${marker}\n\n${body}`;
  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: repo.owner,
      repo: repo.name,
      comment_id: existing.id,
      body: nextBody,
    });
    return;
  }
  await createIssueComment(octokit, repo, issueNumber, nextBody);
};
