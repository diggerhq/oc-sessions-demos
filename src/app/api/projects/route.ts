import { createProject, listProjects } from "@/oc";

// GET /api/projects  →  [{ id, status, created_at }]   (the projects list = sessions)
export async function GET() {
  try {
    return Response.json(await listProjects());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

// POST /api/projects  { input }  →  { id, token }
// Starts a new project (session). The only place the org key starts a run; the
// browser does everything else directly against OpenComputer with the token.
export async function POST(req: Request) {
  let input: unknown;
  try {
    ({ input } = await req.json());
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof input !== "string" || !input.trim()) {
    return Response.json({ error: "input (what to build) is required" }, { status: 400 });
  }
  try {
    return Response.json(await createProject(input));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
