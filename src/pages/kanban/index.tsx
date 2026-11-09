import React, { useState } from "react";
import {
  type BaseKey,
  type BaseRecord,
  useCreate,
  useDelete,
  useList,
  useUpdate,
} from "@refinedev/core";

const COLUMNS = [
  { id: "todo", title: "ToDo" },
  { id: "in_progress", title: "В процессе" },
  { id: "test", title: "Тест (ожидание обратной связи)" },
  { id: "done", title: "Готово" },
  { id: "waiting", title: "Waiting" },
];
const AI_BACKLOG_COLUMN = { id: "ai_backlog", title: "Беклог ИИ" };

const SUBSYSTEMS = [
  { id: "db", title: "База данных" },
  { id: "backend", title: "Backend" },
  { id: "frontend", title: "Frontend" },
  { id: "admin", title: "Админка" },
  { id: "infra", title: "Инфраструктура" },
];

const PRIORITIES = [
  { id: "p0", title: "P0 — критичный" },
  { id: "p1", title: "P1 — высокий" },
  { id: "p2", title: "P2 — обычный" },
  { id: "p3", title: "P3 — низкий" },
];

const SUBSYSTEM_BADGES: Record<string, string> = {
  db: "subsystem-db",
  backend: "subsystem-backend",
  frontend: "subsystem-frontend",
  admin: "subsystem-admin",
  infra: "subsystem-infra",
};

interface Task extends BaseRecord {
  id: BaseKey;
  title: string;
  status: string;
  description?: string | null;
  subsystem?: string;
  priority?: string;
  isVerified?: boolean;
  imageUrl?: string | null;
  checklist?: string | number | null;
  assigneeId?: string | null;
  isAiTask?: boolean;
  aiResult?: string | null;
  aiCode?: string | null;
  aiStatus?: string;
}

interface Responsible extends BaseRecord {
  id: string;
  fullName: string;
  email: string;
  role?: string;
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Неизвестная ошибка";

interface BasketballThrow {
  taskId?: BaseKey;
  left: number;
  top: number;
  dx: number;
  dy: number;
  action: "delete" | "drift" | "create";
  status?: string;
  values?: TaskFormValues;
}

interface TaskFormValues {
  title: string;
  description: string | null;
  imageUrl: string | null;
  status: string;
  subsystem: string;
  priority: string;
  assigneeId: string | null;
}

interface DraggedTask {
  taskId: BaseKey;
  left: number;
  top: number;
}

export const KanbanPage: React.FC = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [reviewingTask, setReviewingTask] = useState<Task | null>(null);
  const [showAiCode, setShowAiCode] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newStatus, setNewStatus] = useState("todo");
  const [newSubsystem, setNewSubsystem] = useState("admin");
  const [newPriority, setNewPriority] = useState("p2");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [createError, setCreateError] = useState("");
  const [basketballThrow, setBasketballThrow] =
    useState<BasketballThrow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [draggedTask, setDraggedTask] = useState<DraggedTask | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const {
    result: { data: tasks },
    query: { isLoading, isError, error },
  } = useList<Task>({
    resource: "tasks",
    pagination: { mode: "off" },
  });
  const {
    result: { data: responsibles },
  } = useList<Responsible>({
    resource: "responsibles",
    pagination: { mode: "off" },
  });
  const { mutate: updateTask, mutation: updateMutation } = useUpdate();
  const { mutate: createTask, mutation: createMutation } = useCreate<Task>();
  const { mutate: deleteTask, mutation: deleteMutation } = useDelete<Task>();

  const handleStatusChange = (taskId: BaseKey, status: string) => {
    updateTask({
      resource: "tasks",
      id: taskId,
      values: { status },
    });
  };

  const handleEditOpen = (task: Task) => {
    setEditingTask(task);
    setNewTitle(task.title);
    setNewDescription(task.description ?? "");
    setNewImageUrl(task.imageUrl ?? "");
    setNewStatus(task.status);
    setNewSubsystem(task.subsystem ?? "admin");
    setNewPriority(task.priority ?? "p2");
    setNewAssigneeId(task.assigneeId ?? "");
    setCreateError("");
    setIsCreateOpen(true);
  };

  const closeTaskForm = () => {
    setIsCreateOpen(false);
    setEditingTask(null);
  };

  const handleDeleteStart = (
    event: React.MouseEvent<HTMLButtonElement>,
    taskId: BaseKey
  ) => {
    if (basketballThrow || deleteMutation.isPending) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const left = bounds.left + bounds.width / 2 - 22;
    const top = bounds.top + bounds.height / 2 - 22;
    const targetX = window.innerWidth / 2;
    const targetY = window.innerHeight * (window.innerWidth <= 700 ? 0.34 : 0.38);

    setDeleteError("");
    setBasketballThrow({
      taskId,
      left,
      top,
      dx: targetX - left - 22,
      dy: targetY - top - 22,
      action: "delete",
    });
  };

  const handleTaskDragStart = (
    event: React.DragEvent<HTMLElement>,
    task: Task
  ) => {
    if (basketballThrow || deleteMutation.isPending || updateMutation.isPending) {
      event.preventDefault();
      return;
    }

    if ((event.target as HTMLElement).closest("button, select, input, textarea")) {
      event.preventDefault();
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(task.id));
    setDraggedTask({
      taskId: task.id,
      left: bounds.left + bounds.width / 2 - 22,
      top: bounds.top + bounds.height / 2 - 22,
    });
  };

  const handleColumnDrop = (
    event: React.DragEvent<HTMLElement>,
    status: string
  ) => {
    event.preventDefault();
    setDragOverColumn(null);

    if (!draggedTask || basketballThrow) return;

    const targetStatus = status === AI_BACKLOG_COLUMN.id ? "todo" : status;
    const task = tasks.find((item) => item.id === draggedTask.taskId);
    setDraggedTask(null);
    if (!task || task.status === targetStatus) return;

    const targetBounds = event.currentTarget.getBoundingClientRect();
    const targetX = targetBounds.left + targetBounds.width / 2;
    const targetY = targetBounds.top + Math.min(targetBounds.height / 2, 150);
    setDeleteError("");
    setBasketballThrow({
      ...draggedTask,
      dx: targetX - draggedTask.left - 22,
      dy: targetY - draggedTask.top - 22,
      action: "drift",
      status: targetStatus,
    });
  };

  const createTaskAfterGoal = (values: TaskFormValues) => {
    createTask(
      { resource: "tasks", values },
      {
        onSuccess: () => {
          setBasketballThrow(null);
          closeTaskForm();
          setNewTitle("");
          setNewDescription("");
          setNewImageUrl("");
          setNewStatus("todo");
          setNewSubsystem("admin");
          setNewPriority("p2");
          setNewAssigneeId("");
        },
        onError: (createError) => {
          setBasketballThrow(null);
          setIsCreateOpen(true);
          setCreateError(
            `Не удалось создать задачу: ${getErrorMessage(createError)}`
          );
        },
      }
    );
  };

  const handleBasketballLanded = () => {
    if (!basketballThrow) return;

    if (
      basketballThrow.action === "drift" &&
      basketballThrow.taskId &&
      basketballThrow.status
    ) {
      updateTask(
        {
          resource: "tasks",
          id: basketballThrow.taskId,
          values: { status: basketballThrow.status },
        },
        {
          onSuccess: () => setBasketballThrow(null),
          onError: (updateError) => {
            setDeleteError(
              `Не удалось изменить статус задачи: ${getErrorMessage(updateError)}`
            );
            setBasketballThrow(null);
          },
        }
      );
      return;
    }

    if (
      basketballThrow.action === "create" &&
      basketballThrow.values
    ) {
      createTaskAfterGoal(basketballThrow.values);
      return;
    }

    if (basketballThrow.action === "delete" && basketballThrow.taskId) {
      deleteTask(
        { resource: "tasks", id: basketballThrow.taskId },
        {
          onSuccess: () => setBasketballThrow(null),
          onError: (deleteError) => {
            setDeleteError(
              `Не удалось удалить задачу: ${getErrorMessage(deleteError)}`
            );
            setBasketballThrow(null);
          },
        }
      );
    }
  };

  const handleTaskSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError("");

    const values: TaskFormValues = {
      title: newTitle.trim(),
      description: newDescription.trim() || null,
      imageUrl: newImageUrl.trim() || null,
      status: newStatus,
      subsystem: newSubsystem,
      priority: newPriority,
      assigneeId: newAssigneeId || null,
    };

    if (editingTask) {
      updateTask(
        { resource: "tasks", id: editingTask.id, values },
        {
          onSuccess: closeTaskForm,
          onError: (updateError) => {
            setCreateError(
              `Не удалось изменить задачу: ${getErrorMessage(updateError)}`
            );
          },
        }
      );
      return;
    }

    const targetY = window.innerHeight * 0.3;
    setCreateError("");
    setIsCreateOpen(false);
    setBasketballThrow({
      left: window.innerWidth / 2 - 22,
      top: window.innerHeight - 80,
      dx: 0,
      dy: targetY - (window.innerHeight - 80) - 22,
      action: "create",
      values,
    });
  };

  const openAiReview = (task: Task) => {
    setReviewingTask(task);
    setShowAiCode(false);
  };

  if (isLoading) {
    return (
      <div className="kanban-state" role="status">
        Загрузка Канбан-доски...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="kanban-state kanban-state-error" role="alert">
        Не удалось загрузить задачи: {getErrorMessage(error)}
      </div>
    );
  }

  return (
    <div className="kanban-page">
      <header className="kanban-header">
        <div className="page-heading">
          <div className="page-eyebrow"><span /> ПАНЕЛЬ УПРАВЛЕНИЯ</div>
          <h1>Канбан-доска</h1>
          <p>Планируйте работу и следите за прогрессом команды.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingTask(null);
            setNewTitle("");
            setNewDescription("");
            setNewImageUrl("");
            setNewStatus("todo");
            setNewSubsystem("admin");
            setNewPriority("p2");
            setNewAssigneeId("");
            setCreateError("");
            setIsCreateOpen(true);
          }}
          className="create-task-button"
        >
          <span aria-hidden="true">＋</span> Новая задача
        </button>
      </header>

      <section className="overview-grid" aria-label="Обзор задач">
        {[
          { label: "Всего задач", value: tasks.length, tone: "violet", icon: "▦" },
          {
            label: "В работе",
            value: tasks.filter((task) => task.status === "in_progress").length,
            tone: "blue",
            icon: "◷",
          },
          {
            label: "Ожидают",
            value: tasks.filter((task) => task.status === "waiting" || task.status === "test").length,
            tone: "orange",
            icon: "◌",
          },
          {
            label: "Завершено",
            value: tasks.filter((task) => task.status === "done").length,
            tone: "green",
            icon: "✓",
          },
        ].map((stat) => (
          <article className="overview-card" key={stat.label}>
            <div className={`overview-icon ${stat.tone}`} aria-hidden="true">{stat.icon}</div>
            <div>
              <p>{stat.label}</p>
              <strong>{stat.value}</strong>
            </div>
            <span className="overview-decoration" aria-hidden="true" />
          </article>
        ))}
      </section>

      <div className="board-heading">
        <div>
          <h2>Рабочий поток</h2>
          <p>Перетаскивайте карточки между этапами</p>
        </div>
        {deleteError && (
          <p className="task-delete-error" role="alert">
            {deleteError}
          </p>
        )}
        <span className="board-total">{tasks.length} задач</span>
      </div>

      {isCreateOpen && (
        <div
          className="task-modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !createMutation.isPending &&
              !updateMutation.isPending
            ) {
              setIsCreateOpen(false);
            }
          }}
        >
          <form
            onSubmit={handleTaskSubmit}
            className="task-modal"
            aria-labelledby="create-task-title"
          >
            <div className="flex items-center justify-between">
              <h2 id="create-task-title">
                {editingTask ? "Изменить задачу" : "Новая задача"}
              </h2>
              <button
                type="button"
                onClick={closeTaskForm}
                disabled={createMutation.isPending || updateMutation.isPending}
                aria-label="Закрыть форму"
                className="modal-close"
              >
                ✕
              </button>
            </div>

            <label className="task-field">
              <span>Название *</span>
              <input
                autoFocus
                required
                maxLength={255}
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="например: Разработка интерфейса эквайринга"
                className="task-input"
              />
            </label>

            <label className="task-field">
              <span>Описание (ТЗ)</span>
              <textarea
                rows={3}
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="Подробности ТЗ или спецификация..."
                className="task-input"
              />
            </label>

            <label className="task-field">
              <span>Ссылка на картинку / мокап (URL)</span>
              <input
                type="url"
                value={newImageUrl}
                onChange={(event) => setNewImageUrl(event.target.value)}
                placeholder="https://..."
                className="task-input"
              />
            </label>

            <div className="task-fields-row">
              <label className="task-field">
                <span>Статус</span>
                <select
                  value={newStatus}
                  onChange={(event) => setNewStatus(event.target.value)}
                  className="task-input"
                >
                  {COLUMNS.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field">
                <span>Подсистема</span>
                <select
                  value={newSubsystem}
                  onChange={(event) => setNewSubsystem(event.target.value)}
                  className="task-input"
                >
                  {SUBSYSTEMS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field">
                <span>Ответственный</span>
                <select
                  value={newAssigneeId}
                  onChange={(event) => setNewAssigneeId(event.target.value)}
                  className="task-input"
                >
                  <option value="">Не назначен</option>
                  {responsibles.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field">
                <span>Приоритет</span>
                <select
                  value={newPriority}
                  onChange={(event) => setNewPriority(event.target.value)}
                  className="task-input"
                >
                  {PRIORITIES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {createError && (
              <p className="task-create-error" role="alert">
                {createError}
              </p>
            )}

            <div className="task-modal-actions">
              <button
                type="button"
                onClick={closeTaskForm}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="modal-cancel"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="modal-submit"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Сохраняем..."
                  : editingTask
                    ? "Сохранить"
                    : "Создать"}
              </button>
            </div>
          </form>
        </div>
      )}

      {reviewingTask && (
        <div
          className="task-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReviewingTask(null);
          }}
        >
          <section className="task-modal ai-review-modal" aria-labelledby="ai-review-title">
            <div className="ai-review-heading">
              <div>
                <span className="ai-review-kicker">AI · РЕЗУЛЬТАТ НЕ ОПУБЛИКОВАН</span>
                <h2 id="ai-review-title">{reviewingTask.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setReviewingTask(null)}
                aria-label="Закрыть результат"
                className="modal-close"
              >
                ✕
              </button>
            </div>
            <div className="ai-review-result">
              <h3>Результат работы</h3>
              {reviewingTask.aiResult ? (
                <p>{reviewingTask.aiResult}</p>
              ) : (
                <p className="ai-review-empty">
                  Результат появится здесь после настройки AI-исполнителя и подключения
                  Superset MCP. Сейчас задача находится в беклоге; внешний запуск ещё
                  не включён.
                </p>
              )}
            </div>
            <div className="ai-review-actions">
              <button
                type="button"
                className="integration-test-button"
                disabled={!reviewingTask.aiCode}
                onClick={() => setShowAiCode((visible) => !visible)}
              >
                {showAiCode ? "Скрыть код" : "Просмотреть код"}
              </button>
              <button
                type="button"
                className="modal-submit ai-publish-button"
                disabled
                title="Настройте репозиторий GitHub и подключите исполнение AI-задач."
              >
                Создать PR в GitHub
              </button>
            </div>
            {showAiCode && (
              <pre className="ai-review-code">
                {reviewingTask.aiCode || "Код для этой задачи ещё не подготовлен."}
              </pre>
            )}
          </section>
        </div>
      )}

      <div className="kanban-board">
        {[AI_BACKLOG_COLUMN, ...COLUMNS].map((column) => {
          const columnTasks =
            column.id === AI_BACKLOG_COLUMN.id
              ? tasks.filter((task) => task.status === "todo" && task.isAiTask)
              : tasks.filter(
                  (task) =>
                    task.status === column.id &&
                    (column.id !== "todo" || !task.isAiTask)
                );

          return (
            <section
              key={column.id}
              aria-label={column.title}
              className={`kanban-column${dragOverColumn === column.id ? " drag-over" : ""}`}
              onDragOver={(event) => {
                if (!draggedTask) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverColumn(column.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setDragOverColumn(null);
                }
              }}
              onDrop={(event) => handleColumnDrop(event, column.id)}
            >
              <div className="column-heading">
                <h3>
                  {column.title}
                </h3>
                <span className="column-count">
                  {columnTasks.length}
                </span>
              </div>

              <div className="column-cards">
                {columnTasks.map((task) => (
                  <article
                    key={task.id}
                    className={`task-card${draggedTask?.taskId === task.id ? " is-dragging" : ""}${task.isAiTask && task.status === "test" ? " is-ai-review-card" : ""}${task.isAiTask ? " is-ai-task" : ""}`}
                    draggable
                    onDragStart={(event) => handleTaskDragStart(event, task)}
                    onDragEnd={() => {
                      setDraggedTask(null);
                      setDragOverColumn(null);
                    }}
                  >
                    {task.isVerified && (
                      <div className="verified-row">
                        <span className="verified-badge">
                          ✓ BOND
                        </span>
                      </div>
                    )}

                    <div className="task-card-title-row">
                      <h4>
                        {task.title}
                      </h4>
                      {task.priority && (
                        <span className={`priority-badge ${task.priority.toLowerCase()}`}>
                          {task.priority}
                        </span>
                      )}
                    </div>

                    {task.isAiTask && (
                      <span className="ai-task-badge">
                        {task.status === "test" ? "ИИ · ОЖИДАЕТ РЕВЬЮ" : "ИИ · ЗАДАЧА"}
                      </span>
                    )}

                    {task.subsystem && (
                      <span
                        className={`subsystem-badge ${
                          SUBSYSTEM_BADGES[task.subsystem] ??
                          "bg-gray-500/20 text-gray-300"
                        }`}
                      >
                        {task.subsystem}
                      </span>
                    )}

                    {task.imageUrl && (
                      <div className="task-image">
                        <img
                          src={task.imageUrl}
                          alt={`Превью: ${task.title}`}
                          className="task-image-content"
                        />
                      </div>
                    )}

                    {task.description && (
                      <p className="task-description">
                        {task.description}
                      </p>
                    )}
                    {task.isAiTask && task.aiResult && (
                      <p className="ai-result-preview">{task.aiResult}</p>
                    )}

                    <div className="task-card-footer">
                      <div className="task-meta">
                        {task.assigneeId && (
                          <span className="task-assignee-badge" title="Ответственный">
                            {responsibles.find((person) => person.id === task.assigneeId)?.fullName ?? "Исполнитель"}
                          </span>
                        )}
                        {task.description && <span title="Есть описание">≡</span>}
                        {task.checklist && <span>☑ {task.checklist}</span>}
                      </div>
                      <div className="task-card-actions">
                        {task.isAiTask && (
                          <button
                            type="button"
                            className="ai-review-button"
                            aria-label={`Открыть результат AI-задачи «${task.title}»`}
                            onClick={() => openAiReview(task)}
                          >
                            Результат
                          </button>
                        )}
                        <button
                          type="button"
                          className="task-edit-button"
                          aria-label={`Изменить задачу «${task.title}»`}
                          title="Изменить задачу"
                          onClick={() => handleEditOpen(task)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m14 5 5 5M4 20l4.4-.9L19 8.5 15.5 5 4.9 15.6 4 20Z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="task-delete-button"
                          aria-label={`Удалить задачу «${task.title}»`}
                          title="Удалить задачу"
                          disabled={Boolean(basketballThrow) || deleteMutation.isPending}
                          onClick={(event) => handleDeleteStart(event, task.id)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="task-status-control">
                      <label className="sr-only" htmlFor={`status-${task.id}`}>
                        Изменить статус задачи «{task.title}»
                      </label>
                      <select
                        id={`status-${task.id}`}
                        value={task.status}
                        onChange={(event) =>
                          handleStatusChange(task.id, event.target.value)
                        }
                        className="status-select"
                      >
                        {COLUMNS.map((statusColumn) => (
                          <option key={statusColumn.id} value={statusColumn.id}>
                            → {statusColumn.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {basketballThrow && (
        basketballThrow.action === "drift" ? (
          <div className="finish-overlay drift-overlay" aria-live="polite">
            <div className="finish-lane" aria-hidden="true">
              <span>DRIFT · {COLUMNS.find((column) => column.id === basketballThrow.status)?.title}</span>
            </div>
            <div
              className="formula-car"
              data-reverse={basketballThrow.dx < 0}
              role="status"
              aria-label="Карточка перемещается в другую колонку"
              onAnimationEnd={handleBasketballLanded}
              style={
                {
                  left: basketballThrow.left - 53,
                  top: basketballThrow.top - 7,
                  "--drive-x": `${basketballThrow.dx}px`,
                  "--drive-y": `${basketballThrow.dy}px`,
                  "--drive-angle": `${Math.atan2(basketballThrow.dy, basketballThrow.dx)}rad`,
                } as React.CSSProperties
              }
            >
              <span className="car-spoiler" />
              <span className="car-body">
                <span className="car-cockpit" />
                <span className="car-number">1</span>
              </span>
              <span className="car-wheel front" />
              <span className="car-wheel rear" />
              <span className="car-trail" />
            </div>
            <p className="finish-caption">ДРИФТ · СМЕНА СТАТУСА</p>
          </div>
        ) : basketballThrow.action === "create" ? (
          <div className="goal-overlay" aria-live="polite">
            <div className="football-goal" aria-hidden="true">
              <span className="goal-crossbar" />
              <span className="goal-post goal-post-left" />
              <span className="goal-post goal-post-right" />
              <span className="goal-net" />
            </div>
            <span
              className="soccer-ball"
              role="status"
              aria-label="Гол — задача создается"
              onAnimationEnd={handleBasketballLanded}
              style={
                {
                  left: basketballThrow.left,
                  top: basketballThrow.top,
                  "--goal-x": `${basketballThrow.dx}px`,
                  "--goal-y": `${basketballThrow.dy}px`,
                } as React.CSSProperties
              }
            >
              <span />
            </span>
            <p className="goal-caption">ГОЛ! СОЗДАЁМ ЗАДАЧУ</p>
          </div>
        ) : (
          <div className="basketball-overlay" aria-live="polite">
            <div className="basketball-hoop" aria-hidden="true">
              <span className="hoop-backboard" />
              <span className="hoop-rim" />
              <span className="hoop-net" />
            </div>
            <span
              className="basketball"
              role="status"
              aria-label="Бросок задачи в корзину"
              onAnimationEnd={handleBasketballLanded}
              style={
                {
                  left: basketballThrow.left,
                  top: basketballThrow.top,
                  "--throw-x": `${basketballThrow.dx}px`,
                  "--throw-y": `${basketballThrow.dy}px`,
                } as React.CSSProperties
              }
            >
              <span />
            </span>
            <p className="basketball-caption">Задача отправляется в корзину</p>
          </div>
        )
      )}
    </div>
  );
};
