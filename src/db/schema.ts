import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, text, timestamp, pgEnum, index, boolean, integer, check } from "drizzle-orm/pg-core";

// ENUM-типы под наш UX
export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "test",
  "done",
  "waiting",
]);

export const taskSubsystemEnum = pgEnum("task_subsystem", [
  "db",
  "backend",
  "frontend",
  "admin",
  "infra",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "p0",
  "p1",
  "p2",
  "p3",
]);

// Таблица пользователей
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("manager"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Таблица задач Канбана
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"), // Markdown с ТЗ
    imageUrl: text("image_url"), // URL превью/макета
    isVerified: boolean("is_verified").default(false), // Флаг проверки (например, BOND)
    status: taskStatusEnum("status").notNull().default("todo"),
    subsystem: taskSubsystemEnum("subsystem").notNull().default("admin"),
    priority: taskPriorityEnum("priority").notNull().default("p2"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    aiResult: text("ai_result"),
    aiCode: text("ai_code"),
    aiStatus: varchar("ai_status", { length: 20 }).notNull().default("none"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    issueReason: text("issue_reason"), // Причина блокера при необходимости
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("idx_tasks_status").on(table.status),
    subsystemIdx: index("idx_tasks_subsystem").on(table.subsystem),
    assigneeIdx: index("idx_tasks_assignee").on(table.assigneeId),
  })
);

export const taskCompletionPoints = pgTable("task_completion_points", {
  taskId: uuid("task_id")
    .primaryKey()
    .references(() => tasks.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  points: integer("points").notNull().default(10),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).defaultNow(),
}, (table) => ({
  positivePoints: check("task_completion_points_points_positive", sql`${table.points} > 0`),
}));