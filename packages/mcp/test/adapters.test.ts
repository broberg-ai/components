import { describe, it, expect, vi } from "vitest";
import { toSseRoutes, mountNodeSse } from "../src/adapters";

describe("toSseRoutes", () => {
  it("maps GET → handleSse and POST → handleMessage", async () => {
    const handleSse = vi.fn().mockResolvedValue(new Response("sse"));
    const handleMessage = vi.fn().mockResolvedValue(new Response("msg", { status: 202 }));
    const { GET, POST } = toSseRoutes({ handleSse, handleMessage } as never);

    const get = new Request("http://x/sse");
    const post = new Request("http://x/message?sessionId=a", { method: "POST" });
    await GET(get);
    await POST(post);

    expect(handleSse).toHaveBeenCalledWith(get);
    expect(handleMessage).toHaveBeenCalledWith(post);
  });
});

describe("mountNodeSse", () => {
  it("registers GET + POST on the given paths and forwards (req,res)", () => {
    const routes: Record<string, (req: unknown, res: unknown) => unknown> = {};
    const app = {
      get: (p: string, h: (req: unknown, res: unknown) => unknown) => void (routes[`GET ${p}`] = h),
      post: (p: string, h: (req: unknown, res: unknown) => unknown) => void (routes[`POST ${p}`] = h),
    };
    const handleSse = vi.fn();
    const handleMessage = vi.fn();
    mountNodeSse(app, { handleSse, handleMessage } as never, { ssePath: "/s", messagesPath: "/m" });

    expect(Object.keys(routes)).toEqual(["GET /s", "POST /m"]);
    routes["GET /s"]("req", "res");
    routes["POST /m"]("req2", "res2");
    expect(handleSse).toHaveBeenCalledWith("req", "res");
    expect(handleMessage).toHaveBeenCalledWith("req2", "res2");
  });

  it("defaults to /sse and /message", () => {
    const seen: string[] = [];
    const app = {
      get: (p: string) => void seen.push(`GET ${p}`),
      post: (p: string) => void seen.push(`POST ${p}`),
    };
    mountNodeSse(app, { handleSse: vi.fn(), handleMessage: vi.fn() } as never);
    expect(seen).toEqual(["GET /sse", "POST /message"]);
  });
});
