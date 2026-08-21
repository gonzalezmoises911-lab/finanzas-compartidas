import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAVHZ1AQGUQEFXG_by7PduaJWeG8XDON9A",
  authDomain: "finanzas-compartidas-8ed46.firebaseapp.com",
  projectId: "finanzas-compartidas-8ed46",
  storageBucket: "finanzas-compartidas-8ed46.firebasestorage.app",
  messagingSenderId: "119948792988",
  appId: "1:119948792988:web:5184acc7d42ea9c5009059"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const movementsRef = collection(db, "movimientos");
const page = document.body.dataset.page || "home";

const typeLabels = {
  income: "Ingreso",
  expense: "Gasto débito",
  card_purchase: "Gasto crédito",
  card_payment: "Pago de tarjeta"
};

const categories = [
  "Comida rápida",
  "Supermercado",
  "Carnicería",
  "Farmacia",
  "Veterinaria",
  "Servicios públicos",
  "Mantenimiento vehículo",
  "Bancos",
  "Servicios de casa",
  "Compras en línea",
  "Aseo",
  "Ocio y entretenimiento"
];

const categoryIcons = {
  "Comida rápida": "🍔",
  "Supermercado": "🛒",
  "Carnicería": "🥩",
  "Farmacia": "💊",
  "Veterinaria": "🐾",
  "Servicios públicos": "💡",
  "Mantenimiento vehículo": "🔧",
  "Bancos": "🏦",
  "Servicios de casa": "🏠",
  "Compras en línea": "📦",
  "Aseo": "🧹",
  "Ocio y entretenimiento": "🎬",
  "Sin categoría": "📌"
};

let movements = [];
let selectedType = "income";
let editingMovementId = null;
let pendingDeleteId = null;

const connectionStatus = document.querySelector("#connectionStatus");

function todayAsLocalISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0
  }).format(value);
}

function parseAmount(rawValue) {
  const digits = String(rawValue).replace(/[^0-9]/g, "");
  return digits ? Number(digits) : 0;
}

function calculateBalances(items) {
  let current = 0;
  let card = 0;

  for (const movement of items) {
    const amount = Number(movement.amount) || 0;

    if (movement.type === "income") {
      current += amount;
    } else if (movement.type === "expense") {
      current -= amount;
    } else if (movement.type === "card_purchase") {
      current -= amount;
      card += amount;
    } else if (movement.type === "card_payment") {
      // IMPORTANTE: pagar la tarjeta NO cambia el saldo real.
      card -= amount;
    }
  }

  return {
    current,
    card: Math.max(0, card)
  };
}

function movementTimestamp(movement) {
  const createdMillis = movement.createdAt?.toMillis?.() ?? 0;
  return `${movement.date ?? ""}-${String(createdMillis).padStart(15, "0")}`;
}

function sortedMovements(items) {
  return [...items].sort((a, b) => movementTimestamp(b).localeCompare(movementTimestamp(a)));
}

function formatDate(dateString) {
  if (!dateString) return "Sin fecha";
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

function monthKey(dateString) {
  return dateString ? dateString.slice(0, 7) : "sin-fecha";
}

function currentMonthKey() {
  return todayAsLocalISO().slice(0, 7);
}

function monthLabel(key) {
  if (!key || key === "sin-fecha") return "Sin fecha";
  const [year, month] = key.split("-").map(Number);
  const text = new Intl.DateTimeFormat("es-CR", {
    month: "long",
    year: "numeric"
  }).format(new Date(year, month - 1, 1));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function inferCategory(description) {
  const text = normalizeText(description);
  if (/(mcdonald|burger|pizza|restaurante|restauran|soda |cafeter|cafe |comida rapida|starbucks)/.test(text)) return "Comida rápida";
  if (/(supermerc|walmart|pali|maxi pali|mas x menos|automercado|pricesmart|diario)/.test(text)) return "Supermercado";
  if (/(carnicer|carne|pollo|marisco|pescader)/.test(text)) return "Carnicería";
  if (/(farmacia|fischel|bomba)/.test(text)) return "Farmacia";
  if (/(veterin|mascota|pet )/.test(text)) return "Veterinaria";
  if (/(electricidad|recibo luz|luz |acueduct|agua |aya|ice electricidad)/.test(text)) return "Servicios públicos";
  if (/(mecanic|vehicul|carro|aceite|llanta|repuesto|taller|mantenimiento auto)/.test(text)) return "Mantenimiento vehículo";
  if (/(banco|prestamo|credito|bac|bcr|coopenae|conape|cuota|financ)/.test(text)) return "Bancos";
  if (/(internet|cable|kolbi|liberty|telecable|limpieza casa|servicio casa)/.test(text)) return "Servicios de casa";
  if (/(amazon|temu|shein|aliexpress|compra en linea|compra online)/.test(text)) return "Compras en línea";
  if (/(aseo|limpieza|detergente|jabon|cloro)/.test(text)) return "Aseo";
  if (/(cine|cinema|pelicula|paseo|parque de diversiones|entrada|entretenimiento)/.test(text)) return "Ocio y entretenimiento";
  return "Sin categoría";
}

function isSpendingMovement(movement) {
  return movement.type === "expense" || movement.type === "card_purchase";
}

function movementCategory(movement) {
  if (!isSpendingMovement(movement)) return "";
  return movement.category || inferCategory(movement.description);
}

function needsCategory(type) {
  return type === "expense" || type === "card_purchase";
}

function movementVisual(type) {
  switch (type) {
    case "income": return { symbol: "↓", className: "", amountClass: "positive", sign: "+" };
    case "expense": return { symbol: "↑", className: "negative", amountClass: "negative", sign: "−" };
    case "card_purchase": return { symbol: "▣", className: "card", amountClass: "negative", sign: "−" };
    case "card_payment": return { symbol: "✓", className: "card negative", amountClass: "negative", sign: "−" };
    default: return { symbol: "•", className: "", amountClass: "", sign: "" };
  }
}

function renderMovementList(target, items, { allowActions = true } = {}) {
  if (!target) return;
  if (!items.length) {
    target.innerHTML = '<p class="empty-state">No hay movimientos.</p>';
    return;
  }

  target.innerHTML = "";

  for (const movement of sortedMovements(items)) {
    const visual = movementVisual(movement.type);
    const item = document.createElement("article");
    item.className = `history-item ${visual.className}`.trim();

    const icon = document.createElement("div");
    icon.className = "history-icon";
    icon.textContent = isSpendingMovement(movement)
      ? (categoryIcons[movementCategory(movement)] || visual.symbol)
      : visual.symbol;

    const info = document.createElement("div");
    const description = document.createElement("p");
    description.className = "history-description";
    description.textContent = movement.description || "Sin descripción";

    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${typeLabels[movement.type] || "Movimiento"} · ${formatDate(movement.date)}`;
    info.append(description, meta);

    if (isSpendingMovement(movement)) {
      const cat = document.createElement("span");
      cat.className = "detail-category";
      cat.textContent = movementCategory(movement);
      info.append(cat);
    }

    const amountBox = document.createElement("div");
    const amount = document.createElement("div");
    amount.className = `history-amount ${visual.amountClass}`.trim();
    amount.textContent = `${visual.sign}${formatCurrency(Number(movement.amount) || 0)}`;
    amountBox.append(amount);

    if (allowActions) {
      const actions = document.createElement("div");
      actions.className = "history-actions";

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "edit-button";
      editButton.dataset.id = movement.id;
      editButton.textContent = "Editar";

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.dataset.id = movement.id;
      deleteButton.textContent = "Eliminar";

      actions.append(editButton, deleteButton);
      amountBox.append(actions);
    }

    item.append(icon, info, amountBox);
    target.append(item);
  }
}

function renderHome() {
  const currentBalanceEl = document.querySelector("#currentBalance");
  const cardBalanceEl = document.querySelector("#cardBalance");
  const categorySummary = document.querySelector("#categorySummary");
  const categoryPeriod = document.querySelector("#categoryPeriod");

  const totals = calculateBalances(movements);
  currentBalanceEl.textContent = formatCurrency(totals.current);
  cardBalanceEl.textContent = formatCurrency(totals.card);

  const key = currentMonthKey();
  categoryPeriod.textContent = monthLabel(key);

  const monthSpending = movements.filter(
    movement => isSpendingMovement(movement) && monthKey(movement.date) === key
  );

  const groups = new Map();
  for (const movement of monthSpending) {
    const category = movementCategory(movement);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(movement);
  }

  const ordered = [
    ...categories.filter(category => groups.has(category)),
    ...(groups.has("Sin categoría") ? ["Sin categoría"] : [])
  ];

  if (!ordered.length) {
    categorySummary.innerHTML = '<p class="empty-state">Todavía no hay gastos este mes.</p>';
    return;
  }

  categorySummary.innerHTML = "";
  for (const category of ordered) {
    const items = groups.get(category);
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const link = document.createElement("a");
    link.className = "category-row";
    link.href = `./category.html?category=${encodeURIComponent(category)}`;
    link.innerHTML = `
      <span class="category-icon">${categoryIcons[category] || "📌"}</span>
      <span class="category-main">
        <strong>${escapeHTML(category)}</strong>
        <small>${items.length} ${items.length === 1 ? "movimiento" : "movimientos"}</small>
      </span>
      <span class="category-total">−${formatCurrency(total)}</span>
      <span class="row-chevron">›</span>
    `;
    categorySummary.append(link);
  }
}

function renderHistoryPage() {
  renderMovementList(document.querySelector("#historyList"), movements);
}

function renderCategoryPage() {
  const params = new URLSearchParams(window.location.search);
  const selectedCategory = params.get("category") || "Sin categoría";
  const items = movements.filter(
    movement => isSpendingMovement(movement) && movementCategory(movement) === selectedCategory
  );
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  document.querySelector("#categoryTitle").textContent = `${categoryIcons[selectedCategory] || "📌"} ${selectedCategory}`;
  document.querySelector("#categoryTotal").textContent = `${items.length} ${items.length === 1 ? "movimiento" : "movimientos"} · ${formatCurrency(total)}`;
  renderMovementList(document.querySelector("#categoryList"), items);
}

function renderPage() {
  if (page === "home") renderHome();
  if (page === "history") renderHistoryPage();
  if (page === "category") renderCategoryPage();
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setupHomeForm() {
  if (page !== "home") return;

  const movementForm = document.querySelector("#movementForm");
  const amountInput = document.querySelector("#amount");
  const descriptionInput = document.querySelector("#description");
  const categoryInput = document.querySelector("#category");
  const categoryField = document.querySelector("#categoryField");
  const dateInput = document.querySelector("#date");
  const saveButton = document.querySelector("#saveButton");
  const cancelEditButton = document.querySelector("#cancelEditButton");
  const formMessage = document.querySelector("#formMessage");

  dateInput.value = todayAsLocalISO();

  function showMessage(message, kind = "") {
    formMessage.textContent = message;
    formMessage.className = `form-message ${kind}`.trim();
  }

  function updateCategoryField() {
    const required = needsCategory(selectedType);
    categoryField.hidden = !required;
    categoryInput.required = required;
    if (!required) categoryInput.value = "";
  }

  function selectMovementType(type) {
    selectedType = type;
    document.querySelectorAll(".type-button").forEach(button => {
      button.classList.toggle("active", button.dataset.type === type);
    });
    updateCategoryField();
  }

  function resetForm() {
    editingMovementId = null;
    movementForm.reset();
    selectMovementType("income");
    dateInput.value = todayAsLocalISO();
    amountInput.value = "";
    categoryInput.value = "";
    saveButton.textContent = "Guardar movimiento";
    cancelEditButton.hidden = true;
  }

  function loadEditIfNeeded() {
    const editId = new URLSearchParams(window.location.search).get("edit");
    if (!editId || editingMovementId === editId) return;
    const movement = movements.find(item => item.id === editId);
    if (!movement) return;

    editingMovementId = movement.id;
    selectMovementType(movement.type);
    amountInput.value = new Intl.NumberFormat("es-CR").format(Number(movement.amount) || 0);
    descriptionInput.value = movement.description || "";
    dateInput.value = movement.date || todayAsLocalISO();
    if (needsCategory(movement.type)) {
      categoryInput.value = movement.category || movementCategory(movement);
      if (categoryInput.value === "Sin categoría") categoryInput.value = "";
    }
    saveButton.textContent = "Guardar cambios";
    cancelEditButton.hidden = false;
    showMessage("Editando movimiento.", "success");
    movementForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  window.__loadEditIfNeeded = loadEditIfNeeded;

  amountInput.addEventListener("input", () => {
    const value = parseAmount(amountInput.value);
    amountInput.value = value ? new Intl.NumberFormat("es-CR").format(value) : "";
  });

  document.querySelectorAll(".type-button").forEach(button => {
    button.addEventListener("click", () => selectMovementType(button.dataset.type));
  });

  cancelEditButton.addEventListener("click", () => {
    resetForm();
    history.replaceState({}, "", "./index.html");
    showMessage("");
  });

  movementForm.addEventListener("submit", async event => {
    event.preventDefault();
    showMessage("");

    const amount = parseAmount(amountInput.value);
    const description = descriptionInput.value.trim();
    const date = dateInput.value;
    const category = needsCategory(selectedType) ? categoryInput.value : "";

    if (!amount || amount <= 0) return showMessage("Escribe un monto válido.", "error");
    if (!description) return showMessage("Escribe una descripción.", "error");
    if (needsCategory(selectedType) && !category) return showMessage("Selecciona una categoría.", "error");
    if (!date) return showMessage("Selecciona una fecha.", "error");

    saveButton.disabled = true;
    saveButton.textContent = editingMovementId ? "Guardando…" : "Guardando…";

    const data = { type: selectedType, amount, description, category, date };

    try {
      if (editingMovementId) {
        await updateDoc(doc(db, "movimientos", editingMovementId), data);
        showMessage("Movimiento actualizado.", "success");
        history.replaceState({}, "", "./index.html");
      } else {
        await addDoc(movementsRef, { ...data, createdAt: serverTimestamp() });
        showMessage("Movimiento guardado.", "success");
      }
      resetForm();
    } catch (error) {
      console.error(error);
      showMessage("No se pudo guardar el movimiento.", "error");
    } finally {
      saveButton.disabled = false;
      if (!editingMovementId) saveButton.textContent = "Guardar movimiento";
    }
  });

  selectMovementType("income");
}

function setupDetailActions() {
  if (page === "home") return;

  const list = page === "history"
    ? document.querySelector("#historyList")
    : document.querySelector("#categoryList");
  const confirmDialog = document.querySelector("#confirmDialog");
  const confirmDeleteButton = document.querySelector("#confirmDeleteButton");

  list?.addEventListener("click", event => {
    const editButton = event.target.closest(".edit-button");
    if (editButton) {
      window.location.href = `./index.html?edit=${encodeURIComponent(editButton.dataset.id)}`;
      return;
    }

    const deleteButton = event.target.closest(".delete-button");
    if (!deleteButton) return;
    pendingDeleteId = deleteButton.dataset.id;
    confirmDialog.showModal();
  });

  confirmDialog?.addEventListener("close", async () => {
    if (confirmDialog.returnValue !== "confirm" || !pendingDeleteId) {
      pendingDeleteId = null;
      return;
    }

    confirmDeleteButton.disabled = true;
    try {
      await deleteDoc(doc(db, "movimientos", pendingDeleteId));
    } catch (error) {
      console.error(error);
    } finally {
      confirmDeleteButton.disabled = false;
      pendingDeleteId = null;
    }
  });
}

setupHomeForm();
setupDetailActions();

onSnapshot(
  movementsRef,
  snapshot => {
    movements = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    if (connectionStatus) {
      connectionStatus.textContent = "Sincronizado";
      connectionStatus.className = "status-pill online" + (page === "home" ? "" : " compact");
    }
    renderPage();
    if (page === "home" && window.__loadEditIfNeeded) window.__loadEditIfNeeded();
  },
  error => {
    console.error(error);
    if (connectionStatus) {
      connectionStatus.textContent = "Sin acceso";
      connectionStatus.className = "status-pill offline" + (page === "home" ? "" : " compact");
    }
  }
);

window.addEventListener("online", () => {
  if (!connectionStatus) return;
  connectionStatus.textContent = "Conectando…";
});

window.addEventListener("offline", () => {
  if (!connectionStatus) return;
  connectionStatus.textContent = "Sin internet";
  connectionStatus.className = "status-pill offline" + (page === "home" ? "" : " compact");
});

function showAppUpdate(worker) {
  if (document.querySelector("#appUpdateBanner")) return;
  const banner = document.createElement("div");
  banner.id = "appUpdateBanner";
  banner.style.cssText = "position:fixed;left:14px;right:14px;bottom:14px;z-index:9999;max-width:520px;margin:auto;padding:14px 15px;border-radius:18px;background:#123c31;color:#f7f4ee;box-shadow:0 16px 40px rgba(0,0,0,.24);font-family:Manrope,system-ui,sans-serif;";
  banner.innerHTML = '<div style="display:flex;align-items:center;gap:12px"><div style="flex:1"><strong style="display:block;font-size:14px">Nueva versión disponible</strong><span style="display:block;margin-top:2px;font-size:12px;opacity:.72">Actualiza para ver los últimos cambios.</span></div><button id="appUpdateButton" style="border:0;border-radius:12px;padding:9px 12px;background:#f7f4ee;color:#123c31;font-weight:800">Actualizar</button></div>';
  document.body.appendChild(banner);
  banner.querySelector("#appUpdateButton").onclick = () => worker.postMessage({ type: "SKIP_WAITING" });
}

if ("serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
      if (registration.waiting && navigator.serviceWorker.controller) showAppUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) showAppUpdate(worker);
        });
      });
      await registration.update();
    } catch (error) {
      console.error("No se pudo registrar el service worker:", error);
    }
  });
}
