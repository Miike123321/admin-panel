import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const databaseUrl = import.meta.env.VITE_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("VITE_DATABASE_URL must be set to connect to the database.");
}

const sql = neon(databaseUrl);
export const db = drizzle(sql, { schema });
