import "dotenv/config";
import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set to start the tasks API.");
}

const port = Number(process.env.API_PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("API_PORT must be a valid TCP port.");
}

const sql = neon(databaseUrl);
const taskStatuses = new Set(["todo", "in_progress", "test", "done", "waiting"]);
const taskSubsystems = new Set(["db", "backend", "frontend", "admin", "infra"]);
const taskPriorities = new Set(["p0", "p1", "p2", "p3"]);
const settingsKeyPath =
  process.env.JARVIS_SETTINGS_KEY_FILE ??
  join(homedir(), ".jarvis-admin", "settings.key");

const loadSettingsKey = async () => {
  await mkdir(dirname(settingsKeyPath), { recursive: true, mode: 0o700 });
  try {
    const key = await readFile(settingsKeyPath);
    if (key.length !== 32) {
      throw new Error("The integration settings encryption key must be 32 bytes.");
    }
    return key;
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }

    const key = randomBytes(32);
    try {
      await writeFile(settingsKeyPath, key, { flag: "wx", mode: 0o600 });
      return key;
    } catch (writeError) {
      if (!writeError || typeof writeError !== "object" || !("code" in writeError) || writeError.code !== "EEXIST") {
        throw writeError;
      }
      const existingKey = await readFile(settingsKeyPath);
      if (existingKey.length !== 32) {
        throw new Error("The integration settings encryption key must be 32 bytes.");
      }
      return existingKey;
    }
  }
};

const settingsKey = await loadSettingsKey();
await chmod(dirname(settingsKeyPath), 0o700);
await chmod(settingsKeyPath, 0o600);
const encryptSettings = (settings) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", settingsKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(settings), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
};
const decryptSettings = (encrypted) => {
  const payload = Buffer.from(encrypted, "base64");
  if (payload.length < 29) {
    throw new Error("Stored integration settings are invalid.");
  }
  const decipher = createDecipheriv("aes-256-gcm", settingsKey, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8")
  );
};

await sql`
  CREATE TABLE IF NOT EXISTS admin_integration_settings (
    id integer PRIMARY KEY CHECK (id = 1),
    encrypted_settings text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

const readIntegrationSettings = async () => {
  const [row] = await sql`
    SELECT encrypted_settings
    FROM admin_integration_settings
    WHERE id = 1
  `;
  return row ? decryptSettings(row.encrypted_settings) : {};
};

const isAllowedSettingsOrigin = (origin) =>
  !origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

await sql`
  ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS ai_result text,
    ADD COLUMN IF NOT EXISTS ai_code text,
    ADD COLUMN IF NOT EXISTS ai_status varchar(20) NOT NULL DEFAULT 'none'
`;

const taskColumnRows = await sql`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'tasks'
`;
const taskColumnNames = new Set(taskColumnRows.map(({ column_name }) => column_name));
const hasImageUrl = taskColumnNames.has("image_url");
const hasAssigneeId = taskColumnNames.has("assignee_id");

await sql`
  CREATE TABLE IF NOT EXISTS task_completion_points (
    task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    points integer NOT NULL DEFAULT 10 CHECK (points > 0),
    awarded_at timestamptz NOT NULL DEFAULT now()
  )
`;

if (hasAssigneeId) {
  await sql`
    INSERT INTO task_completion_points (task_id, user_id, points)
    SELECT id, assignee_id, 10
    FROM tasks
    WHERE status::text = 'done' AND assignee_id IS NOT NULL
    ON CONFLICT (task_id) DO NOTHING
  `;
}

const taskColumns = `
  id,
  title,
  description,
  ${hasImageUrl ? 'image_url AS "imageUrl"' : 'NULL::text AS "imageUrl"'},
  ${taskColumnNames.has("is_verified") ? 'is_verified AS "isVerified"' : 'false AS "isVerified"'},
  CASE status::text
    WHEN 'backlog' THEN 'todo'
    WHEN 'review' THEN 'test'
    WHEN 'issue' THEN 'waiting'
    ELSE status::text
  END AS status,
  subsystem,
  priority,
  ${hasAssigneeId ? 'assignee_id AS "assigneeId"' : 'NULL::uuid AS "assigneeId"'},
  ai_result AS "aiResult",
  ai_code AS "aiCode",
  ai_status AS "aiStatus",
  ${hasAssigneeId ? `EXISTS (
    SELECT 1
    FROM users responsible
    WHERE responsible.id = tasks.assignee_id
      AND (lower(responsible.role) = 'ai' OR lower(responsible.full_name) IN ('ии', 'ai', 'jarvis'))
  ) AS "isAiTask"` : 'false AS "isAiTask"'},
  issue_reason AS "issueReason",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

// Вспомогательная функция отправки JSON с настройкой CORS
const sendJson = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-total-count",
    "Access-Control-Expose-Headers": "x-total-count",
  });
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) {
      throw new Error("Request body is too large.");
    }
  }
  return JSON.parse(body || "{}");
};

const server = createServer(async (request, response) => {
  // 1. Перехват CORS preflight (OPTIONS) запросов от браузера
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-total-count",
      "Access-Control-Expose-Headers": "x-total-count",
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname.startsWith("/api/settings/integrations")) {
    if (!isAllowedSettingsOrigin(request.headers.origin)) {
      sendJson(response, 403, { message: "Integration settings are available only from the local admin panel." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/settings/integrations") {
      try {
        const settings = await readIntegrationSettings();
        const mcpEndpoint = settings.superset?.endpoint
          ? new URL(settings.superset.endpoint)
          : null;
        sendJson(response, 200, {
          gemini: {
            configured: Boolean(settings.gemini?.apiKey),
            model: settings.gemini?.model ?? "gemini-2.5-flash",
          },
          superset: {
            configured: Boolean(settings.superset?.endpoint && settings.superset?.accessToken),
            endpoint: mcpEndpoint ? `${mcpEndpoint.origin}${mcpEndpoint.pathname}` : "",
            hasAccessToken: Boolean(settings.superset?.accessToken),
          },
          github: {
            configured: Boolean(settings.github?.accessToken && settings.github?.repository),
            repository: settings.github?.repository ?? "",
            baseBranch: settings.github?.baseBranch ?? "main",
            hasAccessToken: Boolean(settings.github?.accessToken),
          },
        });
      } catch (error) {
        console.error("Failed to load integration settings:", error);
        sendJson(response, 500, { message: "Failed to load integration settings." });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/settings/integrations") {
      let values;
      try {
        values = await readJsonBody(request);
      } catch (error) {
        sendJson(response, 400, {
          message:
            error instanceof SyntaxError
              ? "Request body must be valid JSON."
              : error instanceof Error
                ? error.message
                : "Invalid request body.",
        });
        return;
      }

      try {
        const settings = await readIntegrationSettings();
        const gemini = { ...settings.gemini };
        const superset = { ...settings.superset };
        const github = { ...settings.github };

        if (typeof values.geminiModel === "string") {
          const model = values.geminiModel.trim();
          if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) {
            sendJson(response, 400, { message: "Invalid Gemini model name." });
            return;
          }
          gemini.model = model;
        }
        if (typeof values.geminiApiKey === "string" && values.geminiApiKey.trim()) {
          if (values.geminiApiKey.trim().length > 4096) {
            sendJson(response, 400, { message: "Gemini API key is too long." });
            return;
          }
          gemini.apiKey = values.geminiApiKey.trim();
        }
        if (values.clearGeminiApiKey === true) delete gemini.apiKey;

        if (typeof values.supersetEndpoint === "string") {
          const endpoint = values.supersetEndpoint.trim();
          if (endpoint) {
            let parsedEndpoint;
            try {
              parsedEndpoint = new URL(endpoint);
            } catch {
              sendJson(response, 400, { message: "Superset MCP endpoint must be a valid URL." });
              return;
            }
            if (
              !["https:", "http:"].includes(parsedEndpoint.protocol) ||
              (parsedEndpoint.protocol === "http:" &&
                !["localhost", "127.0.0.1"].includes(parsedEndpoint.hostname)) ||
              parsedEndpoint.username ||
              parsedEndpoint.password ||
              parsedEndpoint.search ||
              parsedEndpoint.hash
            ) {
              sendJson(response, 400, {
                message: "Use an HTTPS MCP endpoint without credentials, query parameters, or fragments.",
              });
              return;
            }
            superset.endpoint = parsedEndpoint.toString().replace(/\/$/, "");
          } else {
            delete superset.endpoint;
          }
        }
        if (typeof values.supersetAccessToken === "string" && values.supersetAccessToken.trim()) {
          if (values.supersetAccessToken.trim().length > 4096) {
            sendJson(response, 400, { message: "Superset MCP token is too long." });
            return;
          }
          superset.accessToken = values.supersetAccessToken.trim();
        }
        if (values.clearSupersetAccessToken === true) delete superset.accessToken;

        if (typeof values.githubRepository === "string") {
          const repository = values.githubRepository.trim();
          if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
            sendJson(response, 400, { message: "GitHub repository must use owner/repository format." });
            return;
          }
          github.repository = repository;
        }
        if (typeof values.githubBaseBranch === "string") {
          const baseBranch = values.githubBaseBranch.trim();
          if (baseBranch && !/^[A-Za-z0-9._/-]{1,255}$/.test(baseBranch)) {
            sendJson(response, 400, { message: "Invalid GitHub base branch." });
            return;
          }
          github.baseBranch = baseBranch || "main";
        }
        if (typeof values.githubAccessToken === "string" && values.githubAccessToken.trim()) {
          if (values.githubAccessToken.trim().length > 4096) {
            sendJson(response, 400, { message: "GitHub token is too long." });
            return;
          }
          github.accessToken = values.githubAccessToken.trim();
        }
        if (values.clearGitHubAccessToken === true) delete github.accessToken;

        const updatedSettings = { gemini, superset, github };
        await sql`
          INSERT INTO admin_integration_settings (id, encrypted_settings, updated_at)
          VALUES (1, ${encryptSettings(updatedSettings)}, now())
          ON CONFLICT (id) DO UPDATE
          SET encrypted_settings = EXCLUDED.encrypted_settings, updated_at = now()
        `;
        sendJson(response, 200, { saved: true });
      } catch (error) {
        console.error("Failed to save integration settings:", error);
        sendJson(response, 500, { message: "Failed to save integration settings." });
      }
      return;
    }

    const integrationTestMatch = url.pathname.match(
      /^\/api\/settings\/integrations\/(gemini|superset|github)\/test$/
    );
    if (request.method === "POST" && integrationTestMatch) {
      try {
        const settings = await readIntegrationSettings();
        const integration = integrationTestMatch[1];
        const timeout = AbortSignal.timeout(10_000);
        let connected = false;

        if (integration === "gemini") {
          if (!settings.gemini?.apiKey) {
            sendJson(response, 400, { message: "Save a Gemini API key before testing the connection." });
            return;
          }
          const model = settings.gemini.model ?? "gemini-2.5-flash";
          const result = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
            { headers: { "x-goog-api-key": settings.gemini.apiKey }, signal: timeout }
          );
          connected = result.ok;
        } else if (integration === "github") {
          if (!settings.github?.accessToken || !settings.github?.repository) {
            sendJson(response, 400, { message: "Save the GitHub token and repository before testing the connection." });
            return;
          }
          const result = await fetch(
            `https://api.github.com/repos/${settings.github.repository}`,
            {
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${settings.github.accessToken}`,
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "JARVIS-admin-panel",
              },
              signal: timeout,
            }
          );
          connected = result.ok;
        } else {
          const config = settings.superset;
          if (!config?.endpoint || !config?.accessToken) {
            sendJson(response, 400, { message: "Save the Superset MCP endpoint and token before testing the connection." });
            return;
          }
          const headers = {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.accessToken}`,
          };
          const initializeResponse = await fetch(config.endpoint, {
            method: "POST",
            headers,
            signal: timeout,
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-03-26",
                capabilities: {},
                clientInfo: { name: "JARVIS admin panel", version: "1.0.0" },
              },
            }),
          });
          if (!initializeResponse.ok) {
            sendJson(response, 502, { message: "Superset MCP initialization failed. Check its URL and token." });
            return;
          }
          const sessionId = initializeResponse.headers.get("mcp-session-id");
          const initializedHeaders = {
            ...headers,
            "MCP-Protocol-Version": "2025-03-26",
            ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
          };
          const toolsResponse = await fetch(config.endpoint, {
            method: "POST",
            headers: initializedHeaders,
            signal: timeout,
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "tools/list",
              params: {},
            }),
          });
          connected = toolsResponse.ok;
        }

        if (!connected) {
          sendJson(response, 502, { message: `Could not connect to ${integration}. Verify the settings and access permissions.` });
          return;
        }
        sendJson(response, 200, { connected: true });
      } catch (error) {
        console.error("Integration connection test failed:", error);
        sendJson(response, 502, {
          message:
            error instanceof Error && error.name === "TimeoutError"
              ? "Connection test timed out."
              : "Connection test failed. Check the integration settings and try again.",
        });
      }
      return;
    }

    sendJson(response, 404, { message: "Not found." });
    return;
  }

  // Health check
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/responsibles") {
    try {
      const users = await sql`
        SELECT id, full_name AS "fullName", email, role, created_at AS "createdAt"
        FROM users
        ORDER BY full_name ASC
      `;
      response.setHeader("x-total-count", String(users.length));
      sendJson(response, 200, users);
    } catch (error) {
      console.error("Failed to fetch responsibles:", error);
      sendJson(response, 500, { message: "Failed to fetch responsibles." });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/responsibles") {
    let values;
    try {
      values = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, {
        message:
          error instanceof SyntaxError
            ? "Request body must be valid JSON."
            : error instanceof Error
              ? error.message
              : "Invalid request body.",
      });
      return;
    }

    const fullName = typeof values.fullName === "string" ? values.fullName.trim() : "";
    const email = typeof values.email === "string" ? values.email.trim().toLowerCase() : "";
    const role = values.role === "ai" ? "ai" : "responsible";
    if (!fullName || fullName.length > 255) {
      sendJson(response, 400, { message: "Name is required (max 255 chars)." });
      return;
    }
    if (
      email.length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      sendJson(response, 400, { message: "A valid email is required." });
      return;
    }

    try {
      const [user] = await sql`
        INSERT INTO users (full_name, email, role)
        VALUES (${fullName}, ${email}, ${role})
        RETURNING id, full_name AS "fullName", email, role, created_at AS "createdAt"
      `;
      sendJson(response, 201, user);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        sendJson(response, 409, { message: "A responsible with this email already exists." });
        return;
      }
      console.error("Failed to create responsible:", error);
      sendJson(response, 500, { message: "Failed to create responsible." });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/leaderboard") {
    try {
      const leaderboard = await sql`
        SELECT
          u.id,
          u.full_name AS "fullName",
          u.email,
          COALESCE(SUM(tcp.points), 0)::int AS points,
          COUNT(tcp.task_id)::int AS "completedTasks"
        FROM users u
        LEFT JOIN task_completion_points tcp ON tcp.user_id = u.id
        GROUP BY u.id, u.full_name, u.email
        ORDER BY points DESC, "completedTasks" DESC, u.full_name ASC
      `;
      response.setHeader("x-total-count", String(leaderboard.length));
      sendJson(response, 200, leaderboard);
    } catch (error) {
      console.error("Failed to fetch leaderboard:", error);
      sendJson(response, 500, { message: "Failed to fetch leaderboard." });
    }
    return;
  }

  // GET /api/tasks — Получение списка задач
  if (request.method === "GET" && url.pathname === "/api/tasks") {
    const startValue = Number(url.searchParams.get("_start") ?? 0);
    const endValue = Number(url.searchParams.get("_end") ?? 50);
    
    if (!Number.isInteger(startValue) || !Number.isInteger(endValue) || startValue < 0) {
      sendJson(response, 400, { message: "Invalid task pagination." });
      return;
    }

    const limit = Math.min(Math.max(endValue - startValue, 1), 100);

    try {
      const [tasks, totals] = await Promise.all([
        sql`SELECT ${sql.unsafe(taskColumns)} FROM tasks ORDER BY created_at DESC LIMIT ${limit} OFFSET ${startValue}`,
        sql`SELECT count(*)::int AS total FROM tasks`,
      ]);

      response.setHeader("x-total-count", String(totals[0]?.total ?? 0));
      sendJson(response, 200, tasks);
    } catch (error) {
      console.error("Failed to fetch tasks from database:", error);
      sendJson(response, 500, { message: "Failed to fetch tasks." });
    }
    return;
  }

  // POST /api/tasks — Создание новой задачи
  if (request.method === "POST" && url.pathname === "/api/tasks") {
    let values;
    try {
      values = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, {
        message:
          error instanceof SyntaxError
            ? "Request body must be valid JSON."
            : error instanceof Error
              ? error.message
              : "Invalid request body.",
      });
      return;
    }

    const title = typeof values.title === "string" ? values.title.trim() : "";
    const description = typeof values.description === "string" ? values.description.trim() : "";
    const imageUrl = typeof values.imageUrl === "string" ? values.imageUrl.trim() : null;
    let status = values.status ?? "todo";
    const subsystem = values.subsystem ?? "admin";
    const priority = values.priority ?? "p2";
    const assigneeId = values.assigneeId ?? null;

    if (!title || title.length > 255) {
      sendJson(response, 400, { message: "Task title is required (max 255 chars)." });
      return;
    }
    if (imageUrl && !hasImageUrl) {
      sendJson(response, 400, {
        message: "Image previews are unavailable until the image_url column is added to tasks.",
      });
      return;
    }
    if (!taskStatuses.has(status)) {
      sendJson(response, 400, { message: "Invalid task status." });
      return;
    }
    if (!taskSubsystems.has(subsystem)) {
      sendJson(response, 400, { message: "Invalid task subsystem." });
      return;
    }
    if (!taskPriorities.has(priority)) {
      sendJson(response, 400, { message: "Invalid task priority." });
      return;
    }
    if (assigneeId !== null && !hasAssigneeId) {
      sendJson(response, 400, { message: "Task assignment is unavailable in the database schema." });
      return;
    }
    if (
      assigneeId !== null &&
      (typeof assigneeId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assigneeId))
    ) {
      sendJson(response, 400, { message: "Invalid task assignee." });
      return;
    }

    try {
      let isAiTask = false;
      if (assigneeId) {
        const [assignee] = await sql`
          SELECT role, full_name AS "fullName"
          FROM users
          WHERE id = ${assigneeId}
        `;
        isAiTask =
          assignee?.role === "ai" ||
          ["ии", "ai", "jarvis"].includes(assignee?.fullName?.trim().toLowerCase());
      }
      if (isAiTask) status = "todo";
      const imageColumn = hasImageUrl ? sql`, image_url` : sql``;
      const imageValue = hasImageUrl ? sql`, ${imageUrl}` : sql``;
      const assigneeColumn = hasAssigneeId ? sql`, assignee_id` : sql``;
      const assigneeValue = hasAssigneeId ? sql`, ${assigneeId}` : sql``;
      const [task] = await sql`
        WITH created_task AS (
        INSERT INTO tasks (title, description${imageColumn}, status, subsystem, priority${assigneeColumn}, ai_status)
        VALUES (${title}, ${description || null}${imageValue}, ${status}, ${subsystem}, ${priority}${assigneeValue}, ${isAiTask ? "queued" : "none"})
        RETURNING ${sql.unsafe(taskColumns)}
        ), awarded_points AS (
          INSERT INTO task_completion_points (task_id, user_id, points)
          SELECT id, "assigneeId", 10
          FROM created_task
          WHERE status = 'done' AND "assigneeId" IS NOT NULL
          ON CONFLICT (task_id) DO NOTHING
        )
        SELECT * FROM created_task
      `;
      sendJson(response, 201, task);
    } catch (error) {
      console.error("Failed to create task:", error);
      sendJson(response, 500, { message: "Failed to create task." });
    }
    return;
  }

  // PATCH /api/tasks/:id — Обновление полей задачи
  const taskIdMatch = url.pathname.match(
    /^\/api\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
  );

  if (request.method === "DELETE" && taskIdMatch) {
    const taskId = taskIdMatch[1];
    try {
      const [task] = await sql`
        DELETE FROM tasks
        WHERE id = ${taskId}
        RETURNING id
      `;

      if (!task) {
        sendJson(response, 404, { message: "Task not found." });
        return;
      }

      sendJson(response, 200, task);
    } catch (error) {
      console.error("Failed to delete task:", error);
      sendJson(response, 500, { message: "Failed to delete task." });
    }
    return;
  }

  if ((request.method === "PATCH" || request.method === "PUT") && taskIdMatch) {
    const taskId = taskIdMatch[1];
    try {
      const values = await readJsonBody(request);

      if (values.status !== undefined && !taskStatuses.has(values.status)) {
        sendJson(response, 400, { message: "Invalid task status." });
        return;
      }
      if (
        values.subsystem !== undefined &&
        !taskSubsystems.has(values.subsystem)
      ) {
        sendJson(response, 400, { message: "Invalid task subsystem." });
        return;
      }
      if (
        values.priority !== undefined &&
        !taskPriorities.has(values.priority)
      ) {
        sendJson(response, 400, { message: "Invalid task priority." });
        return;
      }
      if (
        values.title !== undefined &&
        (typeof values.title !== "string" ||
          !values.title.trim() ||
          values.title.trim().length > 255)
      ) {
        sendJson(response, 400, {
          message: "Task title is required (max 255 chars).",
        });
        return;
      }
      if (
        values.description !== undefined &&
        values.description !== null &&
        typeof values.description !== "string"
      ) {
        sendJson(response, 400, { message: "Invalid task description." });
        return;
      }
      if (
        values.imageUrl !== undefined &&
        values.imageUrl !== null &&
        (typeof values.imageUrl !== "string" ||
          !/^https?:\/\//i.test(values.imageUrl))
      ) {
        sendJson(response, 400, { message: "Invalid task image URL." });
        return;
      }
      if (
        values.assigneeId !== undefined &&
        values.assigneeId !== null &&
        (typeof values.assigneeId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.assigneeId))
      ) {
        sendJson(response, 400, { message: "Invalid task assignee." });
        return;
      }
      if (values.assigneeId !== undefined && !hasAssigneeId) {
        sendJson(response, 400, { message: "Task assignment is unavailable in the database schema." });
        return;
      }

      const [existingTask] = await sql`
        SELECT
          task.status::text AS status,
          ${hasAssigneeId ? sql`task.assignee_id` : sql`NULL::uuid`} AS "assigneeId",
          ${hasAssigneeId ? sql`responsible.role` : sql`NULL::text`} AS "assigneeRole",
          ${hasAssigneeId ? sql`responsible.full_name` : sql`NULL::text`} AS "assigneeName",
          task.ai_status AS "aiStatus"
        FROM tasks task
        ${hasAssigneeId ? sql`LEFT JOIN users responsible ON responsible.id = task.assignee_id` : sql``}
        WHERE task.id = ${taskId}
      `;
      if (!existingTask) {
        sendJson(response, 404, { message: "Task not found." });
        return;
      }

      const wasAiTask =
        existingTask.assigneeRole === "ai" ||
        ["ии", "ai", "jarvis"].includes(existingTask.assigneeName?.trim().toLowerCase());
      let isAiTask = wasAiTask;
      if (Object.hasOwn(values, "assigneeId")) {
        if (values.assigneeId === null) {
          isAiTask = false;
        } else if (values.assigneeId === existingTask.assigneeId) {
          isAiTask = wasAiTask;
        } else {
          const [assignee] = await sql`
            SELECT role, full_name AS "fullName"
            FROM users
            WHERE id = ${values.assigneeId}
          `;
          isAiTask =
            assignee?.role === "ai" ||
            ["ии", "ai", "jarvis"].includes(assignee?.fullName?.trim().toLowerCase());
        }
      }
      const nextStatus =
        isAiTask && !wasAiTask && Object.hasOwn(values, "assigneeId")
          ? "todo"
          : values.status ?? null;
      const nextAiStatus = isAiTask
        ? wasAiTask
          ? existingTask.aiStatus
          : "queued"
        : "none";

      if (
        values.aiResult !== undefined &&
        values.aiResult !== null &&
        (typeof values.aiResult !== "string" || values.aiResult.length > 200_000)
      ) {
        sendJson(response, 400, { message: "AI result must be text no longer than 200 KB." });
        return;
      }
      if (
        values.aiCode !== undefined &&
        values.aiCode !== null &&
        (typeof values.aiCode !== "string" || values.aiCode.length > 500_000)
      ) {
        sendJson(response, 400, { message: "AI code must be text no longer than 500 KB." });
        return;
      }

      const [task] = await sql`
        WITH previous_task AS (
          SELECT status::text AS previous_status
          FROM tasks
          WHERE id = ${taskId}
        ), updated_task AS (
          UPDATE tasks
          SET
            status = COALESCE(${nextStatus}, status),
            title = COALESCE(${values.title ?? null}, title),
            description = CASE
              WHEN ${Object.hasOwn(values, "description")} THEN ${values.description ?? null}
              ELSE description
            END,
            subsystem = COALESCE(${values.subsystem ?? null}, subsystem),
            priority = COALESCE(${values.priority ?? null}, priority),
            ${hasImageUrl ? sql`image_url = CASE WHEN ${Object.hasOwn(values, "imageUrl")} THEN ${values.imageUrl ?? null} ELSE image_url END,` : sql``}
            ${hasAssigneeId ? sql`assignee_id = CASE WHEN ${Object.hasOwn(values, "assigneeId")} THEN ${values.assigneeId ?? null} ELSE assignee_id END,` : sql``}
            ai_result = CASE WHEN ${Object.hasOwn(values, "aiResult")} THEN ${values.aiResult ?? null} ELSE ai_result END,
            ai_code = CASE WHEN ${Object.hasOwn(values, "aiCode")} THEN ${values.aiCode ?? null} ELSE ai_code END,
            ai_status = ${nextAiStatus},
            updated_at = now()
          WHERE id = ${taskId}
          RETURNING ${sql.unsafe(taskColumns)}
        ), awarded_points AS (
          INSERT INTO task_completion_points (task_id, user_id, points)
          SELECT updated_task.id, updated_task."assigneeId", 10
          FROM updated_task
          CROSS JOIN previous_task
          WHERE previous_task.previous_status <> 'done'
            AND updated_task.status = 'done'
            AND updated_task."assigneeId" IS NOT NULL
          ON CONFLICT (task_id) DO NOTHING
        )
        SELECT * FROM updated_task
      `;

      if (!task) {
        sendJson(response, 404, { message: "Task not found." });
        return;
      }

      sendJson(response, 200, task);
    } catch (error) {
      console.error("Failed to update task:", error);
      sendJson(response, 400, { message: "Failed to update task." });
    }
    return;
  }

  sendJson(response, 404, { message: "Not found." });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`🚀 Tasks API listening on http://127.0.0.1:${port}`);
});

server.on("error", (error) => {
  console.error("Tasks API server error:", error);
  process.exitCode = 1;
});