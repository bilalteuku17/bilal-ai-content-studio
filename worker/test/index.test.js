import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function createDb(initialTasks = [], options = {}) {
  const tasks = initialTasks.map(task => ({ ...task }));
  const db = {
    tasks,
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async all() {
          if (sql.includes("LIMIT 0")) return { results: [] };
          if (sql.includes("ORDER BY created_at DESC LIMIT 100")) {
            return { results: [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100) };
          }
          throw new Error("Unexpected D1 all() query: " + sql);
        },
        async first() {
          if (sql.includes("WHERE id = ?")) return tasks.find(task => task.id === values[0]) || null;
          throw new Error("Unexpected D1 first() query: " + sql);
        },
        async run() {
          if (sql.startsWith("INSERT OR IGNORE INTO tasks")) {
            const [id, title, description, owner_id] = values;
            if (tasks.some(task => task.id === id)) return { meta: { changes: 0 } };
            const now = new Date().toISOString();
            tasks.push({
              id, title, description, owner_id, status: "queued",
              result: null, error: null, ai_model: null, attempt_count: 0,
              started_at: null, completed_at: null, created_at: now, updated_at: now
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'in_progress'")) {
            const task = tasks.find(item => item.id === values[0]);
            if (!task || options.claimAllowed === false || !["queued", "assigned", "blocked"].includes(task.status)) {
              return { meta: { changes: 0 } };
            }
            task.status = "in_progress";
            task.error = null;
            task.started_at = new Date().toISOString();
            task.completed_at = null;
            task.attempt_count += 1;
            task.updated_at = new Date().toISOString();
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'completed'")) {
            const [result, model, id] = values;
            const task = tasks.find(item => item.id === id);
            if (!task || task.status !== "in_progress") return { meta: { changes: 0 } };
            task.status = "completed";
            task.result = result;
            task.error = null;
            task.ai_model = model;
            task.completed_at = new Date().toISOString();
            task.updated_at = task.completed_at;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM tasks WHERE id = ?")) {
            const index = tasks.findIndex(task => task.id === values[0]);
            if (index < 0) return { meta: { changes: 0 } };
            tasks.splice(index, 1);
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'blocked'")) {
            const [error, model, id] = values;
            const task = tasks.find(item => item.id === id);
            if (!task || task.status !== "in_progress") return { meta: { changes: 0 } };
            task.status = "blocked";
            task.error = error;
            task.ai_model = model;
            task.updated_at = new Date().toISOString();
            return { meta: { changes: 1 } };
          }
          throw new Error("Unexpected D1 run() query: " + sql);
        }
      };
      return statement;
    }
  };
  return db;
}

async function call(path, { method = "GET", key, body } = {}, env = {}) {
  const headers = new Headers();
  if (key) headers.set("x-hcw-key", key);
  if (body !== undefined) headers.set("content-type", "application/json");
  const request = new Request("https://hcw.test" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response = await worker.fetch(request, env);
  return { response, data: await response.json() };
}

const API_KEY = "test-only-secret";

test("health reports database, AI binding, and eight role profiles without exposing a key", async () => {
  const db = createDb();
  const { response, data } = await call("/health", {}, {
    DB: db,
    AI: { run: async () => ({}) },
    HCW_API_KEY: API_KEY
  });
  assert.equal(response.status, 200);
  assert.equal(data.status, "online");
  assert.equal(data.database, "connected");
  assert.equal(data.ai_engine, "binding_ready");
  assert.equal(data.agent_profiles, 8);
  assert.equal(data.ai_task_mode, "role_based_per_task");
  assert.equal(data.api_auth, "configured");
  assert.equal(JSON.stringify(data).includes(API_KEY), false);
});

test("protected task API rejects requests without a valid key", async () => {
  const { response, data } = await call("/api/tasks", {}, {
    DB: createDb(),
    HCW_API_KEY: API_KEY
  });
  assert.equal(response.status, 401);
  assert.equal(data.error, "Unauthorized");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("task creation validates required fields and PIC range", async () => {
  const env = { DB: createDb(), HCW_API_KEY: API_KEY };
  const missing = await call("/api/tasks", { method: "POST", key: API_KEY, body: { title: "", description: "Isi" } }, env);
  assert.equal(missing.response.status, 400);
  const invalidOwner = await call("/api/tasks", { method: "POST", key: API_KEY, body: { title: "Tes", description: "Isi", owner_id: 9 } }, env);
  assert.equal(invalidOwner.response.status, 400);
});

test("task can be created and listed with its assigned PIC", async () => {
  const db = createDb();
  const env = { DB: db, HCW_API_KEY: API_KEY };
  const created = await call("/api/tasks", {
    method: "POST", key: API_KEY,
    body: { title: "Susun hiring plan", description: "Buat rencana rekrutmen.", owner_id: 3 }
  }, env);
  assert.equal(created.response.status, 201);
  assert.equal(created.data.task.owner_id, 3);
  assert.equal(created.data.task.status, "queued");

  const listed = await call("/api/tasks", { key: API_KEY }, env);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.tasks.length, 1);
  assert.equal(listed.data.tasks[0].title, "Susun hiring plan");
});

test("task execution uses the assigned role prompt and persists the AI result", async () => {
  const db = createDb([{
    id: "task-123", title: "Buat interview guide", description: "Untuk posisi Sales Grosir.",
    owner_id: 3, status: "queued", result: null, error: null, ai_model: null,
    attempt_count: 0, started_at: null, completed_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }]);
  let receivedModel;
  let receivedMessages;
  let receivedOptions;
  const env = {
    DB: db,
    HCW_API_KEY: API_KEY,
    AI: {
      async run(model, input) {
        receivedModel = model;
        receivedMessages = input.messages;
        receivedOptions = input;
        return { choices: [{ message: { content: [{ type: "text", text: "Draft interview guide berhasil dibuat." }] } }] };
      }
    }
  };
  const { response, data } = await call("/api/tasks/task-123/run", { method: "POST", key: API_KEY }, env);
  assert.equal(response.status, 200);
  assert.equal(data.task.status, "completed");
  assert.equal(data.task.result, "Draft interview guide berhasil dibuat.");
  assert.equal(data.task.attempt_count, 1);
  assert.equal(receivedModel, "@cf/zai-org/glm-4.7-flash");
  assert.match(receivedMessages[0].content, /Talent Acquisition/);
  assert.equal(receivedOptions.chat_template_kwargs.enable_thinking, false);
  assert.equal(db.tasks[0].status, "completed");
});

test("AI failure marks the task blocked with a bounded error message", async () => {
  const db = createDb([{
    id: "task-fail", title: "Test", description: "Trigger error.",
    owner_id: 5, status: "queued", result: null, error: null, ai_model: null,
    attempt_count: 0, started_at: null, completed_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }]);
  const env = {
    DB: db,
    HCW_API_KEY: API_KEY,
    AI: { async run() { throw new Error("Simulated model failure"); } }
  };
  const { response, data } = await call("/api/tasks/task-fail/run", { method: "POST", key: API_KEY }, env);
  assert.equal(response.status, 502);
  assert.equal(data.error, "AI execution failed.");
  assert.equal(db.tasks[0].status, "blocked");
  assert.equal(db.tasks[0].error, "Simulated model failure");
  assert.equal(db.tasks[0].attempt_count, 1);
});

test("task execution rejects a task already claimed by another worker", async () => {
  const db = createDb([{
    id: "task-race", title: "Test", description: "Race condition.",
    owner_id: 1, status: "queued", result: null, error: null, ai_model: null,
    attempt_count: 0, started_at: null, completed_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }], { claimAllowed: false });
  const { response, data } = await call("/api/tasks/task-race/run", { method: "POST", key: API_KEY }, {
    DB: db, HCW_API_KEY: API_KEY, AI: { run: async () => ({}) }
  });
  assert.equal(response.status, 409);
  assert.match(data.error, /claimed by another execution/);
});

test("preflight requests expose the required CORS headers without authentication", async () => {
  const request = new Request("https://hcw.test/api/tasks", { method: "OPTIONS" });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
  assert.match(response.headers.get("access-control-allow-headers"), /x-hcw-key/);
});

test("task creation rejects non-object JSON and malformed task IDs return 400", async () => {
  const env = { DB: createDb(), HCW_API_KEY: API_KEY };
  const invalidBody = await call("/api/tasks", { method: "POST", key: API_KEY, body: null }, env);
  assert.equal(invalidBody.response.status, 400);
  assert.equal(invalidBody.data.error, "JSON body must be an object.");

  const malformedId = await call("/api/tasks/%E0%A4%A", { key: API_KEY }, env);
  assert.equal(malformedId.response.status, 400);
  assert.equal(malformedId.data.error, "Invalid task ID encoding.");
});

test("task creation is idempotent for a stable client_id and rejects conflicting reuse", async () => {
  const db = createDb();
  const env = { DB: db, HCW_API_KEY: API_KEY };
  const body = {
    title: "Susun manpower plan",
    description: "Impor dari browser lokal.",
    owner_id: 2,
    client_id: "local-task-1700000000000"
  };

  const first = await call("/api/tasks", { method: "POST", key: API_KEY, body }, env);
  assert.equal(first.response.status, 201);
  assert.equal(first.data.duplicate, false);
  assert.equal(db.tasks.length, 1);

  const retry = await call("/api/tasks", { method: "POST", key: API_KEY, body }, env);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.duplicate, true);
  assert.equal(retry.data.task.id, first.data.task.id);
  assert.equal(db.tasks.length, 1);

  const conflict = await call("/api/tasks", {
    method: "POST", key: API_KEY,
    body: { ...body, title: "Judul berbeda" }
  }, env);
  assert.equal(conflict.response.status, 409);
  assert.equal(db.tasks.length, 1);
});

test("task creation rejects an invalid client_id", async () => {
  const { response, data } = await call("/api/tasks", {
    method: "POST", key: API_KEY,
    body: { title: "Tes", description: "Isi", client_id: "invalid id with spaces" }
  }, { DB: createDb(), HCW_API_KEY: API_KEY });
  assert.equal(response.status, 400);
  assert.match(data.error, /client_id/);
});


test("only deployment smoke-test tasks can be deleted", async () => {
  const db = createDb([{
    id: "hcw-smoke-run-1", title: "Smoke test", description: "Temporary",
    owner_id: 1, status: "completed", result: "ok", error: null, ai_model: "test",
    attempt_count: 1, started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }, {
    id: "user-task-1", title: "User task", description: "Keep this",
    owner_id: 1, status: "queued", result: null, error: null, ai_model: null,
    attempt_count: 0, started_at: null, completed_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }]);
  const env = { DB: db, HCW_API_KEY: API_KEY };
  const forbidden = await call("/api/tasks/user-task-1", { method: "DELETE", key: API_KEY }, env);
  assert.equal(forbidden.response.status, 403);
  assert.equal(db.tasks.length, 2);

  const deleted = await call("/api/tasks/hcw-smoke-run-1", { method: "DELETE", key: API_KEY }, env);
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.data.deleted, true);
  assert.deepEqual(db.tasks.map(task => task.id), ["user-task-1"]);
});


test("task execution falls back to Workers AI response text when choices content is absent", async () => {
  const db = createDb([{
    id: "task-response-fallback", title: "Test response fallback", description: "Use response text.",
    owner_id: 1, status: "queued", result: null, error: null, ai_model: null,
    attempt_count: 0, started_at: null, completed_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }]);
  const env = {
    DB: db,
    HCW_API_KEY: API_KEY,
    AI: { async run() { return { response: "Fallback AI result." }; } }
  };
  const { response, data } = await call("/api/tasks/task-response-fallback/run", {
    method: "POST", key: API_KEY
  }, env);
  assert.equal(response.status, 200);
  assert.equal(data.task.status, "completed");
  assert.equal(data.task.result, "Fallback AI result.");
});

test("empty AI output records the model finish reason and blocks the task", async () => {
  const db = createDb([{
    id: "task-empty-finish", title: "Test empty completion", description: "Return no visible text.",
    owner_id: 5, status: "queued", result: null, error: null, ai_model: null,
    attempt_count: 0, started_at: null, completed_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }]);
  const env = {
    DB: db,
    HCW_API_KEY: API_KEY,
    AI: {
      async run() {
        return { choices: [{ message: { content: "" }, finish_reason: "length" }] };
      }
    }
  };
  const { response, data } = await call("/api/tasks/task-empty-finish/run", {
    method: "POST", key: API_KEY
  }, env);
  assert.equal(response.status, 502);
  assert.equal(data.detail, "AI returned no text (finish_reason: length).");
  assert.equal(db.tasks[0].status, "blocked");
  assert.equal(db.tasks[0].error, data.detail);
});
