#!/usr/bin/env node

import type { GitHubRepo, GitHubIssue, GitHubUser } from "./types.js";

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
