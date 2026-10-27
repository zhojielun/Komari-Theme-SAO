import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class TestWebSocket extends EventTarget {
  static OPEN = 1;
  static instances: TestWebSocket[] = [];
  readyState = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  send = vi.fn();

  constructor(public readonly url: string) {
    super();
    TestWebSocket.instances.push(this);
  }

  open() {
    this.readyState = TestWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  close() {
    this.readyState = 3;
    const event = new Event("close");
    this.onclose?.(event);
    this.dispatchEvent(event);
  }

  respond(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

function waitForAbort(signal: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("RPC transport deadline", () => {
  let client: ReturnType<typeof import("@/services/rpc2Client")["getRpc2Client"]>;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    TestWebSocket.instances = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", TestWebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "https:", host: "example.test" },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    });
    client = (await import("@/services/rpc2Client")).getRpc2Client();
  });

  afterEach(() => {
    client.close();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("preserves HTTP authorization status", async () => {
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    await expect(client.call("public:queryMetrics")).rejects.toMatchObject({
      name: "HttpRequestError", status: 401, path: "/api/rpc2",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses only the remaining budget after a WS disconnect", async () => {
    const socket = TestWebSocket.instances[0];
    socket.open();
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      waitForAbort(init.signal as AbortSignal),
    );
    const startedAt = Date.now();
    const result = client.call("public:queryMetrics", {}, { timeout: 100 }).catch((error) => error);

    await vi.advanceTimersByTimeAsync(60);
    socket.close();
    await vi.advanceTimersByTimeAsync(40);

    expect(await result).toMatchObject({ name: "TimeoutError" });
    expect(Date.now() - startedAt).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start HTTP after WS exhausts the entire budget", async () => {
    TestWebSocket.instances[0].open();
    const result = client.call("public:queryMetrics", {}, { timeout: 100 }).catch((error) => error);

    await vi.advanceTimersByTimeAsync(100);

    expect(await result).toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the deadline active while reading the HTTP response body", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: () => waitForAbort(init.signal as AbortSignal),
    }));
    const result = client.call("public:queryMetrics", {}, { timeout: 100 }).catch((error) => error);

    await vi.advanceTimersByTimeAsync(100);

    expect(await result).toMatchObject({ name: "TimeoutError" });
  });

  it("returns a successful WS response without HTTP", async () => {
    const socket = TestWebSocket.instances[0];
    socket.open();
    const result = client.call("public:queryMetrics");
    const request = JSON.parse(socket.send.mock.calls[0][0]);
    socket.respond({ id: request.id, result: { series: [] } });

    await expect(result).resolves.toEqual({ series: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not replay a rejected RPC response", async () => {
    const socket = TestWebSocket.instances[0];
    socket.open();
    const result = client.call("public:queryMetrics");
    const request = JSON.parse(socket.send.mock.calls[0][0]);
    socket.respond({ id: request.id, error: { code: -32601, message: "Method not found" } });

    await expect(result).rejects.toMatchObject({ name: "RpcResponseError", code: -32601 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels a pending WS request without replaying it over HTTP", async () => {
    TestWebSocket.instances[0].open();
    const controller = new AbortController();
    const result = client.call("public:queryMetrics", {}, { signal: controller.signal });
    controller.abort(new DOMException("navigation changed", "AbortError"));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
