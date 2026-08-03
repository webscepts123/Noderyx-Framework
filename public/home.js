(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector("#theme-toggle");
  const savedTheme = localStorage.getItem("noderyx-theme");
  const preferredTheme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    themeButton?.setAttribute("aria-label", `Use ${theme === "dark" ? "light" : "dark"} theme`);
    if (themeButton) themeButton.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  };

  applyTheme(savedTheme || preferredTheme);
  themeButton?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("noderyx-theme", next);
    applyTheme(next);
  });

  const nav = document.querySelector(".cool-nav-wrap");
  const updateNav = () => nav?.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", updateNav, { passive: true });
  updateNav();

  const aiForm = document.querySelector("#ai-form");
  const aiPrompt = document.querySelector("#ai-prompt");
  const aiOutput = document.querySelector("#ai-output");
  const aiStatus = document.querySelector("#ai-status");
  const aiSubmit = document.querySelector("#ai-submit");
  let previousResponseId;

  document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      aiPrompt.value = button.dataset.aiPrompt;
      aiPrompt.focus();
    });
  });

  aiForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = aiPrompt.value.trim();
    if (!prompt) return aiPrompt.focus();
    aiSubmit.disabled = true;
    aiSubmit.textContent = "Thinking...";
    aiStatus.textContent = "Shaping one clear direction...";
    try {
      const response = await fetch("/api/ai/ideas", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": document.querySelector('meta[name="csrf-token"]')?.content ?? ""
        },
        body: JSON.stringify({ prompt, previousResponseId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The idea partner could not respond.");
      previousResponseId = data.responseId;
      aiOutput.textContent = data.answer;
      aiOutput.hidden = false;
      aiStatus.textContent = `Answered by ${data.model}`;
    } catch (error) {
      aiOutput.textContent = error.message;
      aiOutput.hidden = false;
      aiStatus.textContent = "Nothing was sent onward after this error.";
    } finally {
      aiSubmit.disabled = false;
      aiSubmit.textContent = "Shape this idea";
    }
  });
})();
