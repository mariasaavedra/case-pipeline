// =============================================================================
// Microsoft Graph client
// =============================================================================
// Transport only: throttle handling and error shaping. WHO the calls run as is
// supplied by a GraphAuth (see auth.ts) so the same folder code can run under a
// signed-in person or, if the firm ever grants an application permission, under
// the app itself.
// =============================================================================

const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

/** An identity the client can call Graph as. */
export interface GraphAuth {
  getToken(): Promise<string>;
  /** Short human description for logs — never includes the token. */
  describe(): string;
}

/** A fixed token. For tests, and for a token obtained some other way. */
export function staticAuth(token: string, label = "static token"): GraphAuth {
  return { getToken: async () => token, describe: () => label };
}

const MAX_ATTEMPTS = 5;

/**
 * Graph call with throttle handling. 429 and 503 are normal under any bulk
 * workload — Graph asks for a wait via Retry-After and expects to be obeyed;
 * ignoring it gets throttled harder, so this always honours the header and only
 * falls back to exponential backoff when one isn't supplied.
 */
export async function graphFetch<T>(auth: GraphAuth, pathOrUrl: string, init?: RequestInit): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;

  for (let attempt = 1; ; attempt++) {
    const token = await auth.getToken();
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...((init?.headers as Record<string, string>) ?? {}),
      },
    });

    if (res.status === 429 || res.status === 503) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new GraphError(res.status, `Graph is throttling after ${attempt} attempts — try again later.`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) throw await toGraphError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

async function toGraphError(res: Response): Promise<GraphError> {
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string } };
    return new GraphError(res.status, body.error?.message ?? `Graph ${res.status}`, body.error?.code);
  } catch {
    return new GraphError(res.status, `Graph ${res.status}`);
  }
}
