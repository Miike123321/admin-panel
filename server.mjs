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
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const geminiModelFor = (settings) =>
  !settings.gemini?.model || settings.gemini.model === "gemini-2.5-flash"
    ? DEFAULT_GEMINI_MODEL
    : settings.gemini.model;
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
    ADD COLUMN IF NOT EXISTS ai_status varchar(20) NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS github_issue_url text,
    ADD COLUMN IF NOT EXISTS github_issue_number integer
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
  github_issue_url AS "githubIssueUrl",
  github_issue_number AS "githubIssueNumber",
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

const sensitiveTaskPattern =
  /зарплат|заработн|расч[её]т.{0,30}выплат|payroll|salary|wage|снилс|паспорт|персональн.{0,30}данн|личн.{0,30}данн|номер.{0,20}карт|банковск.{0,20}карт/iu;
const containsSensitiveTaskData = (value) =>
  sensitiveTaskPattern.test(value) ||
  /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(value) ||
  /(?:\+?\d[\s().-]*){10,15}/u.test(value);
const pendingGitHubIssues = new Set();

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

  if (request.method === "POST" && url.pathname === "/api/ai/task-assist") {
    if (!isAllowedSettingsOrigin(request.headers.origin)) {
      sendJson(response, 403, { message: "AI task assistance is available only from the local admin panel." });
      return;
    }

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
    const subsystem = values.subsystem;
    const taskId = values.taskId ?? null;
    if (
      (!title && !description) ||
      title.length > 255 ||
      description.length > 8_000 ||
      !taskSubsystems.has(subsystem) ||
      (taskId !== null &&
        (typeof taskId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)))
    ) {
      sendJson(response, 400, { message: "Укажите название или черновик описания и корректную подсистему." });
      return;
    }
    if (containsSensitiveTaskData(`${title}\n${description}`)) {
      sendJson(response, 400, { message: "Задачи с чувствительными персональными или платёжными данными нельзя отправлять Gemini." });
      return;
    }

    try {
      const settings = await readIntegrationSettings();
      if (!settings.gemini?.apiKey) {
        sendJson(response, 400, { message: "Сначала сохраните Gemini API key в Настройки → Google Gemini." });
        return;
      }

      const relatedTasks = await sql`
        SELECT id, title, description, status::text AS status, priority
        FROM tasks
        WHERE subsystem::text = ${subsystem}
        ORDER BY updated_at DESC
        LIMIT 50
      `;
      const context = relatedTasks
        .filter((task) =>
          task.id !== taskId &&
          !containsSensitiveTaskData(`${task.title}\n${task.description ?? ""}`)
        )
        .slice(0, 10)
        .map(({ title: taskTitle, description: taskDescription, status, priority }) => ({
          title: taskTitle,
          description: taskDescription?.slice(0, 400) ?? "",
          status,
          priority,
        }));

      const prompt = [
        "Помоги составить качественное описание задачи для разработки в J.A.R.V.I.S.",
        "Верни только готовый текст описания на русском языке: цель, требования и проверяемые критерии приёмки.",
        "Не выдумывай факты и решения. Если деталей не хватает, перечисли короткие уточняющие вопросы в конце.",
        "Учитывай контекст недавних задач только для согласованности терминов; не копируй их требования автоматически.",
        `Подсистема: ${subsystem}`,
        `Название: ${title || "(не указано)"}`,
        `Черновик описания:\n${description || "(пусто)"}`,
        `Другие недавние задачи этой подсистемы (без чувствительных задач):\n${JSON.stringify(context)}`,
      ].join("\n\n");

      const result = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModelFor(settings))}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": settings.gemini.apiKey,
          },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 1400 },
          }),
        }
      );
      if (!result.ok) {
        const status = result.status;
        sendJson(response, [402, 403, 429].includes(status) ? status : 502, {
          message:
            status === 402
              ? "Gemini API вернул HTTP 402: вероятно, исчерпаны предварительно оплаченные кредиты или проект требует настроить оплату. Проверка API key может проходить, но генерация блокируется. Проверьте проект и баланс в AI Studio; подписка Google AI не оплачивает Gemini API."
              : status === 429
                ? "Достигнут лимит Gemini API. Попробуйте позже или проверьте бесплатную квоту AI Studio."
                : status === 403
                  ? "Gemini API запретил генерацию для этого проекта или ключа. Проверьте доступ модели и настройки проекта в AI Studio."
                  : `Gemini API не выполнил запрос (HTTP ${status}). Проверьте модель и API key в настройках.`,
        });
        return;
      }

      const generated = await result.json();
      const suggestedDescription = generated.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!suggestedDescription) {
        sendJson(response, 502, { message: "Gemini вернул пустое описание. Попробуйте уточнить название задачи." });
        return;
      }
      sendJson(response, 200, { description: suggestedDescription });
    } catch (error) {
      console.error("Failed to assist with task description:", error);
      sendJson(response, 502, { message: "Не удалось получить подсказку Gemini. Проверьте подключение и повторите попытку." });
    }
    return;
  }

  const copilotIssueMatch = url.pathname.match(
    /^\/api\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/copilot$/i
  );
  if (request.method === "POST" && copilotIssueMatch) {
    if (!isAllowedSettingsOrigin(request.headers.origin)) {
      sendJson(response, 403, { message: "GitHub task handoff is available only from the local admin panel." });
      return;
    }

    const taskId = copilotIssueMatch[1];
    if (pendingGitHubIssues.has(taskId)) {
      sendJson(response, 409, { message: "GitHub issue is already being created for this task." });
      return;
    }
    pendingGitHubIssues.add(taskId);
    try {
      const [task] = await sql`
        SELECT
          id, title, description, subsystem, priority,
          github_issue_url AS "githubIssueUrl",
          ${hasAssigneeId ? sql`EXISTS (
            SELECT 1
            FROM users responsible
            WHERE responsible.id = tasks.assignee_id
              AND (lower(responsible.role) = 'ai' OR lower(responsible.full_name) IN ('ии', 'ai', 'jarvis'))
          )` : sql`false`} AS "isAiTask"
        FROM tasks
        WHERE id = ${taskId}
      `;
      if (!task) {
        sendJson(response, 404, { message: "Task not found." });
        return;
      }
      if (!task.isAiTask) {
        sendJson(response, 400, { message: "Only tasks assigned to the AI executor can be sent to Copilot." });
        return;
      }
      if (task.githubIssueUrl) {
        sendJson(response, 200, { url: task.githubIssueUrl, alreadyCreated: true });
        return;
      }
      if (containsSensitiveTaskData(`${task.title}\n${task.description ?? ""}`)) {
        sendJson(response, 400, { message: "Задачу с чувствительными персональными или платёжными данными нельзя отправить в GitHub." });
        return;
      }

      const settings = await readIntegrationSettings();
      const github = settings.github;
      if (
        !github?.repository ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(github.repository) ||
        !github.accessToken
      ) {
        sendJson(response, 400, { message: "Сначала сохраните GitHub-репозиторий и token в Настройки → GitHub." });
        return;
      }

      const body = [
        "## Задача из J.A.R.V.I.S.",
        `- Подсистема: **${task.subsystem}**`,
        `- Приоритет: **${task.priority}**`,
        `- Локальный ID: \`${task.id}\``,
        "",
        "## Описание",
        task.description?.trim() || "_Описание не добавлено._",
        "",
        "## Критерии выполнения",
        "- Изучить соответствующий код и существующие соглашения проекта.",
        "- Реализовать задачу и добавить или обновить проверки, если это уместно.",
        `- Проверить изменения относительно базовой ветки \`${github.baseBranch ?? "main"}\`.`,
        "- Подготовить Pull Request для ручного ревью. Не выполнять merge или deploy.",
        "",
        "_Issue создан из J.A.R.V.I.S. Чтобы начать выполнение, назначьте GitHub Copilot на этот issue в интерфейсе GitHub._",
      ].join("\n");
      const githubResponse = await fetch(
        `https://api.github.com/repos/${github.repository}/issues`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${github.accessToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "JARVIS-admin-panel",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: task.title, body }),
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (!githubResponse.ok) {
        const status = githubResponse.status;
        sendJson(response, status === 401 || status === 403 ? 403 : 502, {
          message:
            status === 401 || status === 403
              ? "GitHub отказал в доступе. Проверьте token и права на создание Issues."
              : `GitHub не создал issue (HTTP ${status}). Проверьте репозиторий и настройки.`,
        });
        return;
      }
      const issue = await githubResponse.json();
      if (
        !Number.isInteger(issue.number) ||
        typeof issue.html_url !== "string" ||
        !issue.html_url.startsWith("https://github.com/")
      ) {
        sendJson(response, 502, { message: "GitHub вернул некорректные данные issue." });
        return;
      }

      await sql`
        UPDATE tasks
        SET github_issue_url = ${issue.html_url},
            github_issue_number = ${issue.number},
            updated_at = now()
        WHERE id = ${taskId}
      `;
      sendJson(response, 201, { url: issue.html_url, number: issue.number });
    } catch (error) {
      console.error("Failed to hand task off to GitHub Copilot:", error);
      sendJson(response, 502, { message: "Не удалось создать GitHub issue. Проверьте подключение и настройки." });
    } finally {
      pendingGitHubIssues.delete(taskId);
    }
    return;
  }

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
            model: geminiModelFor(settings),
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
          const model = geminiModelFor(settings);
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
    const status = values.status ?? "todo";
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
      const imageColumn = hasImageUrl ? sql`, image_url` : sql``;
      const imageValue = hasImageUrl ? sql`, ${imageUrl}` : sql``;
      const assigneeColumn = hasAssigneeId ? sql`, assignee_id` : sql``;
      const assigneeValue = hasAssigneeId ? sql`, ${assigneeId}` : sql``;
      const [task] = await sql`
        WITH created_task AS (
        INSERT INTO tasks (title, description${imageColumn}, status, subsystem, priority${assigneeColumn}, ai_status)
        VALUES (${title}, ${description || null}${imageValue}, ${status}, ${subsystem}, ${priority}${assigneeValue}, 'none')
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
          task.id
        FROM tasks task
        WHERE task.id = ${taskId}
      `;
      if (!existingTask) {
        sendJson(response, 404, { message: "Task not found." });
        return;
      }

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
        (typeof values.aiCode !== "string" || values.aiCode.length > 1_500_000)
      ) {
        sendJson(response, 400, { message: "AI code must be text no longer than 1.5 MB." });
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
            status = COALESCE(${values.status ?? null}, status),
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