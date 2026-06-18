import { mintToken } from "@/oc";

// POST /api/projects/:id/token  →  { token, expires_at }
// Mints a fresh client token when a project is opened, so a browser can stream +
// steer that one session without ever seeing the org key.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    return Response.json(await mintToken(params.id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
