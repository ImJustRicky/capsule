(function () {
  "use strict";
  const STORAGE_KEY = "items";
  let items = []; // { id, text, done }

  const list = document.getElementById("list");
  const count = document.getElementById("count");
  const input = document.getElementById("new-item");

  async function load() {
    try {
      const v = await window.capsule.request("storage.local", "get", { key: STORAGE_KEY });
      if (Array.isArray(v)) items = v;
    } catch (err) {
      console.warn("storage.local unavailable:", err.code);
    }
    render();
  }

  async function save() {
    try {
      await window.capsule.request("storage.local", "set", { key: STORAGE_KEY, value: items });
    } catch (err) {
      console.warn("save failed:", err.code);
    }
  }

  function render() {
    list.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      if (item.done) li.classList.add("done");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = item.done;
      cb.addEventListener("change", () => { item.done = cb.checked; li.classList.toggle("done", item.done); save(); updateCount(); });
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = item.text;
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "Delete";
      del.addEventListener("click", () => { items = items.filter((x) => x.id !== item.id); render(); save(); });
      li.append(cb, text, del);
      list.append(li);
    }
    updateCount();
  }

  function updateCount() {
    const done = items.filter((x) => x.done).length;
    count.textContent = `${done} / ${items.length}`;
  }

  document.getElementById("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    items.push({ id: Date.now() + Math.random(), text, done: false });
    input.value = "";
    save();
    render();
  });

  document.getElementById("clear").addEventListener("click", () => {
    if (!items.length) return;
    if (!confirm("Clear all items?")) return;
    items = [];
    save();
    render();
  });

  load();
})();
