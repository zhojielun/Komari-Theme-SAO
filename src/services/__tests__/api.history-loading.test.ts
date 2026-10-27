import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcCallMock, MockRpcResponseError } = vi.hoisted(() => ({
  rpcCallMock: vi.fn(),
  MockRpcResponseError: class extends Error {
    constructor(message: string, public readonly code?: number) {
      super(message);
    }
  },
}));

vi.mock("@/services/rpc2Client", () => ({
  getRpc2Client: () => ({ call: rpcCallMock }),
  RpcResponseError: MockRpcResponseError,
}));

const metricPayload = {
  start: "2026-10-10T00:00:00Z", end: "2026-10-10T01:00:00Z",
  series: [{
    metric_key: "ping.latency_ms", entity_id: "node-a", tags: { task_id: "7" },
    interval_seconds: 60,
    points: [{ time: "2026-10-10T00:30:00Z", value: 20, count: 1 }],
  }],
};

function delayed<T>(value: T, delay: number, signal?: AbortSignal, rejectResult = false) {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      if (rejectResult) reject(value);
      else resolve(value);
    }, delay);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

describe("history loading critical path", () => {
  let api: typeof import("@/services/api");
  let HttpRequestError: typeof import("@/services/requestErrors")["HttpRequestError"];

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    rpcCallMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn());
    HttpRequestError = (await import("@/services/requestErrors")).HttpRequestError;
    api = await import("@/services/api");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function loadChart(kind: string, timeout = 30_000) {
    if (kind === "load") return api.getLoadRecords("node-a", 1, { timeout });
    if (kind === "overview") return api.getPingOverview(1, 7, { timeout, includeStats: false });
    return api.getPingRecords("node-a", 1, { timeout, includeStats: false, includeTasks: false });
  }

  it.each(["load", "ping", "overview"])("does not fall back after %s capability authorization fails", async (kind) => {
    rpcCallMock.mockRejectedValue(new HttpRequestError("denied", 401, "/api/rpc2"));

    await expect(loadChart(kind)).rejects.toMatchObject({ status: 401 });

    expect(rpcCallMock).toHaveBeenCalledTimes(1);
    expect(rpcCallMock.mock.calls[0][0]).toBe("public:queryMetrics");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["load", "ping", "overview"])("does not fall back after the %s metric query returns 403", async (kind) => {
    rpcCallMock.mockImplementation((_method: string, params: Record<string, unknown>) => {
      if (!params.metric_keys) return Promise.reject(new MockRpcResponseError("invalid params", -32602));
      return Promise.reject(new HttpRequestError("denied", 403, "/api/rpc2"));
    });

    await expect(loadChart(kind)).rejects.toMatchObject({ status: 403 });

    expect(rpcCallMock.mock.calls.every(([method]) => method === "public:queryMetrics")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("[Komari-Theme-SAO] RPC 查询失败", expect.objectContaining({
      method: "public:queryMetrics", hours: 1, status: 403, elapsedMs: 0,
    }));
  });

  it.each(["load", "ping", "overview"])("does not start legacy HTTP after %s records access is denied", async (kind) => {
    rpcCallMock.mockImplementation((method: string) => {
      if (method === "public:queryMetrics") return Promise.reject(new MockRpcResponseError("Method not found", -32601));
      return Promise.reject(new HttpRequestError("denied", 401, "/api/rpc2"));
    });

    await expect(loadChart(kind)).rejects.toMatchObject({ status: 401 });

    expect(rpcCallMock.mock.calls.map(([method]) => method)).toEqual(["public:queryMetrics", "common:getRecords"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["load", "ping", "overview"])("bounds the complete %s probe and fallback chain", async (kind) => {
    rpcCallMock.mockImplementation((method: string, params: Record<string, unknown>, options: { signal?: AbortSignal }) => {
      if (method === "public:queryMetrics" && !params.metric_keys) return delayed({}, 30);
      if (method === "public:queryMetrics") return delayed(new Error("temporary network failure"), 30, options.signal, true);
      return delayed({ count: 0, records: [] }, 100, options.signal);
    });
    const result = loadChart(kind, 100).catch((error) => error);

    await vi.advanceTimersByTimeAsync(100);

    expect(await result).toMatchObject({ name: "TimeoutError" });
    expect(rpcCallMock.mock.calls.some(([method]) => method === "common:getRecords")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("displays the curve at 10 ms while auxiliary requests take 500 ms", async () => {
    rpcCallMock.mockImplementation((method: string, params: Record<string, unknown>, options: { signal?: AbortSignal }) => {
      if (method === "public:queryMetrics" && !params.metric_keys) return Promise.resolve({});
      if (method === "public:queryMetrics") return delayed(metricPayload, 10, options.signal);
      if (method === "public:getPingMetricStats") return delayed({ stats: [] }, 500, options.signal);
      return delayed([{ id: 7, name: "真实任务名", interval: 60, clients: ["node-a"] }], 500);
    });
    let curveReadyAt: number | undefined;
    const startedAt = Date.now();
    const curve = api.getPingRecords("node-a", 1, { includeStats: false, includeTasks: false })
      .then((result) => {
        curveReadyAt = Date.now() - startedAt;
        return result;
      });
    const stats = api.getPingStats("node-a", 1);
    const names = api.getPublicPingTasks();

    await vi.advanceTimersByTimeAsync(10);

    expect(curveReadyAt).toBe(10);
    expect((await curve).records).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(490);
    await expect(stats).resolves.toEqual([]);
    await expect(names).resolves.toMatchObject([{ id: 7, name: "真实任务名" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds legacy HTTP response-body reading by the same history deadline", async () => {
    rpcCallMock.mockImplementation((method: string) => {
      if (method === "public:queryMetrics") return Promise.reject(new MockRpcResponseError("Method not found", -32601));
      return Promise.reject(new Error("RPC unavailable"));
    });
    vi.mocked(fetch).mockImplementation(async (_input, init) => ({
      ok: true, status: 200,
      json: () => delayed({ records: [] }, 500, init?.signal ?? undefined),
    } as Response));
    const result = loadChart("load", 100).catch((error) => error);

    await vi.advanceTimersByTimeAsync(100);

    expect(await result).toMatchObject({ name: "TimeoutError" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates statistics authorization errors without a records fallback", async () => {
    rpcCallMock.mockImplementation((method: string) => {
      if (method === "public:queryMetrics") return Promise.resolve({});
      return Promise.reject(new HttpRequestError("denied", 403, "/api/rpc2"));
    });

    await expect(api.getPingStats("node-a", 1)).rejects.toMatchObject({ status: 403 });

    expect(rpcCallMock.mock.calls.map(([method]) => method)).toEqual(["public:queryMetrics", "public:getPingMetricStats"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("measures the former joined-response behavior at 500 ms under the same delays", async () => {
    rpcCallMock.mockImplementation((method: string, params: Record<string, unknown>, options: { signal?: AbortSignal }) => {
      if (method === "public:queryMetrics" && !params.metric_keys) return Promise.resolve({});
      if (method === "public:queryMetrics") return delayed(metricPayload, 10, options.signal);
      if (method === "public:getPingMetricStats") return delayed({ stats: [] }, 500, options.signal);
      return delayed([{ id: 7, name: "真实任务名", interval: 60, clients: ["node-a"] }], 500);
    });
    let readyAt: number | undefined;
    const startedAt = Date.now();
    const joined = api.getPingRecords("node-a", 1).then((result) => {
      readyAt = Date.now() - startedAt;
      return result;
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(readyAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(490);

    expect((await joined).records).toHaveLength(1);
    expect(readyAt).toBe(500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not wait for public task names on the homepage", async () => {
    rpcCallMock.mockImplementation((method: string) => {
      if (method === "public:queryMetrics") return Promise.resolve(metricPayload);
      return new Promise<never>(() => undefined);
    });
    api.prewarmPingOverviewDependencies();

    const result = await api.getPingOverview(1, 7, { includeStats: false });

    expect(result.records).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ id: 7, name: "任务 #7" });
  });

  it("cancels obsolete auxiliary queries without failing the ready curve", async () => {
    rpcCallMock.mockImplementation((method: string, _params: Record<string, unknown>, options: { signal?: AbortSignal }) => {
      if (method === "public:queryMetrics") return Promise.resolve(metricPayload);
      return delayed({ stats: [] }, 500, options.signal);
    });
    const curve = await api.getPingRecords("node-a", 1, { includeStats: false, includeTasks: false });
    const controller = new AbortController();
    const oldStats = api.getPingStats("node-a", 1, { signal: controller.signal }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort(new DOMException("range changed", "AbortError"));

    expect(await oldStats).toMatchObject({ name: "AbortError" });
    expect(curve.records).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
