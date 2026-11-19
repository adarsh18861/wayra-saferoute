// `npm run demo`: build the frontend (PWA) and serve it with the backend on ONE fixed port.
//
//   http://localhost:8080        the app (production build, service worker, offline SOS)
//   http://localhost:8080/api    the API + WebSockets (same origin, no proxy)
//
// The backend serves frontend/dist itself (SERVE_FRONTEND=true), so there is a single process to
// start and stop. `npm run demo -- --skip-build` reuses the last build. Ctrl+C stops everything.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEMO_PORT = 8080;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const win = process.platform === "win32";
const python = path.join(backend, ".venv", win ? "Scripts/python.exe" : "bin/python");
const base = `http://localhost:${DEMO_PORT}`;
const skipBuild = process.argv.includes("--skip-build");

const c = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const fail = (msg) => {
  console.error(c("31;1", `\n✗ ${msg}\n`));
  process.exit(1);
};

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function waitForHealth(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (!existsSync(python)) fail("backend/.venv is missing. Run `npm install && npm run setup` first.");
if (!(await portFree(DEMO_PORT))) {
  fail(
    `Port ${DEMO_PORT} is already in use. Is \`npm run demo\` already running in another window? Stop it with Ctrl+C.\n` +
      `  Still busy? Free it in PowerShell:  Stop-Process -Id (Get-NetTCPConnection -LocalPort ${DEMO_PORT} -State Listen).OwningProcess`,
  );
}

if (skipBuild) {
  if (!existsSync(path.join(root, "frontend", "dist", "index.html"))) fail("No frontend build yet: run `npm run demo` without --skip-build.");
  console.log(c("36", "Skipping the build (--skip-build), serving the last frontend/dist."));
} else {
  console.log(c("36;1", "\n[1/2] Building the frontend (production + PWA) ..."));
  const b = spawnSync("npm", ["--prefix", "frontend", "run", "build"], { cwd: root, stdio: "inherit", shell: win });
  if (b.status !== 0) fail("Frontend build failed (see above).");
}

console.log(c("36;1", `\n[2/2] Starting the backend on ${base} (serves the app + API) ...`));
const env = { ...process.env, SERVE_FRONTEND: "true", PUBLIC_BASE_URL: base, PYTHONUTF8: "1" };
const server = spawn(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(DEMO_PORT)], {
  cwd: backend,
  env,
  stdio: "inherit",
});
server.on("exit", (code) => {
  console.log(c("33", `\nBackend stopped (exit ${code ?? "signal"}).`));
  process.exit(code ?? 0);
});
const stop = () => {
  if (server.exitCode === null && !server.killed) server.kill();
};
// Ctrl+C, closing the terminal window (SIGHUP on Windows) or any normal exit takes the backend down too.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, stop);
process.on("exit", stop);

if (!(await waitForHealth(90_000))) {
  stop();
  fail(`The backend didn't answer on ${base}/api/health within 90 s (see the log above).`);
}

const links = spawnSync(python, ["scripts/seed_demo.py", "--print-only", "--base-url", base], { cwd: backend, env, encoding: "utf8" });
const line = "─".repeat(64);
console.log(
  [
    "",
    c("35;1", line),
    c("35;1", "  WAYRA demo is running"),
    c("35;1", line),
    `  Open the app:  ${c("1", `${base}/app`)}`,
    `  Landing page:  ${base}/`,
    `  Model card:    ${base}/model`,
    (links.stdout || "").trimEnd(),
    "",
    "  Left window: the app.  Right window: Mom's watch link.",
    "  Presenter script: DEMO.md.  Stop with Ctrl+C.",
    c("35;1", line),
    "",
  ].join("\n"),
);
