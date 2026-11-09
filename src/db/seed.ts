import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import * as dotenv from "dotenv";

dotenv.config();

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function main() {
  console.log("Загрузка тестовых задач в Neon DB...");

  // Создаем первого системного пользователя
  const [user] = await db.insert(schema.users).values({
    email: "mike@product.com",
    fullName: "Михайло (Product Lead)",
    role: "admin",
  }).returning();

  // Создаем стартовые задачи по слоям
  const tasks: (typeof schema.tasks.$inferInsert)[] = [
    {
      title: "Проектирование схемы БД в Neon",
      description: "Создать таблицы users, tasks и настроить индексы.",
      status: "done",
      subsystem: "db",
      priority: "p0",
      assigneeId: user.id,
    },
    {
      title: "Подключение Refine Data Provider к Drizzle ORM",
      description: "Настроить корректный обмен JSON между Neon и фронтендом.",
      status: "in_progress",
      subsystem: "admin",
      priority: "p1",
      assigneeId: user.id,
    },
    {
      title: "Разработка JWT Auth middleware на Node.js",
      description: "Реализовать авторизацию для фронтенда и админки.",
      status: "todo",
      subsystem: "backend",
      priority: "p1",
    },
    {
      title: "Интеграция CORS и WebSocket для Realtime",
      description: "Исправить заблокированные запросы при локальном деве.",
      status: "waiting",
      subsystem: "infra",
      priority: "p0",
      issueReason: "CORS-ошибка на localhost:5173 при обращении к бэкенду",
    },
  ];

  await db.insert(schema.tasks).values(tasks);

  console.log("✅ Данные успешно загружены!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Ошибка при выполнении seed:", err);
  process.exit(1);
});