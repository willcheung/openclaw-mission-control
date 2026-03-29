export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { sanitizeConfigFile } = await import("./src/lib/gateway-config");
  await sanitizeConfigFile().catch(() => {});

  // Start filesystem watcher for workspace audit log + SSE events
  const { startWatcher } = await import("./src/lib/fs-watcher");
  await startWatcher().catch((err) =>
    console.error("[instrumentation] fs-watcher failed to start:", err)
  );

  // Start auto-commit scheduler (every 30 min)
  const { startAutoCommit } = await import("./src/lib/git-manager");
  startAutoCommit();
}
