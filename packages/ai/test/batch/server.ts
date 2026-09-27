import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  /** Objects are sent as JSON, strings as they are. */
  body: unknown;
}

/**
 * A provider's API on localhost. The replies are written from the providers' published
 * response shapes; they were not recorded from live calls. The `@live` job is what checks
 * the clients against the real services.
 */
export async function provider(
  routes: (req: Seen) => Reply | undefined,
): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const got: Seen = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      seen.push(got);
      const reply = routes(got) ?? { status: 404, body: { error: { message: "No such route" } } };
      const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      res.writeHead(reply.status ?? 200, {
        "content-type": typeof reply.body === "string" ? "application/x-jsonl" : "application/json",
        ...reply.headers,
      });
      res.end(text);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export const REQUEST = {
  instructions: "You turn a source document into notes.",
  context: ["# Vocabulary\n- refunds", "# Profile\nTypes: How-To"],
  input: '<document label="sop.docx">\nRefund the deposit.\n</document>',
  images: [],
  schema: {
    type: "object",
    properties: {
      summary: { type: "string", minLength: 1 },
      items: { type: "array", items: { type: "string" }, maxItems: 40 },
    },
    required: ["summary"],
  },
  maxOutputTokens: 4000,
};
