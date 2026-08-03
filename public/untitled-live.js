(() => {
  if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;

  const stream = new EventSource("/__noderyx/live");
  stream.onerror = () => {
    stream.close();
    const waitForRestart = setInterval(async () => {
      try {
        const response = await fetch("/health", { cache: "no-store" });
        if (!response.ok) return;
        clearInterval(waitForRestart);
        location.reload();
      } catch {
        // The watcher is restarting the development server.
      }
    }, 300);
  };
})();
