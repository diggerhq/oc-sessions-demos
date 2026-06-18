import { createSession } from "@/oc";

// POST /api/sessions  { input }  →  { id, token }
// The only place the org key is used to start a run. Returns the session id and a
// browser-safe client token; the browser does everything else directly against OC.
export async function POST(req: Request) {
  let input: unknown;
  try {
    ({ input } = await req.json());
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof input !== "string" || !input.trim()) {
    return Response.json({ error: "input (a task string) is required" }, { status: 400 });
  }
  try {
    return Response.json(await createSession(input));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
