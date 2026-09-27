import { afterEach, describe, expect, it } from "vitest";
import {
  AnthropicBatchClient,
  GoogleBatchClient,
  OpenAiBatchClient,
} from "../../src/batch/index.ts";
import { provider, REQUEST } from "./server.ts";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const PNG = { base64: "iVBORw0KGgo=", mediaType: "image/png" };
const PDF = { base64: "JVBERi0xLjQ=", mediaType: "application/pdf" };
const items = [
  { customId: "lore_a", model: "model-a", request: REQUEST },
  { customId: "lore_b", model: "model-a", request: { ...REQUEST, images: [PNG, PDF] } },
];

describe("AnthropicBatchClient", () => {
  const batch = (processing_status: string) => ({
    id: "msgbatch_01",
    type: "message_batch",
    processing_status,
    request_counts: { processing: 0, succeeded: 1, errored: 1, canceled: 0, expired: 1 },
    created_at: "2026-09-24T10:00:00Z",
    expires_at: "2026-09-25T10:00:00Z",
    ended_at: null,
    archived_at: null,
    cancel_initiated_at: null,
    results_url: null,
  });
  const message = (text: string, stop_reason = "end_turn") => ({
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: "model-a",
    content: [{ type: "text", text }],
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: 120,
      output_tokens: 40,
      cache_creation_input_tokens: 900,
      cache_read_input_tokens: 0,
    },
  });

  it("sends Messages requests with the cache breakpoint, the files, and the schema", async () => {
    const api = await provider((r) =>
      r.method === "POST" && r.path === "/v1/messages/batches"
        ? { body: batch("in_progress") }
        : undefined,
    );
    close = api.close;
    const client = new AnthropicBatchClient({ apiKey: "sk-test", baseURL: api.url });
    expect(await client.submit(items)).toBe("msgbatch_01");

    expect(api.seen[0]!.headers["x-api-key"]).toBe("sk-test");
    const sent = JSON.parse(api.seen[0]!.body) as { requests: Record<string, any>[] };
    expect(sent.requests.map((r) => r.custom_id)).toEqual(["lore_a", "lore_b"]);
    const params = sent.requests[1]!.params;
    expect(params).toMatchObject({ model: "model-a", max_tokens: 4000 });
    expect(params.system).toEqual([
      { type: "text", text: REQUEST.instructions },
      { type: "text", text: REQUEST.context[0] },
      { type: "text", text: REQUEST.context[1], cache_control: { type: "ephemeral" } },
    ]);
    expect(params.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG.base64 } },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: PDF.base64 },
      },
      { type: "text", text: REQUEST.input },
    ]);
    const format = params.output_config.format;
    expect(format.type).toBe("json_schema");
    expect(format.schema.properties.summary.type).toBe("string");
    // Made to fit what the API accepts: closed objects, no length limits.
    expect(format.schema.additionalProperties).toBe(false);
    expect(format.schema.properties.summary.minLength).toBeUndefined();
  });

  it("reports running until the batch has ended", async () => {
    let state = "in_progress";
    const api = await provider(() => ({ body: batch(state) }));
    close = api.close;
    const client = new AnthropicBatchClient({ apiKey: "sk-test", baseURL: api.url });
    expect(await client.status("msgbatch_01")).toEqual({ state: "running" });
    state = "canceling";
    expect(await client.status("msgbatch_01")).toEqual({ state: "running" });
    state = "ended";
    expect(await client.status("msgbatch_01")).toEqual({ state: "ended" });
    expect(api.seen[0]!.path).toBe("/v1/messages/batches/msgbatch_01");
  });

  it("reads each request's outcome from the results", async () => {
    const lines = [
      {
        custom_id: "lore_a",
        result: { type: "succeeded", message: message('{"summary":"One note."}') },
      },
      {
        custom_id: "lore_b",
        result: {
          type: "errored",
          error: { type: "error", error: { type: "invalid_request_error", message: "Too long" } },
        },
      },
      { custom_id: "lore_c", result: { type: "expired" } },
      {
        custom_id: "lore_d",
        result: { type: "succeeded", message: message('{"summ', "max_tokens") },
      },
      { custom_id: "lore_e", result: { type: "canceled" } },
    ];
    const api = await provider((r) =>
      r.path === "/v1/messages/batches/msgbatch_01/results"
        ? { body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" }
        : {
            body: {
              ...batch("ended"),
              results_url: `http://${r.headers.host}/v1/messages/batches/msgbatch_01/results`,
            },
          },
    );
    close = api.close;
    const client = new AnthropicBatchClient({ apiKey: "sk-test", baseURL: api.url });
    expect(await client.results("msgbatch_01")).toEqual([
      {
        customId: "lore_a",
        ok: true,
        text: '{"summary":"One note."}',
        usage: { input: 120, output: 40, cacheRead: 0, cacheWrite: 900 },
      },
      { customId: "lore_b", ok: false, error: "invalid_request_error: Too long" },
      {
        customId: "lore_c",
        ok: false,
        error: "The batch expired before this request was processed",
      },
      {
        customId: "lore_d",
        ok: false,
        error: "The answer was cut off at the output limit",
        usage: { input: 120, output: 40, cacheRead: 0, cacheWrite: 900 },
      },
      { customId: "lore_e", ok: false, error: "The request was cancelled" },
    ]);
  });
});

describe("OpenAiBatchClient", () => {
  const batch = (status: string, extra: Record<string, unknown> = {}) => ({
    id: "batch_01",
    object: "batch",
    endpoint: "/v1/chat/completions",
    input_file_id: "file-in",
    completion_window: "24h",
    status,
    created_at: 1790000000,
    ...extra,
  });

  it("uploads the requests as a file and creates the batch from it", async () => {
    const api = await provider((r) =>
      r.path === "/files"
        ? {
            body: {
              id: "file-in",
              object: "file",
              purpose: "batch",
              filename: "lore-batch.jsonl",
              bytes: 10,
              created_at: 1790000000,
            },
          }
        : r.path === "/batches"
          ? { body: batch("validating") }
          : undefined,
    );
    close = api.close;
    const client = new OpenAiBatchClient({ apiKey: "sk-test", baseURL: api.url });
    expect(await client.submit(items)).toBe("batch_01");

    const [upload, create] = api.seen;
    expect(upload!.headers.authorization).toBe("Bearer sk-test");
    expect(upload!.body).toContain('name="purpose"\r\n\r\nbatch');
    const jsonl = upload!.body.slice(upload!.body.indexOf('{"custom_id"'));
    const lines = jsonl
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, any>);
    expect(lines.map((l) => [l.custom_id, l.method, l.url])).toEqual([
      ["lore_a", "POST", "/v1/chat/completions"],
      ["lore_b", "POST", "/v1/chat/completions"],
    ]);
    const body = lines[1]!.body;
    expect(body).toMatchObject({ model: "model-a", max_completion_tokens: 4000 });
    expect(body.messages.slice(0, 3)).toEqual([
      { role: "developer", content: REQUEST.instructions },
      { role: "developer", content: REQUEST.context[0] },
      { role: "developer", content: REQUEST.context[1] },
    ]);
    expect(body.messages[3].content).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG.base64}` } },
      {
        type: "file",
        file: {
          filename: "document-2.pdf",
          file_data: `data:application/pdf;base64,${PDF.base64}`,
        },
      },
      { type: "text", text: REQUEST.input },
    ]);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "answer", schema: REQUEST.schema, strict: false },
    });
    expect(JSON.parse(create!.body)).toEqual({
      input_file_id: "file-in",
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    });
  });

  it("maps the batch's status", async () => {
    let body = batch("in_progress");
    const api = await provider(() => ({ body }));
    close = api.close;
    const client = new OpenAiBatchClient({ apiKey: "sk-test", baseURL: api.url });
    for (const s of ["validating", "in_progress", "finalizing", "cancelling"]) {
      body = batch(s);
      expect(await client.status("batch_01")).toEqual({ state: "running" });
    }
    for (const s of ["completed", "expired", "cancelled"]) {
      body = batch(s);
      expect(await client.status("batch_01")).toEqual({ state: "ended" });
    }
    body = batch("failed", {
      errors: {
        object: "list",
        data: [{ code: "invalid_json_line", message: "Line 2 is not JSON" }],
      },
    });
    expect(await client.status("batch_01")).toEqual({
      state: "failed",
      error: "Line 2 is not JSON",
    });
  });

  it("reads answers from the output file and failures from the error file", async () => {
    const ok = (id: string, message: Record<string, unknown>, finish_reason = "stop") => ({
      id: "batch_req_1",
      custom_id: id,
      response: {
        status_code: 200,
        request_id: "req_1",
        body: {
          id: "chatcmpl-1",
          object: "chat.completion",
          model: "model-a",
          choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 50,
            total_tokens: 1050,
            prompt_tokens_details: { cached_tokens: 800 },
          },
        },
      },
      error: null,
    });
    const output = [
      ok("lore_a", { content: '{"summary":"One note."}' }),
      ok("lore_b", { content: null, refusal: "I cannot help with that." }),
      ok("lore_c", { content: '{"summ' }, "length"),
    ];
    const errors = [
      {
        id: "batch_req_4",
        custom_id: "lore_d",
        response: {
          status_code: 400,
          request_id: "req_4",
          body: { error: { message: "Invalid schema" } },
        },
        error: null,
      },
      {
        id: "batch_req_5",
        custom_id: "lore_e",
        response: null,
        error: { code: "batch_expired", message: "Expired" },
      },
    ];
    const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const api = await provider((r) =>
      r.path === "/files/file-out/content"
        ? { body: jsonl(output) }
        : r.path === "/files/file-err/content"
          ? { body: jsonl(errors) }
          : { body: batch("completed", { output_file_id: "file-out", error_file_id: "file-err" }) },
    );
    close = api.close;
    const client = new OpenAiBatchClient({ apiKey: "sk-test", baseURL: api.url });
    const usage = { input: 200, output: 50, cacheRead: 800, cacheWrite: 0 };
    expect(await client.results("batch_01")).toEqual([
      { customId: "lore_a", ok: true, text: '{"summary":"One note."}', usage },
      { customId: "lore_b", ok: false, error: "The model declined to answer", usage },
      { customId: "lore_c", ok: false, error: "The answer was cut off at the output limit", usage },
      { customId: "lore_d", ok: false, error: "Invalid schema" },
      { customId: "lore_e", ok: false, error: "Expired" },
    ]);
  });
});

describe("GoogleBatchClient", () => {
  it("creates one job per model, with each request named in its metadata", async () => {
    let n = 0;
    const api = await provider((r) =>
      r.method === "POST" && r.path.includes(":batchGenerateContent")
        ? { body: { name: `batches/job-${++n}`, metadata: { state: "BATCH_STATE_PENDING" } } }
        : undefined,
    );
    close = api.close;
    const client = new GoogleBatchClient({ apiKey: "g-test", baseURL: api.url });
    const id = await client.submit([
      ...items,
      { ...items[0]!, customId: "lore_c", model: "model-b" },
    ]);
    expect(id).toBe("batches/job-1,batches/job-2");
    expect(api.seen.map((s) => s.path.split("?")[0])).toEqual([
      "/v1beta/models/model-a:batchGenerateContent",
      "/v1beta/models/model-b:batchGenerateContent",
    ]);
    expect(api.seen[0]!.headers["x-goog-api-key"]).toBe("g-test");
    const sent = JSON.parse(api.seen[0]!.body) as Record<string, any>;
    const requests = sent.batch.inputConfig.requests.requests as Record<string, any>[];
    expect(requests.map((r) => r.metadata)).toEqual([{ lore_id: "lore_a" }, { lore_id: "lore_b" }]);
    const second = requests[1]!.request;
    expect(second.systemInstruction.parts.map((p: { text: string }) => p.text)).toEqual([
      REQUEST.instructions,
      ...REQUEST.context,
    ]);
    expect(second.contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/png", data: PNG.base64 } },
      { inlineData: { mimeType: "application/pdf", data: PDF.base64 } },
      { text: REQUEST.input },
    ]);
    expect(second.generationConfig).toMatchObject({
      maxOutputTokens: 4000,
      responseMimeType: "application/json",
    });
  });

  it("is running until every job has finished, and reads the answers by their names", async () => {
    const jobs: Record<string, Record<string, unknown>> = {
      "batches/job-1": { name: "batches/job-1", metadata: { state: "BATCH_STATE_RUNNING" } },
      "batches/job-2": {
        name: "batches/job-2",
        done: true,
        metadata: {
          state: "BATCH_STATE_SUCCEEDED",
          output: {
            inlinedResponses: {
              inlinedResponses: [
                {
                  metadata: { lore_id: "lore_c" },
                  response: {
                    candidates: [
                      {
                        content: {
                          role: "model",
                          parts: [
                            { text: "thinking", thought: true },
                            { text: '{"summary":"B."}' },
                          ],
                        },
                        finishReason: "STOP",
                      },
                    ],
                    usageMetadata: {
                      promptTokenCount: 500,
                      candidatesTokenCount: 20,
                      thoughtsTokenCount: 30,
                      cachedContentTokenCount: 100,
                    },
                  },
                },
                { metadata: { lore_id: "lore_d" }, error: { code: 400, message: "Bad request" } },
                {
                  metadata: { lore_id: "lore_e" },
                  response: {
                    candidates: [
                      { content: { role: "model", parts: [] }, finishReason: "MAX_TOKENS" },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const api = await provider((r) => {
      const name = /\/v1beta\/(batches\/[^?]+)/.exec(r.path)?.[1];
      return name && jobs[name] ? { body: jobs[name] } : undefined;
    });
    close = api.close;
    const client = new GoogleBatchClient({ apiKey: "g-test", baseURL: api.url });
    const id = "batches/job-1,batches/job-2";
    expect(await client.status(id)).toEqual({ state: "running" });

    jobs["batches/job-1"] = {
      name: "batches/job-1",
      metadata: { state: "BATCH_STATE_FAILED" },
      done: true,
      error: { code: 13, message: "Internal error" },
    };
    expect(await client.status(id)).toEqual({ state: "ended" });
    expect(await client.results(id)).toEqual([
      {
        customId: "lore_c",
        ok: true,
        text: '{"summary":"B."}',
        usage: { input: 400, output: 50, cacheRead: 100, cacheWrite: 0 },
      },
      { customId: "lore_d", ok: false, error: "Bad request" },
      { customId: "lore_e", ok: false, error: "The answer was cut off at the output limit" },
    ]);

    jobs["batches/job-2"] = {
      name: "batches/job-2",
      metadata: { state: "BATCH_STATE_EXPIRED" },
      done: true,
    };
    expect(await client.status(id)).toMatchObject({ state: "failed" });
  });
});
