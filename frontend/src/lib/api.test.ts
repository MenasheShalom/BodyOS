import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({ env: { apiUrl: "http://api.test" } }));

import { ApiError, SLOW_MS, api, onSlowRequest, setTokenGetter, setUnauthorizedHandler } from "./api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    setTokenGetter(async () => "tok");
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the bearer token and JSON body", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await api("/body-entries", { method: "POST", json: { weight_kg: 80 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/body-entries");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(init.body).toBe('{"weight_kg":80}');
  });

  it("maps 422 validation errors to fields", async () => {
    fetchMock.mockResolvedValue(
      json(422, { detail: [{ loc: ["body", "weight_kg"], msg: "Input should be less than or equal to 400" }] }),
    );
    const err = await api<never>("/x").catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.fieldErrors).toEqual({ weight_kg: "Input should be less than or equal to 400" });
  });

  it("uses model-level 422 messages as the general message", async () => {
    fetchMock.mockResolvedValue(
      json(422, { detail: [{ loc: ["body"], msg: "Value error, Enter at least one measurement" }] }),
    );
    const err = await api<never>("/x").catch((e: ApiError) => e);
    expect(err.message).toBe("Enter at least one measurement");
  });

  it("uses string details as the message", async () => {
    fetchMock.mockResolvedValue(json(409, { detail: "You already have an active goal for Body fat" }));
    await expect(api("/x")).rejects.toThrow("You already have an active goal for Body fat");
  });

  it("returns undefined for 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api("/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("wraps network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await api<never>("/x").catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it("calls the unauthorized handler on 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(json(401, { detail: "Invalid or expired token" }));
    await expect(api("/x")).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("reports slow requests while they are pending", async () => {
    vi.useFakeTimers();
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const states: boolean[] = [];
    const off = onSlowRequest((s) => states.push(s));
    const pending = api("/x");
    await vi.advanceTimersByTimeAsync(SLOW_MS + 10);
    expect(states).toEqual([true]);
    resolve(json(200, {}));
    await pending;
    expect(states).toEqual([true, false]);
    off();
  });
});
