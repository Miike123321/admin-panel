import React, { useEffect, useState } from "react";
import { API_URL } from "../../providers/constants";

interface IntegrationSettings {
  gemini: { configured: boolean; model: string };
  superset: { configured: boolean; endpoint: string; hasAccessToken: boolean };
  github: {
    configured: boolean;
    repository: string;
    baseBranch: string;
    hasAccessToken: boolean;
  };
}

type IntegrationName = "gemini" | "superset" | "github";

const emptySettings: IntegrationSettings = {
  gemini: { configured: false, model: "gemini-2.5-flash" },
  superset: { configured: false, endpoint: "", hasAccessToken: false },
  github: {
    configured: false,
    repository: "",
    baseBranch: "main",
    hasAccessToken: false,
  },
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Неизвестная ошибка";

const apiUrl = `${API_URL}/settings/integrations`;

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState(emptySettings);
  const [geminiModel, setGeminiModel] = useState(emptySettings.gemini.model);
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [supersetEndpoint, setSupersetEndpoint] = useState("");
  const [supersetAccessToken, setSupersetAccessToken] = useState("");
  const [githubRepository, setGithubRepository] = useState("");
  const [githubBaseBranch, setGithubBaseBranch] = useState("main");
  const [githubAccessToken, setGithubAccessToken] = useState("");
  const [clearSecrets, setClearSecrets] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [testing, setTesting] = useState<IntegrationName | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSettings = async () => {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? "Не удалось загрузить настройки.");
    }
    const loaded: IntegrationSettings = await response.json();
    setSettings(loaded);
    setGeminiModel(loaded.gemini.model);
    setSupersetEndpoint(loaded.superset.endpoint);
    setGithubRepository(loaded.github.repository);
    setGithubBaseBranch(loaded.github.baseBranch);
  };

  useEffect(() => {
    void loadSettings()
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
      .finally(() => setIsLoading(false));
  }, []);

  const persistSettings = async () => {
    setIsSaving(true);

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geminiModel,
          geminiApiKey,
          clearGeminiApiKey: clearSecrets.includes("gemini"),
          supersetEndpoint,
          supersetAccessToken,
          clearSupersetAccessToken: clearSecrets.includes("superset"),
          githubRepository,
          githubBaseBranch,
          githubAccessToken,
          clearGitHubAccessToken: clearSecrets.includes("github"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Не удалось сохранить настройки.");

      setGeminiApiKey("");
      setSupersetAccessToken("");
      setGithubAccessToken("");
      setClearSecrets([]);
      await loadSettings();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await persistSettings();
      setMessage("Настройки сохранены. Секреты зашифрованы на сервере.");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    }
  };

  const testConnection = async (integration: IntegrationName) => {
    setError("");
    setMessage("");

    const hasCredentials = {
      gemini:
        Boolean(geminiApiKey.trim() || settings.gemini.configured) &&
        !clearSecrets.includes("gemini"),
      superset:
        Boolean(
          supersetEndpoint.trim() &&
            (supersetAccessToken.trim() || settings.superset.hasAccessToken)
        ) && !clearSecrets.includes("superset"),
      github:
        Boolean(
          githubRepository.trim() &&
            (githubAccessToken.trim() || settings.github.hasAccessToken)
        ) && !clearSecrets.includes("github"),
    }[integration];

    if (!hasCredentials) {
      const required = {
        gemini: "Введите Gemini API key.",
        superset: "Укажите Superset MCP endpoint и access token.",
        github: "Укажите GitHub-репозиторий и access token.",
      }[integration];
      setError(required);
      return;
    }

    setTesting(integration);
    try {
      await persistSettings();
      const response = await fetch(`${apiUrl}/${integration}/test`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "Проверка соединения не прошла.");
      setMessage(`Подключение ${integrationLabel(integration)} работает.`);
    } catch (testError) {
      setError(getErrorMessage(testError));
    } finally {
      setTesting(null);
    }
  };

  const toggleClearSecret = (integration: string) => {
    setClearSecrets((current) =>
      current.includes(integration)
        ? current.filter((value) => value !== integration)
        : [...current, integration]
    );
  };

  if (isLoading) {
    return <div className="kanban-state" role="status">Загружаем настройки интеграций...</div>;
  }

  return (
    <div className="kanban-page settings-page">
      <header className="kanban-header">
        <div className="page-heading">
          <div className="page-eyebrow"><span /> ИНТЕГРАЦИИ · ЛОКАЛЬНАЯ КОНФИГУРАЦИЯ</div>
          <h1>Настройки</h1>
          <p>Подключения для AI-задач, Superset MCP и публикации кода в GitHub.</p>
        </div>
      </header>

      <div className="settings-notice" role="note">
        <strong>Секреты остаются на сервере.</strong>
        <span>
          Ключи шифруются перед сохранением в Neon и никогда не отправляются обратно
          в браузер. Интерфейс настроек доступен только с локальной панели.
        </span>
      </div>

      {error && <p className="settings-feedback error" role="alert">{error}</p>}
      {message && <p className="settings-feedback success" role="status">{message}</p>}

      <form className="integration-settings-form" onSubmit={handleSave}>
        <section className="integration-card">
          <div className="integration-card-header">
            <div className="integration-icon gemini-icon">✦</div>
            <div>
              <h2>Google Gemini</h2>
              <p>Модель для подготовки результата AI-задачи.</p>
            </div>
            <span className={`integration-status${settings.gemini.configured ? " connected" : ""}`}>
              {settings.gemini.configured ? "Ключ сохранён" : "Не подключено"}
            </span>
          </div>
          <div className="integration-fields">
            <label className="task-field">
              <span>Модель</span>
              <input
                className="task-input"
                value={geminiModel}
                onChange={(event) => setGeminiModel(event.target.value)}
                placeholder="gemini-2.5-flash"
                required
              />
            </label>
            <label className="task-field">
              <span>Gemini API key</span>
              <input
                className="task-input"
                type="password"
                autoComplete="new-password"
                value={geminiApiKey}
                onChange={(event) => setGeminiApiKey(event.target.value)}
                placeholder={settings.gemini.configured ? "Ключ сохранён — пустое поле его не изменит" : "Вставьте API key"}
              />
            </label>
          </div>
          {settings.gemini.configured && (
            <label className="settings-clear-secret">
              <input
                type="checkbox"
                checked={clearSecrets.includes("gemini")}
                onChange={() => toggleClearSecret("gemini")}
              />
              Удалить сохранённый ключ
            </label>
          )}
          <div className="integration-actions">
            <button type="button" className="integration-test-button" disabled={testing !== null || isSaving} onClick={() => void testConnection("gemini")}>
              {testing === "gemini" ? "Сохраняем и проверяем..." : "Проверить подключение"}
            </button>
          </div>
        </section>

        <section className="integration-card">
          <div className="integration-card-header">
            <div className="integration-icon superset-icon">S</div>
            <div>
              <h2>Superset MCP</h2>
              <p>Подключение к MCP по HTTPS; production работает только на чтение.</p>
            </div>
            <span className={`integration-status${settings.superset.configured ? " connected" : ""}`}>
              {settings.superset.configured ? "Данные сохранены" : "Не подключено"}
            </span>
          </div>
          <div className="integration-fields">
            <label className="task-field">
              <span>MCP endpoint</span>
              <input
                className="task-input"
                type="url"
                value={supersetEndpoint}
                onChange={(event) => setSupersetEndpoint(event.target.value)}
                placeholder="https://superset.example.com/mcp"
              />
            </label>
            <label className="task-field">
              <span>Access token</span>
              <input
                className="task-input"
                type="password"
                autoComplete="new-password"
                value={supersetAccessToken}
                onChange={(event) => setSupersetAccessToken(event.target.value)}
                placeholder={settings.superset.hasAccessToken ? "Токен сохранён — пустое поле его не изменит" : "Вставьте MCP token"}
              />
            </label>
          </div>
          <p className="integration-hint">
            Используется read-only MCP. Запись в production и выполнение зарплатных
            задач Gemini заблокированы.
          </p>
          {settings.superset.hasAccessToken && (
            <label className="settings-clear-secret">
              <input
                type="checkbox"
                checked={clearSecrets.includes("superset")}
                onChange={() => toggleClearSecret("superset")}
              />
              Удалить сохранённый токен
            </label>
          )}
          <div className="integration-actions">
            <button type="button" className="integration-test-button" disabled={testing !== null || isSaving} onClick={() => void testConnection("superset")}>
              {testing === "superset" ? "Сохраняем и проверяем..." : "Проверить подключение"}
            </button>
          </div>
        </section>

        <section className="integration-card">
          <div className="integration-card-header">
            <div className="integration-icon github-icon">⑂</div>
            <div>
              <h2>GitHub</h2>
              <p>Репозиторий для PR после проверки результата задачи.</p>
            </div>
            <span className={`integration-status${settings.github.configured ? " connected" : ""}`}>
              {settings.github.configured ? "Данные сохранены" : "Не подключено"}
            </span>
          </div>
          <div className="integration-fields github-fields">
            <label className="task-field">
              <span>Репозиторий (owner/repository)</span>
              <input
                className="task-input"
                value={githubRepository}
                onChange={(event) => setGithubRepository(event.target.value)}
                placeholder="company/project"
              />
            </label>
            <label className="task-field">
              <span>Базовая ветка</span>
              <input
                className="task-input"
                value={githubBaseBranch}
                onChange={(event) => setGithubBaseBranch(event.target.value)}
                placeholder="main"
              />
            </label>
            <label className="task-field">
              <span>GitHub token</span>
              <input
                className="task-input"
                type="password"
                autoComplete="new-password"
                value={githubAccessToken}
                onChange={(event) => setGithubAccessToken(event.target.value)}
                placeholder={settings.github.hasAccessToken ? "Токен сохранён — пустое поле его не изменит" : "Вставьте token с правами на PR"}
              />
            </label>
          </div>
          {settings.github.hasAccessToken && (
            <label className="settings-clear-secret">
              <input
                type="checkbox"
                checked={clearSecrets.includes("github")}
                onChange={() => toggleClearSecret("github")}
              />
              Удалить сохранённый токен
            </label>
          )}
          <div className="integration-actions">
            <button type="button" className="integration-test-button" disabled={testing !== null || isSaving} onClick={() => void testConnection("github")}>
              {testing === "github" ? "Сохраняем и проверяем..." : "Проверить подключение"}
            </button>
          </div>
        </section>

        <div className="task-modal-actions settings-save-actions">
          <button type="submit" className="modal-submit" disabled={isSaving}>
            {isSaving ? "Сохраняем..." : "Сохранить настройки"}
          </button>
        </div>
      </form>

      <section className="settings-roadmap">
        <h2>Основа AI-процесса</h2>
        <p>
          AI-исполнителя можно создать на странице «Ответственные»: назначенные ему
          задачи появятся в отдельном беклоге. Для карточек уже предусмотрены поля
          результата и кода, а колонка «Тест» оформляется как зона ревью.
        </p>
        <p>
          Сейчас экран сохраняет и проверяет подключения, но фоновое выполнение
          задач и создание Pull Request ещё не включены. Зарплатные задачи исключены
          из передачи Gemini; Superset настраивается только для чтения.
        </p>
      </section>
    </div>
  );
};

function integrationLabel(integration: IntegrationName) {
  switch (integration) {
    case "gemini":
      return "Gemini";
    case "superset":
      return "Superset MCP";
    case "github":
      return "GitHub";
  }
}
