import React, { useState } from "react";
import {
  type BaseRecord,
  useCreate,
  useInvalidate,
  useList,
} from "@refinedev/core";

interface Responsible extends BaseRecord {
  id: string;
  fullName: string;
  email: string;
  role?: string;
}

interface LeaderboardEntry extends Responsible {
  points: number;
  completedTasks: number;
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Неизвестная ошибка";

const podiumOrder = [1, 0, 2];

export const ResponsiblesPage: React.FC = () => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"responsible" | "ai">("responsible");
  const [formError, setFormError] = useState("");

  const {
    result: { data: responsibles },
    query: { isLoading: responsiblesLoading, isError: responsiblesError, error },
  } = useList<Responsible>({
    resource: "responsibles",
    pagination: { mode: "off" },
  });
  const {
    result: { data: leaderboard },
    query: {
      isLoading: leaderboardLoading,
      isError: leaderboardError,
      error: leaderboardLoadError,
    },
  } = useList<LeaderboardEntry>({
    resource: "leaderboard",
    pagination: { mode: "off" },
  });
  const { mutate: createResponsible, mutation } = useCreate<Responsible>();
  const invalidate = useInvalidate();

  const handleCreateResponsible = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    createResponsible(
      {
        resource: "responsibles",
        values: { fullName: fullName.trim(), email: email.trim(), role },
      },
      {
        onSuccess: () => {
          setFullName("");
          setEmail("");
          setRole("responsible");
          setIsFormOpen(false);
          void invalidate({
            resource: "leaderboard",
            invalidates: ["list"],
          });
        },
        onError: (createError) => {
          setFormError(getErrorMessage(createError));
        },
      }
    );
  };

  if (responsiblesLoading || leaderboardLoading) {
    return (
      <div className="kanban-state" role="status">
        Загружаем таблицу команды...
      </div>
    );
  }

  if (responsiblesError || leaderboardError) {
    const message = getErrorMessage(error ?? leaderboardLoadError);
    return (
      <div className="kanban-state kanban-state-error" role="alert">
        Не удалось загрузить таблицу команды: {message}
      </div>
    );
  }

  const ranked = [...leaderboard].sort(
    (first, second) =>
      second.points - first.points ||
      second.completedTasks - first.completedTasks ||
      first.fullName.localeCompare(second.fullName, "ru")
  );
  const podium = podiumOrder
    .map((index) => ranked[index])
    .filter((entry): entry is LeaderboardEntry => Boolean(entry));
  const totalPoints = ranked.reduce((sum, entry) => sum + entry.points, 0);

  return (
    <div className="kanban-page responsibles-page">
      <header className="kanban-header">
        <div className="page-heading">
          <div className="page-eyebrow"><span /> КОМАНДА · ГОНКА ЗА ОЧКАМИ</div>
          <h1>Пилоты команды</h1>
          <p>Назначайте исполнителей и следите за чемпионатом задач.</p>
        </div>
        <button
          type="button"
          className="create-task-button"
          onClick={() => {
            setFormError("");
            setIsFormOpen((open) => !open);
          }}
        >
          <span aria-hidden="true">＋</span> Новый ответственный
        </button>
      </header>

      <section className="overview-grid leaderboard-overview" aria-label="Статистика команды">
        <article className="overview-card">
          <div className="overview-icon green" aria-hidden="true">♟</div>
          <div>
            <p>Пилоты</p>
            <strong>{responsibles.length}</strong>
          </div>
          <span className="overview-decoration" aria-hidden="true" />
        </article>
        <article className="overview-card">
          <div className="overview-icon green" aria-hidden="true">🏁</div>
          <div>
            <p>Очки чемпионата</p>
            <strong>{totalPoints}</strong>
          </div>
          <span className="overview-decoration" aria-hidden="true" />
        </article>
        <article className="overview-card">
          <div className="overview-icon green" aria-hidden="true">✓</div>
          <div>
            <p>Финишировали</p>
            <strong>{ranked.reduce((sum, entry) => sum + entry.completedTasks, 0)}</strong>
          </div>
          <span className="overview-decoration" aria-hidden="true" />
        </article>
      </section>

      {isFormOpen && (
        <form className="responsible-form" onSubmit={handleCreateResponsible}>
          <div className="responsible-form-heading">
            <div>
              <h2>Новый пилот</h2>
              <p>Добавьте участника, чтобы назначать ему задачи.</p>
            </div>
            <button
              type="button"
              className="modal-close"
              onClick={() => setIsFormOpen(false)}
              disabled={mutation.isPending}
              aria-label="Закрыть форму"
            >
              ✕
            </button>
          </div>
          <div className="responsible-form-fields">
            <label className="task-field">
              <span>Имя и фамилия</span>
              <input
                autoFocus
                required
                maxLength={255}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Например, Алексей Иванов"
                className="task-input"
              />
            </label>
            <label className="task-field">
              <span>Тип исполнителя</span>
              <select
                className="task-input"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value === "ai" ? "ai" : "responsible")
                }
              >
                <option value="responsible">Человек</option>
                <option value="ai">ИИ-исполнитель</option>
              </select>
            </label>
            <label className="task-field">
              <span>Email</span>
              <input
                required
                type="email"
                maxLength={255}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="pilot@example.com"
                className="task-input"
              />
            </label>
          </div>
          {formError && <p className="task-create-error" role="alert">{formError}</p>}
          <div className="task-modal-actions">
            <button
              type="button"
              className="modal-cancel"
              onClick={() => setIsFormOpen(false)}
              disabled={mutation.isPending}
            >
              Отмена
            </button>
            <button className="modal-submit" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Добавляем..." : "Добавить в команду"}
            </button>
          </div>
        </form>
      )}

      <section className="leaderboard-section">
        <div className="board-heading">
          <div>
            <h2>Чемпионат пилотов</h2>
            <p>10 очков за первую завершённую задачу</p>
          </div>
          <span className="board-total">{ranked.length} участников</span>
        </div>

        {podium.length > 0 && (
          <div className={`leaderboard-podium podium-count-${podium.length}`}>
            {podium.map((entry) => {
              const place = ranked.findIndex((pilot) => pilot.id === entry.id) + 1;
              return (
                <article className={`podium-card podium-place-${place}`} key={entry.id}>
                  <div className="podium-medal" aria-label={`${place} место`}>
                    {place === 1 ? "♛" : place}
                  </div>
                  <div className="podium-avatar">{entry.fullName.slice(0, 1).toUpperCase()}</div>
                  <h3>{entry.fullName}</h3>
                  <p>{entry.completedTasks} {entry.completedTasks === 1 ? "финиш" : "финишей"}</p>
                  <strong>{entry.points}<small> очков</small></strong>
                  <div className="podium-step"><span>{place}</span></div>
                </article>
              );
            })}
          </div>
        )}

        <div className="leaderboard-table-wrap">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th scope="col">Место</th>
                <th scope="col">Пилот</th>
                <th scope="col">Финиши</th>
                <th scope="col">Очки</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((entry, index) => (
                <tr key={entry.id}>
                  <td><span className={`rank-number${index < 3 ? ` top-rank rank-${index + 1}` : ""}`}>{String(index + 1).padStart(2, "0")}</span></td>
                  <td>
                    <div className="leader-pilot">
                      <span className="leader-avatar">{entry.fullName.slice(0, 1).toUpperCase()}</span>
                      <span><strong>{entry.fullName}</strong><small>{entry.email}</small></span>
                    </div>
                  </td>
                  <td>{entry.completedTasks}</td>
                  <td><strong className="leader-points">{entry.points}<small> pts</small></strong></td>
                </tr>
              ))}
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={4} className="leaderboard-empty">
                    Добавьте первого ответственного, чтобы начать чемпионат.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
