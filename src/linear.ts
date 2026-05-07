#!/usr/bin/env node

import type {
  LinearTeam,
  LinearIssue,
  LinearUser,
  LinearWorkflowState,
  LinearLabel,
} from "./types.js";

const LINEAR_API = "https://api.linear.app/graphql";

/**
 * Execute a GraphQL query against the Linear API.
 * Personal API keys are sent raw (no "Bearer" prefix).
 */
async function linearGraphQL<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown>,
  apiKey: string,
): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) {
    throw new Error(
      "Linear API rate limit exceeded. Please try again in a moment.",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Linear API error ${res.status}: ${res.statusText} — ${body}`,
    );
  }
  const data = (await res.json()) as {
    data: T;
    errors?: Array<{ message: string }>;
  };
  if (data.errors && data.errors.length > 0) {
    throw new Error(
      `Linear GraphQL error: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
  return data.data;
}

/**
 * Validate a Linear API key by fetching the authenticated user.
 * Returns user info if valid, throws if invalid.
 */
export async function validateLinearToken(
  apiKey: string,
): Promise<{ valid: true; user: LinearUser }> {
  const query = `
    query {
      viewer {
        id
        name
        displayName
        email
        avatarUrl
      }
    }
  `;
  const data = await linearGraphQL<{
    viewer: Record<string, unknown>;
  }>(query, {}, apiKey);

  const v = data.viewer;
  return {
    valid: true,
    user: {
      id: v.id as string,
      name: v.name as string,
      display_name: (v.displayName as string) || "",
      email: v.email as string,
      avatar_url: (v.avatarUrl as string) || null,
    },
  };
}

/**
 * List all teams accessible by the API key.
 * Uses cursor-based pagination.
 */
export async function listLinearTeams(
  apiKey: string,
  options?: { first?: number },
): Promise<LinearTeam[]> {
  const first = options?.first || 100;
  const teams: LinearTeam[] = [];
  let after: string | null = null;

  while (true) {
    const query = `
      query($first: Int!, $after: String) {
        teams(first: $first, after: $after, orderBy: updatedAt) {
          nodes {
            id
            key
            name
            description
            color
            icon
            archivedAt
            createdAt
            updatedAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;
    const data: {
      teams: {
        nodes: Array<Record<string, unknown>>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await linearGraphQL<{
      teams: {
        nodes: Array<Record<string, unknown>>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(query, { first, after }, apiKey);

    const nodes = data.teams?.nodes || [];
    for (const t of nodes) {
      teams.push({
        id: t.id as string,
        key: t.key as string,
        name: t.name as string,
        description: (t.description as string) || null,
        color: (t.color as string) || null,
        icon: (t.icon as string) || null,
        archived_at: (t.archivedAt as string) || null,
        created_at: t.createdAt as string,
        updated_at: t.updatedAt as string,
      });
    }

    const pageInfo:
      | { hasNextPage: boolean; endCursor: string | null }
      | undefined = data.teams?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return teams;
}

/**
 * Build a state type filter for Linear issues.
 * Maps state type groups to the actual state type values.
 */
function buildStateTypeFilter(stateType: string): string[] | null {
  switch (stateType) {
    case "active":
      return ["unstarted", "started"];
    case "backlog":
      return ["backlog"];
    case "completed":
      return ["completed"];
    case "canceled":
      return ["canceled"];
    case "triage":
      return ["triage"];
    case "all":
      return null;
    default:
      return null;
  }
}

/**
 * List issues for specific teams.
 * Uses cursor-based pagination with filtering.
 */
export async function listLinearIssues(
  apiKey: string,
  teamIds: string[],
  options?: {
    stateType?: string;
    priority?: number;
    assigneeId?: string;
    first?: number;
  },
): Promise<{ issues: LinearIssue[] }> {
  const first = options?.first || 50;
  const stateTypes = options?.stateType
    ? buildStateTypeFilter(options.stateType)
    : null;
  const issues: LinearIssue[] = [];

  // Fetch issues for each team
  for (const teamId of teamIds) {
    let after: string | null = null;

    while (true) {
      // Build the filter object
      const filterParts: string[] = [`{ team: { id: { eq: "${teamId}" } } }`];
      if (stateTypes) {
        filterParts.push(
          `{ state: { type: { in: ${JSON.stringify(stateTypes)} } } }`,
        );
      }
      if (options?.priority !== undefined && options.priority >= 0) {
        filterParts.push(`{ priority: { eq: ${options.priority} } }`);
      }
      if (options?.assigneeId) {
        filterParts.push(
          `{ assignee: { id: { eq: "${options.assigneeId}" } } }`,
        );
      }

      const query = `
        query($first: Int!, $after: String) {
          issues(
            first: $first
            after: $after
            orderBy: updatedAt
            filter: { and: [${filterParts.join("\n")}] }
          ) {
            nodes {
              id
              identifier
              number
              title
              description
              priority
              priorityLabel
              url
              branchName
              createdAt
              updatedAt
              completedAt
              canceledAt
              dueDate
              estimate
              state {
                id
                name
                type
                color
              }
              assignee {
                id
                name
                displayName
                email
                avatarUrl
              }
              labels {
                nodes {
                  id
                  name
                  color
                }
              }
              team {
                id
                key
                name
              }
              parent {
                id
                identifier
                title
              }
              project {
                id
                name
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const data: {
        issues: {
          nodes: Array<Record<string, unknown>>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await linearGraphQL<{
        issues: {
          nodes: Array<Record<string, unknown>>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      }>(query, { first, after }, apiKey);

      const nodes = data.issues?.nodes || [];
      for (const item of nodes) {
        const assignee = item.assignee as Record<string, unknown> | null;
        const state = item.state as Record<string, unknown>;
        const labelsNodes = ((item.labels as Record<string, unknown>)?.nodes ||
          []) as Array<Record<string, unknown>>;
        const team = item.team as Record<string, unknown>;
        const parent = item.parent as Record<string, unknown> | null;
        const project = item.project as Record<string, unknown> | null;

        issues.push({
          id: item.id as string,
          identifier: item.identifier as string,
          number: item.number as number,
          title: item.title as string,
          description: (item.description as string) || null,
          priority: item.priority as number,
          priority_label: (item.priorityLabel as string) || "No priority",
          url: item.url as string,
          branch_name: (item.branchName as string) || null,
          created_at: item.createdAt as string,
          updated_at: item.updatedAt as string,
          completed_at: (item.completedAt as string) || null,
          canceled_at: (item.canceledAt as string) || null,
          due_date: (item.dueDate as string) || null,
          estimate: (item.estimate as number) || null,
          state: {
            id: state.id as string,
            name: state.name as string,
            type: state.type as LinearWorkflowState["type"],
            color: (state.color as string) || "#000000",
          },
          assignee: assignee
            ? {
                id: assignee.id as string,
                name: (assignee.name as string) || "",
                display_name: (assignee.displayName as string) || "",
                email: (assignee.email as string) || "",
                avatar_url: (assignee.avatarUrl as string) || null,
              }
            : null,
          labels: labelsNodes.map((l) => ({
            id: l.id as string,
            name: l.name as string,
            color: (l.color as string) || "#000000",
          })),
          team: {
            id: team.id as string,
            key: team.key as string,
            name: team.name as string,
          },
          parent: parent
            ? {
                id: parent.id as string,
                identifier: parent.identifier as string,
                title: parent.title as string,
              }
            : null,
          project: project
            ? {
                id: project.id as string,
                name: project.name as string,
              }
            : null,
        });
      }

      const pageInfo:
        | { hasNextPage: boolean; endCursor: string | null }
        | undefined = data.issues?.pageInfo;
      if (!pageInfo?.hasNextPage) break;
      after = pageInfo.endCursor;
    }
  }

  // Sort by updatedAt descending
  issues.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  return { issues };
}

/**
 * Get a single issue by its ID.
 */
export async function getLinearIssue(
  apiKey: string,
  issueId: string,
): Promise<LinearIssue> {
  const query = `
    query($id: String!) {
      issue(id: $id) {
        id
        identifier
        number
        title
        description
        priority
        priorityLabel
        url
        branchName
        createdAt
        updatedAt
        completedAt
        canceledAt
        dueDate
        estimate
        state {
          id
          name
          type
          color
        }
        assignee {
          id
          name
          displayName
          email
          avatarUrl
        }
        labels {
          nodes {
            id
            name
            color
          }
        }
        team {
          id
          key
          name
        }
        parent {
          id
          identifier
          title
        }
        project {
          id
          name
        }
      }
    }
  `;
  const data = await linearGraphQL<{
    issue: Record<string, unknown>;
  }>(query, { id: issueId }, apiKey);

  const item = data.issue;
  const assignee = item.assignee as Record<string, unknown> | null;
  const state = item.state as Record<string, unknown>;
  const labelsNodes = ((item.labels as Record<string, unknown>)?.nodes ||
    []) as Array<Record<string, unknown>>;
  const team = item.team as Record<string, unknown>;
  const parent = item.parent as Record<string, unknown> | null;
  const project = item.project as Record<string, unknown> | null;

  return {
    id: item.id as string,
    identifier: item.identifier as string,
    number: item.number as number,
    title: item.title as string,
    description: (item.description as string) || null,
    priority: item.priority as number,
    priority_label: (item.priorityLabel as string) || "No priority",
    url: item.url as string,
    branch_name: (item.branchName as string) || null,
    created_at: item.createdAt as string,
    updated_at: item.updatedAt as string,
    completed_at: (item.completedAt as string) || null,
    canceled_at: (item.canceledAt as string) || null,
    due_date: (item.dueDate as string) || null,
    estimate: (item.estimate as number) || null,
    state: {
      id: state.id as string,
      name: state.name as string,
      type: state.type as LinearWorkflowState["type"],
      color: (state.color as string) || "#000000",
    },
    assignee: assignee
      ? {
          id: assignee.id as string,
          name: (assignee.name as string) || "",
          display_name: (assignee.displayName as string) || "",
          email: (assignee.email as string) || "",
          avatar_url: (assignee.avatarUrl as string) || null,
        }
      : null,
    labels: labelsNodes.map((l) => ({
      id: l.id as string,
      name: l.name as string,
      color: (l.color as string) || "#000000",
    })),
    team: {
      id: team.id as string,
      key: team.key as string,
      name: team.name as string,
    },
    parent: parent
      ? {
          id: parent.id as string,
          identifier: parent.identifier as string,
          title: parent.title as string,
        }
      : null,
    project: project
      ? {
          id: project.id as string,
          name: project.name as string,
        }
      : null,
  };
}
