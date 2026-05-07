#!/usr/bin/env node

import type { GitHubRepo, GitHubIssue, GitHubUser, GitHubProject, GitHubProjectItem, GitHubLabel } from "./types.js";

const GITHUB_API = "https://api.github.com";

interface GitHubApiOptions {
  token: string;
}

async function githubFetch(
  endpoint: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = endpoint.startsWith("http") ? endpoint : `${GITHUB_API}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API error ${res.status}: ${res.statusText} — ${body}`);
  }
  return res;
}

/**
 * Validate a GitHub token by fetching the authenticated user.
 * Returns user info if valid, throws if invalid.
 */
export async function validateGitHubToken(
  token: string
): Promise<{ valid: true; user: GitHubUser }> {
  const res = await githubFetch("/user", token);
  const data = (await res.json()) as Record<string, unknown>;
  return {
    valid: true,
    user: {
      login: data.login as string,
      avatar_url: data.avatar_url as string,
      html_url: data.html_url as string,
    },
  };
}

/**
 * List repositories accessible by the token.
 * Uses /user/repos with pagination support.
 */
export async function listGitHubRepos(
  token: string,
  options?: { sort?: "created" | "updated" | "pushed" | "full_name"; per_page?: number }
): Promise<GitHubRepo[]> {
  const sort = options?.sort || "updated";
  const perPage = options?.per_page || 100;
  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const res = await githubFetch(
      `/user/repos?sort=${sort}&per_page=${perPage}&page=${page}&direction=desc`,
      token
    );
    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (data.length === 0) break;

    for (const r of data) {
      repos.push({
        id: r.id as number,
        full_name: r.full_name as string,
        name: r.name as string,
        description: (r.description as string) || null,
        private: r.private as boolean,
        html_url: r.html_url as string,
        language: (r.language as string) || null,
        open_issues_count: r.open_issues_count as number,
        updated_at: r.updated_at as string,
      });
    }

    if (data.length < perPage) break;
    page++;
  }

  return repos;
}

/**
 * List issues for a specific repository.
 * Only returns actual issues (excludes PRs by default).
 */
export async function listGitHubIssues(
  token: string,
  owner: string,
  repo: string,
  options?: { state?: "open" | "closed" | "all"; per_page?: number; page?: number }
): Promise<{ issues: GitHubIssue[]; total_count?: number }> {
  const state = options?.state || "open";
  const perPage = options?.per_page || 30;
  const page = options?.page || 1;

  const res = await githubFetch(
    `/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&page=${page}&sort=updated&direction=desc`,
    token
  );
  const data = (await res.json()) as Array<Record<string, unknown>>;

  const issues: GitHubIssue[] = data
    .filter((item) => !item.pull_request) // exclude PRs
    .map((item) => ({
      id: item.id as number,
      number: item.number as number,
      title: item.title as string,
      body: (item.body as string) || null,
      state: item.state as "open" | "closed",
      html_url: item.html_url as string,
      labels: ((item.labels || []) as Array<Record<string, unknown>>).map((l) => ({
        id: l.id as number,
        name: l.name as string,
        color: l.color as string,
        description: (l.description as string) || null,
      })),
      assignees: ((item.assignees || []) as Array<Record<string, unknown>>).map((a) => ({
        login: a.login as string,
        avatar_url: a.avatar_url as string,
        html_url: a.html_url as string,
      })),
      user: {
        login: (item.user as Record<string, unknown>).login as string,
        avatar_url: (item.user as Record<string, unknown>).avatar_url as string,
        html_url: (item.user as Record<string, unknown>).html_url as string,
      },
      comments: item.comments as number,
      created_at: item.created_at as string,
      updated_at: item.updated_at as string,
      repository_url: item.repository_url as string,
    }));

  return { issues };
}

/**
 * Get a single issue by number.
 */
export async function getGitHubIssue(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<GitHubIssue> {
  const res = await githubFetch(`/repos/${owner}/${repo}/issues/${number}`, token);
  const item = (await res.json()) as Record<string, unknown>;

  return {
    id: item.id as number,
    number: item.number as number,
    title: item.title as string,
    body: (item.body as string) || null,
    state: item.state as "open" | "closed",
    html_url: item.html_url as string,
    labels: ((item.labels || []) as Array<Record<string, unknown>>).map((l) => ({
      id: l.id as number,
      name: l.name as string,
      color: l.color as string,
      description: (l.description as string) || null,
    })),
    assignees: ((item.assignees || []) as Array<Record<string, unknown>>).map((a) => ({
      login: a.login as string,
      avatar_url: a.avatar_url as string,
      html_url: a.html_url as string,
    })),
    user: {
      login: (item.user as Record<string, unknown>).login as string,
      avatar_url: (item.user as Record<string, unknown>).avatar_url as string,
      html_url: (item.user as Record<string, unknown>).html_url as string,
    },
    comments: item.comments as number,
    created_at: item.created_at as string,
    updated_at: item.updated_at as string,
    repository_url: item.repository_url as string,
  };
}

/**
 * Extract owner and repo from a full_name like "owner/repo"
 */
export function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split("/");
  return { owner: parts[0], repo: parts[1] };
}

/**
 * GraphQL API helper for GitHub
 */
async function githubGraphQL<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub GraphQL error ${res.status}: ${res.statusText} — ${body}`);
  }
  const data = (await res.json()) as { data: T; errors?: Array<{ message: string }> };
  if (data.errors && data.errors.length > 0) {
    throw new Error(`GitHub GraphQL error: ${data.errors.map((e) => e.message).join(", ")}`);
  }
  return data.data;
}

/**
 * List GitHub Projects (v2) for the authenticated user or an org.
 * Uses the GraphQL API.
 */
export async function listGitHubProjects(
  token: string,
  options?: { owner?: string; first?: number }
): Promise<GitHubProject[]> {
  const first = options?.first || 50;
  const owner = options?.owner;

  const projectFields = `
    id
    number
    title
    shortDescription
    public
    closed
    createdAt
    updatedAt
    url
  `;

  // If owner is specified, fetch that specific user/org's projects
  if (owner) {
    const query = `
      query($login: String!, $first: Int!) {
        user(login: $login) {
          projectsV2(first: $first) {
            nodes { ${projectFields} }
          }
        }
      }
    `;
    const data = await githubGraphQL<{
      user?: { projectsV2: { nodes: Array<Record<string, unknown>> } };
    }>(query, { login: owner, first }, token);
    const nodes = data.user?.projectsV2?.nodes || [];
    return nodes.map((p) => ({
      id: p.id as string,
      number: p.number as number,
      title: p.title as string,
      short_description: (p.shortDescription as string) || null,
      public: p.public as boolean,
      closed: p.closed as boolean,
      created_at: p.createdAt as string,
      updated_at: p.updatedAt as string,
      url: p.url as string,
      owner: owner,
      items_count: 0,
    }));
  }

  // No owner specified: fetch viewer projects + org projects separately
  const viewerQuery = `
    query($first: Int!) {
      viewer {
        projectsV2(first: $first) {
          nodes { ${projectFields} }
        }
      }
    }
  `;
  const viewerData = await githubGraphQL<{
    viewer: { projectsV2: { nodes: Array<Record<string, unknown>> } };
  }>(viewerQuery, { first }, token);
  const viewerNodes = viewerData.viewer?.projectsV2?.nodes || [];

  // Try fetching org projects separately (may fail if token lacks read:org scope)
  let orgNodes: Array<Record<string, unknown>> = [];
  try {
    const orgQuery = `
      query($first: Int!) {
        viewer {
          organizations(first: 50) {
            nodes {
              login
              projectsV2(first: $first) {
                nodes { ${projectFields} }
              }
            }
          }
        }
      }
    `;
    const orgData = await githubGraphQL<{
      viewer: {
        organizations: {
          nodes: Array<{
            login: string;
            projectsV2: { nodes: Array<Record<string, unknown>> };
          }>;
        };
      };
    }>(orgQuery, { first }, token);
    orgNodes = (orgData.viewer?.organizations?.nodes || []).flatMap((org) =>
      (org.projectsV2?.nodes || []).map((p) => ({ ...p, _orgLogin: org.login }))
    );
  } catch {
    // Token may lack read:org scope — skip org projects
  }

  const allNodes = [...viewerNodes, ...orgNodes];

  return allNodes.map((p) => ({
    id: p.id as string,
    number: p.number as number,
    title: p.title as string,
    short_description: (p.shortDescription as string) || null,
    public: p.public as boolean,
    closed: p.closed as boolean,
    created_at: p.createdAt as string,
    updated_at: p.updatedAt as string,
    url: p.url as string,
    owner: (p._orgLogin as string) || "viewer",
    items_count: 0,
  }));
}

/**
 * List organizations the authenticated user belongs to.
 */
export async function listGitHubUserOrgs(token: string): Promise<Array<{ login: string; name: string | null }>> {
  const query = `
    query {
      viewer {
        organizations(first: 50) {
          nodes {
            login
            name
          }
        }
      }
    }
  `;
  const data = await githubGraphQL<{
    viewer: { organizations: { nodes: Array<{ login: string; name: string | null }> } };
  }>(query, {}, token);

  return data.viewer?.organizations?.nodes || [];
}

/**
 * List items in a GitHub Project (v2).
 * Fetches up to `first` items with their linked issue/PR content.
 */
export async function listGitHubProjectItems(
  token: string,
  projectId: string,
  options?: { first?: number }
): Promise<GitHubProjectItem[]> {
  const first = options?.first || 50;

  const query = `
    query($projectId: ID!, $first: Int!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: $first) {
            nodes {
              id
              type
              createdAt
              updatedAt
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldTextValue {
                    text
                    field { ... on ProjectV2FieldCommon { name } }
                  }
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2FieldCommon { name } }
                  }
                }
              }
              content {
                ... on Issue {
                  title
                  body
                  state
                  number
                  url
                  repository { nameWithOwner }
                  labels(first: 10) {
                    nodes {
                      id
                      name
                      color
                    }
                  }
                  assignees(first: 10) {
                    nodes { login avatarUrl url }
                  }
                }
                ... on PullRequest {
                  title
                  body
                  state
                  number
                  url
                  repository { nameWithOwner }
                  labels(first: 10) {
                    nodes {
                      id
                      name
                      color
                    }
                  }
                  assignees(first: 10) {
                    nodes { login avatarUrl url }
                  }
                }
                ... on DraftIssue {
                  title
                  body
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await githubGraphQL<{
    node: {
      items: {
        nodes: Array<Record<string, unknown>>;
      };
    };
  }>(query, { projectId, first }, token);

  const nodes = data.node?.items?.nodes || [];

  return nodes.map((item) => {
    const content = (item.content as Record<string, unknown>) || {};
    const fieldValues = ((item.fieldValues as Record<string, unknown>)?.nodes || []) as Array<Record<string, unknown>>;

    // Extract status from field values
    let status = "";
    for (const fv of fieldValues) {
      const field = fv.field as Record<string, unknown> | undefined;
      if (field?.name === "Status") {
        status = (fv.name as string) || (fv.text as string) || "";
        break;
      }
    }

    const isDraft = item.type === "DRAFT_ISSUE";

    return {
      id: item.id as string,
      type: item.type as "ISSUE" | "PULL_REQUEST" | "DRAFT_ISSUE",
      title: (content.title as string) || "",
      body: (content.body as string) || null,
      state: isDraft ? null : (content.state as string | null),
      html_url: isDraft ? null : (content.url as string | null),
      number: isDraft ? null : (content.number as number | null),
      repository: isDraft
        ? null
        : ((content.repository as Record<string, unknown>)?.nameWithOwner as string | null),
      labels: isDraft
        ? []
        : (((content.labels as Record<string, unknown>)?.nodes || []) as Array<Record<string, unknown>>).map((l) => ({
            id: l.id as number,
            name: l.name as string,
            color: l.color as string,
            description: null,
          })),
      assignees: isDraft
        ? []
        : (((content.assignees as Record<string, unknown>)?.nodes || []) as Array<Record<string, unknown>>).map((a) => ({
            login: a.login as string,
            avatar_url: a.avatarUrl as string,
            html_url: a.url as string,
          })),
      created_at: item.createdAt as string,
      updated_at: item.updatedAt as string,
      status,
    };
  });
}
