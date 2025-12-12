document.addEventListener("DOMContentLoaded", () => {
  const userBadge = document.getElementById("user-badge");
  const saveNote = document.getElementById("save-note");
  const favoritesList = document.getElementById("favorites-list");

  const currentPickCard = document.getElementById("current-pick-card");

  const cocktailNameEl = document.getElementById("cocktail-name");
  const cocktailImageEl = document.getElementById("cocktail-image");
  const moodImageEl = document.getElementById("mood-image");
  const cocktailInstructionsEl = document.getElementById("cocktail-instructions");

  const saveBtn = document.getElementById("save-btn");
  const loadBtn = document.getElementById("load-btn");

  const gridEl = document.getElementById("cocktail-grid");
  const searchInput = document.getElementById("search-input");
  const azSelect = document.getElementById("az-select");
  const clearBtn = document.getElementById("clear-btn");

  let currentUser = null;
  let currentDrink = null;

  // -----------------------
  // Session
  // -----------------------
  async function checkSession() {
    const res = await fetch("/api/me");
    if (!res.ok) {
      window.location.href = "/login.html";
      return;
    }
    const data = await res.json();
    currentUser = data.user;

    if (currentUser.role === "guest") {
      userBadge.textContent = "Guest mode";
      saveNote.textContent = "Guest saves locally (not MongoDB).";
    } else {
      userBadge.textContent = `Signed in: ${currentUser.username}`;
      saveNote.textContent = "Saved items go to MongoDB.";
    }
  }

  // -----------------------
  // Clear Current Pick
  // -----------------------
  function clearCurrentPick() {
    currentDrink = null;
    cocktailNameEl.textContent = "No cocktail yet";
    cocktailInstructionsEl.textContent = "";
    cocktailImageEl.src = "";
    moodImageEl.src = "";
  }

  // -----------------------
  // CocktailDB browse/search
  // -----------------------
  async function renderGridFromList(drinks) {
    if (!gridEl) return;

    if (!drinks || drinks.length === 0) {
      gridEl.innerHTML = `<p class="muted">No cocktails found.</p>`;
      return;
    }

    drinks.sort((a, b) => (a.strDrink || "").localeCompare(b.strDrink || ""));

    const limited = drinks.slice(0, 60);

    gridEl.innerHTML = limited.map(d => `
      <div class="cocktail-card" data-id="${d.idDrink}">
        <img src="${d.strDrinkThumb}" alt="${escapeHtml(d.strDrink)}">
        <div class="name">${escapeHtml(d.strDrink)}</div>
        <div class="sub">Tap to view recipe</div>
      </div>
    `).join("");

    gridEl.querySelectorAll(".cocktail-card").forEach((card) => {
      card.addEventListener("click", async () => {
        const id = card.getAttribute("data-id");
        await selectCocktailById(id);
      });
    });
  }

  async function loadByLetter(letter) {
    gridEl.innerHTML = `<p class="muted">Loading ${letter.toUpperCase()}…</p>`;
    const res = await fetch(`https://www.thecocktaildb.com/api/json/v1/1/search.php?f=${encodeURIComponent(letter)}`);
    const data = await res.json();
    await renderGridFromList(data?.drinks || []);
  }

  async function searchByName(name) {
    const q = name.trim();
    if (!q) return;

    gridEl.innerHTML = `<p class="muted">Searching “${escapeHtml(q)}”…</p>`;
    const res = await fetch(`https://www.thecocktaildb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`);
    const data = await res.json();
    await renderGridFromList(data?.drinks || []);
  }

  async function selectCocktailById(id) {
    const res = await fetch(`https://www.thecocktaildb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(id)}`);
    const data = await res.json();
    const drink = data?.drinks?.[0];
    if (!drink) return;

    currentDrink = drink;

    cocktailNameEl.textContent = drink.strDrink || "Unnamed cocktail";
    cocktailImageEl.src = drink.strDrinkThumb || "";
    cocktailInstructionsEl.textContent = buildRecipeText(drink);

    await generateMoodImage();

    currentPickCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function buildRecipeText(drink) {
    const parts = [];
    for (let i = 1; i <= 15; i++) {
      const ing = drink[`strIngredient${i}`];
      const meas = drink[`strMeasure${i}`];
      if (ing && ing.trim()) {
        const line = `${(meas || "").trim()} ${ing.trim()}`.trim();
        parts.push(`• ${line}`);
      }
    }
    const instructions = (drink.strInstructions || "").trim();
    const header = parts.length ? `Ingredients:\n${parts.join("\n")}\n\n` : "";
    return `${header}${instructions}`;
  }

  // -----------------------
  // Unsplash (server proxy)
  // -----------------------
  async function generateMoodImage() {
    if (!currentUser) await checkSession();

    const name = (cocktailNameEl.textContent || "").trim();
    const q =
      name && name !== "No cocktail yet"
        ? `${name} cocktail mood`
        : "cocktail mood aesthetic";

    const res = await fetch(`/api/unsplash?q=${encodeURIComponent(q)}`);
    const out = await res.json();
    moodImageEl.src = out.imageUrl || "";
  }

  // -----------------------
  // Favorites: guest localStorage
  // -----------------------
  const LS_KEY = "sipSnap_guest_favorites";

  function getGuestFavorites() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
    catch { return []; }
  }

  function saveGuestFavorite(entry) {
    const list = getGuestFavorites();
    const withId = { ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    list.unshift(withId);
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    return list;
  }

  function deleteGuestFavorite(id) {
    const list = getGuestFavorites().filter(x => x.id !== id);
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    return list;
  }

  // -----------------------
  // Favorites: shared UI
  // -----------------------
  function getCurrentData() {
    return {
      cocktailName: (cocktailNameEl.textContent || "").trim(),
      cocktailImage: cocktailImageEl.src || "",
      moodImage: moodImageEl.src || "",
      recipeText: (cocktailInstructionsEl.textContent || "").trim(), // ✅ NEW
    };
  }

  function renderFavorites(items, label) {
    if (!items || items.length === 0) {
      favoritesList.innerHTML = `<p class="muted">No favorites yet (${label}).</p>`;
      return;
    }

    favoritesList.innerHTML = items.map(f => `
      <div class="card" style="margin-top:10px;">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <strong>${escapeHtml(f.cocktailName || "")}</strong>
          <button class="btn2 delete-btn" data-id="${f._id || f.id}">Delete</button>
        </div>

        <div class="row" style="margin-top:10px;">
          ${f.cocktailImage ? `<img src="${f.cocktailImage}" alt="cocktail" style="width:220px;">` : ""}
          ${f.moodImage ? `<img src="${f.moodImage}" alt="mood" style="width:220px;">` : ""}
        </div>

        ${f.recipeText ? `
          <pre style="white-space:pre-wrap; margin-top:10px; background:#0b1220; border:1px solid #243047; padding:10px; border-radius:12px;">
${escapeHtml(f.recipeText)}
          </pre>
        ` : ""}
      </div>
    `).join("");

    favoritesList.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;

        if (currentUser?.role === "guest") {
          const updated = deleteGuestFavorite(id);
          renderFavorites(updated, "guest/localStorage");
          return;
        }

        const res = await fetch(`/api/favorites/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) {
          const out = await res.json().catch(() => ({}));
          alert(out.error || "Delete failed");
          return;
        }
        await loadFavorites();
      });
    });
  }

  async function saveFavorite() {
    const data = getCurrentData();
    if (!data.cocktailName || data.cocktailName === "No cocktail yet") return;

    if (!currentUser) await checkSession();

    if (currentUser.role === "guest") {
      const list = saveGuestFavorite(data);
      renderFavorites(list, "guest/localStorage");
      return;
    }

    const res = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      alert(out.error || "Save failed");
      return;
    }

    await loadFavorites();
  }

  async function loadFavorites() {
    if (!currentUser) await checkSession();

    if (currentUser.role === "guest") {
      renderFavorites(getGuestFavorites(), "guest/localStorage");
      return;
    }

    const res = await fetch("/api/favorites");
    const items = await res.json();
    renderFavorites(items, "MongoDB");
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // -----------------------
  // Events
  // -----------------------
  saveBtn?.addEventListener("click", saveFavorite);
  loadBtn?.addEventListener("click", loadFavorites);

  azSelect?.addEventListener("change", async () => {
    const letter = azSelect.value;
    if (!letter) return;
    searchInput.value = "";
    await loadByLetter(letter);
  });

  let searchTimer = null;
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = searchInput.value.trim();
      if (q.length === 0) {
        const letter = azSelect.value || "a";
        await loadByLetter(letter);
        return;
      }
      if (q.length < 2) return;
      azSelect.value = "";
      await searchByName(q);
    }, 350);
  });

  clearBtn?.addEventListener("click", async () => {
    clearCurrentPick();
    searchInput.value = "";
    azSelect.value = "a";
    await loadByLetter("a");
  });

  // -----------------------
  // Start
  // -----------------------
  (async () => {
    await checkSession();
    clearCurrentPick();
    azSelect.value = "a";
    await loadByLetter("a");
    await loadFavorites();
  })();
});
