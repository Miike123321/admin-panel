import "dotenv/config";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.API_PORT ?? 3001);
let api;
let web;
let shuttingDown = false;
let ownsApi = false;
let apiExitCode;

const shutdown = (exitCode) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  process.exitCode = exitCode;
  if (ownsApi) {
    api?.kill("SIGTERM");
  }
  web?.kill("SIGTERM");
};

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

const healthUrl = `http://127.0.0.1:${port}/api/health`;
const isApiReady = async () => {
  try {
    const response = await fetch(healthUrl);
    if (!response.ok) {
      return false;
    }
    const body = await response.json();
    return body.status === "ok";
  } catch {
    return false;
  }
};

let apiReady = await isApiReady();

if (!apiReady) {
  ownsApi = true;
  api = spawn(process.execPath, ["server.mjs"], { stdio: "inherit" });
  api.once("error", (error) => {
    console.error("Could not start the tasks API:", error);
    shutdown(1);
  });
  api.once("exit", (code) => {
    apiExitCode = code ?? 1;
    if (!shuttingDown) {
      console.error(`Tasks API exited unexpectedly (${apiExitCode}).`);
      shutdown(apiExitCode);
    }
  });

  for (let attempt = 0; attempt < 50 && !shuttingDown; attempt += 1) {
    if (apiExitCode !== undefined) {
      break;
    }
    apiReady = await isApiReady();
    if (apiReady) {
      break;
    }
    await delay(200);
  }
}

if (!apiReady) {
  console.error("Tasks API did not become ready.");
  shutdown(1);
} else if (!shuttingDown) {
  web = spawn(
    process.execPath,
    ["node_modules/@refinedev/cli/dist/cli.cjs", "dev"],
    { stdio: "inherit" }
  );
  web.once("error", (error) => {
    console.error("Could not start the admin panel:", error);
    shutdown(1);
  });
  web.once("exit", (code) => shutdown(code ?? 1));
}
