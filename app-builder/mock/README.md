# mock/ — a fake OpenComputer, for local UI testing only

`oc-mock.mjs` is a tiny, dependency-free stand-in for the OpenComputer Durable Agent
Sessions API. It exists so you can run the **app-builder UI locally without any keys or a
real backend** — it holds sessions in memory and streams a scripted "build" (chat + tool
cards + a `preview.url`) over SSE.

It is **not part of the app** and is never deployed. The app stays pointed at the real
API in production; this just lets you see the UI move.

```bash
# terminal 1
npm run mock                 # → http://localhost:8787

# terminal 2  (.env.local: OC_API_URL + NEXT_PUBLIC_OC_API_URL = http://localhost:8787,
#              and any placeholder values for the two keys)
npm run dev                  # → http://localhost:3000
```

Restarting the mock clears all state. It implements only the routes app-builder calls.
