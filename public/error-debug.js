(() => {
  document.querySelector("#debug-back")?.addEventListener("click", () => history.back());
  document.querySelector("#debug-copy")?.addEventListener("click", async (event) => {
    const toast = document.querySelector("#debug-toast");
    try {
      await navigator.clipboard.writeText(event.currentTarget.dataset.copy);
      toast.textContent = "File location copied.";
    } catch {
      toast.textContent = "Copy was blocked. Select the file path above instead.";
    }
  });
  document.querySelector("[data-command]")?.addEventListener("click", async (event) => {
    const toast = document.querySelector("#debug-toast");
    try {
      await navigator.clipboard.writeText(event.currentTarget.dataset.command);
      event.currentTarget.textContent = "Copied";
      toast.textContent = "Run it in the project directory, then refresh.";
    } catch {
      toast.textContent = "Copy was blocked. Select the command above.";
    }
  });
})();
