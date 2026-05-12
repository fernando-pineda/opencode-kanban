#!/usr/bin/env node

import type {
  JiraProject,
  JiraIssue,
  JiraUser,
  JiraStatus,
  JiraPriority,
  JiraIssueType,
} from "./types.js";

// ── JIRA Cloud REST API v3 wrapper ──────────────────────────────

/**
 * Core fetch helper for JIRA Cloud REST API.
 * Uses Basic auth (email:apiToken base64-encoded).
 */
async function jiraFetch(
  baseUrl: string,
  email: string,
  apiToken: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${baseUrl.replace(/\/+$/, "")}${endpoint}`;
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (res.status === 429) {
    throw new Error("JIRA API rate limit exceeded. Please try again in a moment.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`JIRA API error ${res.status}: ${res.statusText} — ${body}`);
  }
  return res;
}

/**
 * Validate JIRA credentials by fetching the current user.
 * Returns user info if valid, throws if invalid.
 */
export async function validateJiraToken(
  baseUrl: string,
  email: string,
  apiToken: string
): Promise<{ valid: true; user: JiraUser }> {
  const res = await jiraFetch(baseUrl, email, apiToken, "/rest/api/3/myself");
  const data = (await res.json()) as Record<string, unknown>;
  return {
    valid: true,
    user: {
      accountId: data.accountId as string,
      displayName: data.displayName as string,
      emailAddress: (data.emailAddress as string) || undefined,
      avatarUrls: (data.avatarUrls as Record<string, string>) || {},
    },
  };
}

/**
 * List accessible JIRA projects.
 * Uses /rest/api/3/project/search with pagination.
 */
export async function listJiraProjects(
  baseUrl: string,
  email: string,
  apiToken: string,
  options?: { maxResults?: number }
): Promise<JiraProject[]> {
  const maxResults = options?.maxResults || 100;
  const projects: JiraProject[] = [];
  let startAt = 0;

  while (true) {
    const res = await jiraFetch(
      baseUrl,
      email,
      apiToken,
      `/rest/api/3/project/search?maxResults=${maxResults}&startAt=${startAt}&orderBy=name`
    );
    const data = (await res.json()) as {
      values: Array<Record<string, unknown>>;
      isLast: boolean;
    };
    const values = data.values || [];
    for (const p of values) {
      projects.push({
        key: p.key as string,
        name: p.name as string,
        projectTypeKey: (p.projectTypeKey as string) || "software",
        style: (p.style as string) || "classic",
        avatarUrls: (p.avatarUrls as Record<string, string>) || {},
      });
    }
    if (data.isLast || values.length < maxResults) break;
    startAt += values.length;
  }

  return projects;
}

/**
 * Search issues using JQL via POST /rest/api/3/search/jql
 * (NOT the deprecated GET /rest/api/3/search endpoint).
 * Uses cursor-based pagination with nextPageToken/isLast.
 */
export async function searchJiraIssues(
  baseUrl: string,
  email: string,
  apiToken: string,
  opts: {
    projectKeys: string[];
    jql?: string;
    statusCategory?: string;
    maxResults?: number;
  }
): Promise<{ issues: JiraIssue[] }> {
  const base = baseUrl.replace(/\/+$/, "");
  const fields = [
    "summary",
    "description",
    "status",
    "priority",
    "assignee",
    "reporter",
    "issuetype",
    "labels",
    "updated",
    "created",
    "project",
  ].join(",");

  // Build JQL
  const jqlParts: string[] = [];
  if (opts.projectKeys.length > 0) {
    const keys = opts.projectKeys.map((k) => `"${k}"`).join(",");
    jqlParts.push(`project in (${keys})`);
  }
  if (opts.statusCategory && opts.statusCategory !== "all") {
    // Map statusCategory to JQL statusCategory function
    const categoryMap: Record<string, string> = {
      todo: '"To Do"',
      indeterminate: '"In Progress"',
      done: '"Done"',
    };
    const mapped = categoryMap[opts.statusCategory];
    if (mapped) {
      jqlParts.push(`statusCategory = ${mapped}`);
    }
  }
  if (opts.jql?.trim()) {
    jqlParts.push(`(${opts.jql.trim()})`);
  }

  const jql = jqlParts.join(" AND ") + " ORDER BY updated DESC";

  const issues: JiraIssue[] = [];
  let nextPageToken: string | null = null;
  const maxResults = opts.maxResults || 50;

  while (true) {
    const body: Record<string, unknown> = {
      jql,
      fields,
      maxResults,
    };
    if (nextPageToken) {
      body.nextPageToken = nextPageToken;
    }

    const res = await jiraFetch(base, email, apiToken, "/rest/api/3/search/jql", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as {
      issues: Array<Record<string, unknown>>;
      nextPageToken?: string;
      isLast?: boolean;
    };

    const rawIssues = data.issues || [];
    for (const item of rawIssues) {
      const fields = item.fields as Record<string, unknown>;
      const status = fields.status as Record<string, unknown>;
      const statusCat = status?.statusCategory as Record<string, unknown> | undefined;
      const priority = fields.priority as Record<string, unknown> | null;
      const issuetype = fields.issuetype as Record<string, unknown>;
      const assignee = fields.assignee as Record<string, unknown> | null;
      const reporter = fields.reporter as Record<string, unknown> | null;
      const project = fields.project as Record<string, unknown>;

      issues.push({
        key: item.key as string,
        fields: {
          summary: (fields.summary as string) || "",
          description: fields.description,
          status: {
            name: (status?.name as string) || "",
            statusCategory: {
              key: (statusCat?.key as string) || "",
              colorName: (statusCat?.colorName as string) || "",
              name: (statusCat?.name as string) || "",
            },
          },
          priority: priority
            ? {
                id: String(priority.id),
                name: (priority.name as string) || "",
                iconUrl: (priority.iconUrl as string) || "",
              }
            : null,
          issuetype: {
            id: String(issuetype.id),
            name: (issuetype.name as string) || "",
            iconUrl: (issuetype.iconUrl as string) || "",
            subtask: (issuetype.subtask as boolean) || false,
          },
          assignee: assignee
            ? {
                accountId: assignee.accountId as string,
                displayName: assignee.displayName as string,
                emailAddress: (assignee.emailAddress as string) || undefined,
                avatarUrls: (assignee.avatarUrls as Record<string, string>) || {},
              }
            : null,
          reporter: reporter
            ? {
                accountId: reporter.accountId as string,
                displayName: reporter.displayName as string,
                emailAddress: (reporter.emailAddress as string) || undefined,
                avatarUrls: (reporter.avatarUrls as Record<string, string>) || {},
              }
            : null,
          labels: (fields.labels as string[]) || [],
          project: {
            key: (project.key as string) || "",
            name: (project.name as string) || "",
          },
          created: (fields.created as string) || "",
          updated: (fields.updated as string) || "",
        },
        html_url: `${base}/browse/${item.key}`,
      });
    }

    if (data.isLast || !data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }

  return { issues };
}

/**
 * Get a single issue by key.
 */
export async function getJiraIssue(
  baseUrl: string,
  email: string,
  apiToken: string,
  key: string
): Promise<JiraIssue> {
  const base = baseUrl.replace(/\/+$/, "");
  const fields = [
    "summary",
    "description",
    "status",
    "priority",
    "assignee",
    "reporter",
    "issuetype",
    "labels",
    "updated",
    "created",
    "project",
  ].join(",");

  const res = await jiraFetch(
    baseUrl,
    email,
    apiToken,
    `/rest/api/3/issue/${key}?fields=${fields}`
  );
  const item = (await res.json()) as Record<string, unknown>;
  const f = item.fields as Record<string, unknown>;
  const status = f.status as Record<string, unknown>;
  const statusCat = status?.statusCategory as Record<string, unknown> | undefined;
  const priority = f.priority as Record<string, unknown> | null;
  const issuetype = f.issuetype as Record<string, unknown>;
  const assignee = f.assignee as Record<string, unknown> | null;
  const reporter = f.reporter as Record<string, unknown> | null;
  const project = f.project as Record<string, unknown>;

  return {
    key: item.key as string,
    fields: {
      summary: (f.summary as string) || "",
      description: f.description,
      status: {
        name: (status?.name as string) || "",
        statusCategory: {
          key: (statusCat?.key as string) || "",
          colorName: (statusCat?.colorName as string) || "",
          name: (statusCat?.name as string) || "",
        },
      },
      priority: priority
        ? {
            id: String(priority.id),
            name: (priority.name as string) || "",
            iconUrl: (priority.iconUrl as string) || "",
          }
        : null,
      issuetype: {
        id: String(issuetype.id),
        name: (issuetype.name as string) || "",
        iconUrl: (issuetype.iconUrl as string) || "",
        subtask: (issuetype.subtask as boolean) || false,
      },
      assignee: assignee
        ? {
            accountId: assignee.accountId as string,
            displayName: assignee.displayName as string,
            emailAddress: (assignee.emailAddress as string) || undefined,
            avatarUrls: (assignee.avatarUrls as Record<string, string>) || {},
          }
        : null,
      reporter: reporter
        ? {
            accountId: reporter.accountId as string,
            displayName: reporter.displayName as string,
            emailAddress: (reporter.emailAddress as string) || undefined,
            avatarUrls: (reporter.avatarUrls as Record<string, string>) || {},
          }
        : null,
      labels: (f.labels as string[]) || [],
      project: {
        key: (project.key as string) || "",
        name: (project.name as string) || "",
      },
      created: (f.created as string) || "",
      updated: (f.updated as string) || "",
    },
    html_url: `${base}/browse/${item.key}`,
  };
}

/**
 * Convert Atlassian Document Format (ADF) JSON to plain text.
 * Recursive walker that extracts text content from ADF nodes.
 */
export function adfToPlainText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const node = adf as { type?: string; text?: string; content?: unknown[] };
  if (node.type === "text") return node.text || "";
  if (!node.content) return "";
  const parts: string[] = [];
  for (const child of node.content) {
    const text = adfToPlainText(child);
    if (text) {
      parts.push(text);
    }
  }
  if (
    [
      "doc",
      "paragraph",
      "heading",
      "codeBlock",
      "blockquote",
      "bulletList",
      "orderedList",
      "listItem",
    ].includes(node.type || "")
  ) {
    return parts.join(node.type === "listItem" ? "\n" : "\n\n");
  }
  return parts.join("");
}
