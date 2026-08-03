(() => {
  const tree = document.querySelector("#json-tree");
  const raw = document.querySelector("#json-raw");
  const toast = document.querySelector("#json-toast");
  let data = JSON.parse(document.querySelector("#json-data").textContent);
  let expanded = true;

  const primitive = (value) => {
    const type = value === null ? "null" : typeof value;
    const node = document.createElement("span");
    node.className = `cool-json-${type}`;
    node.textContent = type === "string" ? `"${value}"` : String(value);
    return node;
  };

  function branch(value, key, depth = 0) {
    const row = document.createElement("div");
    row.className = "cool-json-node";
    row.style.setProperty("--json-depth", depth);
    const isObject = value !== null && typeof value === "object";
    if (!isObject) {
      if (key !== null) {
        const keyNode = document.createElement("span");
        keyNode.className = "cool-json-key";
        keyNode.textContent = `${key}: `;
        row.append(keyNode);
      }
      row.append(primitive(value));
      return row;
    }

    const details = document.createElement("details");
    details.open = expanded;
    const summary = document.createElement("summary");
    if (key !== null) {
      const keyNode = document.createElement("span");
      keyNode.className = "cool-json-key";
      keyNode.textContent = key;
      summary.append(keyNode, document.createTextNode(": "));
    }
    const count = Object.keys(value).length;
    const preview = document.createElement("span");
    preview.className = "cool-json-preview";
    preview.textContent = `${Array.isArray(value) ? "Array" : "Object"}(${count})`;
    summary.append(preview);
    const children = document.createElement("div");
    children.className = "cool-json-children";
    for (const [childKey, childValue] of Object.entries(value)) {
      children.append(branch(childValue, childKey, depth + 1));
    }
    details.append(summary, children);
    row.append(details);
    return row;
  }

  function render() {
    const formatted = JSON.stringify(data, null, 2);
    tree.replaceChildren(branch(data, null));
    raw.textContent = formatted;
    document.querySelector("#json-size").textContent = `${new Blob([formatted]).size} bytes`;
  }

  document.querySelector("#json-expand").addEventListener("click", (event) => {
    expanded = !expanded;
    document.querySelectorAll("#json-tree details").forEach((item) => { item.open = expanded; });
    event.currentTarget.textContent = expanded ? "Collapse all" : "Expand all";
  });
  document.querySelector("#json-mode").addEventListener("click", (event) => {
    const showRaw = raw.hidden;
    raw.hidden = !showRaw;
    tree.hidden = showRaw;
    event.currentTarget.textContent = showRaw ? "Tree" : "Raw";
  });
  document.querySelector("#json-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.textContent = "JSON copied to clipboard";
    setTimeout(() => { toast.textContent = ""; }, 1800);
  });
  document.querySelector("#json-refresh").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Refreshing…";
    try {
      const response = await fetch(location.pathname + location.search, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      data = await response.json();
      render();
      toast.textContent = `Refreshed at ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      toast.textContent = `Refresh failed: ${error.message}`;
    } finally {
      button.disabled = false;
      button.textContent = "Refresh";
    }
  });
  render();
})();
