const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function authorized(request, env) {
  const configured = env.HCW_API_KEY;
  if (!configured) return false;
  return request.headers.get("x-hcw-key") === configured;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-hcw-key",
        "access-control-max-age": "86400"
      }});
    }

    if (url.pathname === "/health" && request.method === "GET") {
      let database = "not_connected";
      try {
        if (env.DB) {
          await env.DB.prepare("SELECT 1").first();
          database = "connected";
        }
      } catch (error) {
        database = "error";
      }
      return json({
        service: "HUMAN CAPITAL WORKSPACE",
        status: "online",
        api_version: "0.2.0",
        database,
        ai_engine: "not_configured",
        note: "API foundation only; no AI agent execution is enabled."
      });
    }

    if (url.pathname.startsWith("/api/") && !authorized(request, env)) {
      return json({ error: "Unauthorized", message: "A valid HCW API key is required." }, 401);
    }

    if (url.pathname === "/api/tasks" && request.method === "GET") {
      if (!env.DB) return json({ error: "D1 binding DB is unavailable." }, 503);
      const { results } = await env.DB.prepare(
        "SELECT id, title, description, owner_id, status, created_at, updated_at FROM tasks ORDER BY created_at DESC LIMIT 100"
      ).all();
      return json({ tasks: results || [] });
    }

    if (url.pathname === "/api/tasks" && request.method === "POST") {
      if (!env.DB) return json({ error: "D1 binding DB is unavailable." }, 503);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      const ownerId = body.owner_id == null ? null : Number(body.owner_id);
      if (!title || !description) return json({ error: "title and description are required." }, 400);
      if (title.length > 180 || description.length > 12000) return json({ error: "Input exceeds allowed length." }, 400);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO tasks (id, title, description, owner_id, status) VALUES (?, ?, ?, ?, 'queued')"
      ).bind(id, title, description, Number.isInteger(ownerId) ? ownerId : null).run();
      return json({ task: { id, title, description, owner_id: ownerId, status: "queued" } }, 201);
    }

    return json({ service: "HUMAN CAPITAL WORKSPACE API", error: "Endpoint not found" }, 404);
  }
};
