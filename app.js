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

let selectedType = "income";
let movements = [];
let pendingDeleteId = null;
let editingMovementId = null;
let selectedMonthKey = null;
let selectedCategory = null;

const currentBalanceEl = document.querySelector("#currentBalance");
const cardBalanceEl = document.querySelector("#cardBalance");
const movementForm = document.querySelector("#movementForm");
const amountInput = document.querySelector("#amount");
const descriptionInput = document.querySelector("#description");
const categoryInput = document.querySelector("#category");
const categoryField = document.querySelector("#categoryField");
const dateInput = document.querySelector("#date");
const saveButton = document.querySelector("#saveButton");
const formMessage = document.querySelector("#formMessage");
const connectionStatus = document.querySelector("#connectionStatus");
const confirmDialog = document.querySelector("#confirmDialog");
const confirmDeleteButton = document.querySelector("#confirmDeleteButton");
const cancelEditButton = document.querySelector("#cancelEditButton");
const categorySummary = document.querySelector("#categorySummary");
const categoryPeriod = document.querySelector("#categoryPeriod");
const monthGroups = document.querySelector("#monthGroups");
const monthDetailTitle = document.querySelector("#monthDetailTitle");
const monthDetailSubtitle = document.querySelector("#monthDetailSubtitle");
const monthDetailList = document.querySelector("#monthDetailList");
const categoryDetailTitle = document.querySelector("#categoryDetailTitle");
const categoryDetailSubtitle = document.querySelector("#categoryDetailSubtitle");
const categoryDetailList = document.querySelector("#categoryDetailList");
const navHome = document.querySelector("#navHome");
const navHistory = document.querySelector("#navHistory");

const views = {
  home: document.querySelector("#viewHome"),
  history: document.querySelector("#viewHistory"),
  month: document.querySelector("#viewMonth"),
  category: document.querySelector("#viewCategory")
};

function todayAsLocalISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

dateInput.value = todayAsLocalISO();

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

function formatAmountInput() {
  const value = parseAmount(amountInput.value);
  amountInput.value = value ? new Intl.NumberFormat("es-CR").format(value) : "";
}

amountInput.addEventListener("input", formatAmountInput);

function calculateBalances(items) {
  return items.reduce(
    (totals, movement) => {
      const amount = Number(movement.amount) || 0;

      switch (movement.type) {
        case "income":
          totals.current += amount;
          break;

        case "expense":
          totals.current -= amount;
          break;

        case "card_purchase":
          totals.current -= amount;
          totals.card += amount;
          break;

        case "card_payment":
          totals.card -= amount;
          break;
      }

      return totals;
    },
    { current: 0, card: 0 }
  );
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

function monthLabel(key) {
  if (!key || key === "sin-fecha") return "Sin fecha";
  const [year, month] = key.split("-").map(Number);
  const text = new Intl.DateTimeFormat("es-CR", {
    month: "long",
    year: "numeric"
  }).format(new Date(year, month - 1, 1));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function currentMonthKey() {
  return todayAsLocalISO().slice(0, 7);
}

function movementVisual(type) {
  switch (type) {
    case "income": return { symbol: "↓", className: "", amountClass: "positive", sign: "+" };
    case "expense": return { symbol: "↑", className: "negative", amountClass: "negative", sign: "−" };
    case "card_purchase": return { symbol: "💳", className: "card", amountClass: "negative", sign: "−" };
    case "card_payment": return { symbol: "✓", className: "card negative", amountClass: "negative", sign: "−" };
    default: return { symbol: "•", className: "", amountClass: "", sign: "" };
  }
}

function isSpendingMovement(movement) {
  return movement.type === "expense" || movement.type === "card_purchase";
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

function movementCategory(movement) {
  if (!isSpendingMovement(movement)) return "";
  return movement.category || inferCategory(movement.description);
}

function needsCategory(type) {
  return type === "expense" || type === "card_purchase";
}

function updateCategoryField() {
  const required = needsCategory(selectedType);
  categoryField.hidden = !required;
  categoryInput.required = required;
  if (!required) categoryInput.value = "";
}

function showView(name) {
  Object.entries(views).forEach(([key, element]) => {
    element.hidden = key !== name;
  });

  navHome.classList.toggle("active", name === "home" || name === "category");
  navHistory.classList.toggle("active", name === "history" || name === "month");

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderMovementList(target, items) {
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
    description.textContent = movement.description;

    const meta = document.createElement("p");
    meta.className = "history-meta";
    meta.textContent = `${typeLabels[movement.type] ?? "Movimiento"} · ${formatDate(movement.date)}`;
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

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:4px;";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-button";
    editButton.textContent = "Editar";
    editButton.dataset.id = movement.id;
    editButton.style.cssText = "border:0;background:transparent;color:#167a4b;padding:0;font-size:12px;";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "Eliminar";
    deleteButton.dataset.id = movement.id;

    actions.append(editButton, deleteButton);
    amountBox.append(amount, actions);

    item.append(icon, info, amountBox);
    target.append(item);
  }
}

function renderCategorySummary() {
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

  categorySummary.innerHTML = ordered.map(category => {
    const items = groups.get(category);
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return `
      <button type="button" class="category-row" data-category="${escapeHTML(category)}">
        <span class="category-icon">${categoryIcons[category] || "📌"}</span>
        <span class="category-main">
          <strong>${escapeHTML(category)}</strong>
          <small>${items.length} ${items.length === 1 ? "movimiento" : "movimientos"}</small>
        </span>
        <span class="category-total">−${formatCurrency(total)}</span>
        <span class="row-chevron">›</span>
      </button>
    `;
  }).join("");
}

function renderHistoryMonths() {
  const groups = new Map();

  for (const movement of movements) {
    const key = monthKey(movement.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(movement);
  }

  const keys = [...groups.keys()].sort().reverse();

  if (!keys.length) {
    monthGroups.innerHTML = '<p class="empty-state">Todavía no hay movimientos.</p>';
    return;
  }

  monthGroups.innerHTML = keys.map(key => {
    const items = groups.get(key);
    const spending = items
      .filter(isSpendingMovement)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    return `
      <button type="button" class="month-row" data-month="${escapeHTML(key)}">
        <span class="month-icon">📅</span>
        <span class="month-main">
          <strong>${escapeHTML(monthLabel(key))}</strong>
          <small>${items.length} ${items.length === 1 ? "movimiento" : "movimientos"}</small>
        </span>
        <span class="month-total">${spending ? `−${formatCurrency(spending)}` : formatCurrency(0)}</span>
        <span class="row-chevron">›</span>
      </button>
    `;
  }).join("");
}

function renderMonthDetail() {
  if (!selectedMonthKey) return;

  const items = movements.filter(movement => monthKey(movement.date) === selectedMonthKey);
  monthDetailTitle.textContent = monthLabel(selectedMonthKey);
  monthDetailSubtitle.textContent = `${items.length} ${items.length === 1 ? "movimiento" : "movimientos"}`;
  renderMovementList(monthDetailList, items);
}

function renderCategoryDetail() {
  if (!selectedCategory) return;

  const key = currentMonthKey();
  const items = movements.filter(
    movement =>
      isSpendingMovement(movement) &&
      monthKey(movement.date) === key &&
      movementCategory(movement) === selectedCategory
  );

  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  categoryDetailTitle.textContent = `${categoryIcons[selectedCategory] || "📌"} ${selectedCategory}`;
  categoryDetailSubtitle.textContent =
    `${monthLabel(key)} · ${items.length} ${items.length === 1 ? "movimiento" : "movimientos"} · ${formatCurrency(total)}`;

  renderMovementList(categoryDetailList, items);
}

function render() {
  const totals = calculateBalances(movements);
  currentBalanceEl.textContent = formatCurrency(totals.current);
  cardBalanceEl.textContent = formatCurrency(Math.max(0, totals.card));

  renderCategorySummary();
  renderHistoryMonths();
  renderMonthDetail();
  renderCategoryDetail();
}

function showMessage(message, kind = "") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${kind}`.trim();
}

function setSaving(isSaving) {
  saveButton.disabled = isSaving;
  saveButton.textContent = isSaving
    ? "Guardando…"
    : (editingMovementId ? "Guardar cambios" : "Guardar movimiento");
}

function selectMovementType(type) {
  selectedType = type;
  document.querySelectorAll(".type-button").forEach(button => {
    button.classList.toggle("active", button.dataset.type === type);
  });
  updateCategoryField();
}

function startEditing(movementId) {
  const movement = movements.find(item => item.id === movementId);
  if (!movement) return;

  editingMovementId = movement.id;
  selectMovementType(movement.type);
  amountInput.value = new Intl.NumberFormat("es-CR").format(Number(movement.amount) || 0);
  descriptionInput.value = movement.description;
  dateInput.value = movement.date;

  if (needsCategory(movement.type)) {
    categoryInput.value = movement.category || movementCategory(movement);
    if (categoryInput.value === "Sin categoría") categoryInput.value = "";
  }

  saveButton.textContent = "Guardar cambios";
  cancelEditButton.hidden = false;
  showMessage("Editando movimiento.", "success");
  showView("home");
  movementForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditing() {
  editingMovementId = null;
  movementForm.reset();
  selectMovementType("income");
  dateInput.value = todayAsLocalISO();
  amountInput.value = "";
  categoryInput.value = "";
  saveButton.textContent = "Guardar movimiento";
  cancelEditButton.hidden = true;
  showMessage("");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

cancelEditButton.addEventListener("click", cancelEditing);

for (const button of document.querySelectorAll(".type-button")) {
  button.addEventListener("click", () => selectMovementType(button.dataset.type));
}

movementForm.addEventListener("submit", async event => {
  event.preventDefault();
  showMessage("");

  const amount = parseAmount(amountInput.value);
  const description = descriptionInput.value.trim();
  const date = dateInput.value;
  const category = needsCategory(selectedType) ? categoryInput.value : "";

  if (!amount || amount <= 0) {
    showMessage("Escribe un monto válido.", "error");
    amountInput.focus();
    return;
  }

  if (!description) {
    showMessage("Escribe una descripción.", "error");
    descriptionInput.focus();
    return;
  }

  if (needsCategory(selectedType) && !category) {
    showMessage("Selecciona una categoría.", "error");
    categoryInput.focus();
    return;
  }

  if (!date) {
    showMessage("Selecciona una fecha.", "error");
    dateInput.focus();
    return;
  }

  setSaving(true);

  try {
    const data = {
      type: selectedType,
      amount,
      description,
      category,
      date
    };

    if (editingMovementId) {
      await updateDoc(doc(db, "movimientos", editingMovementId), data);
      editingMovementId = null;
      cancelEditButton.hidden = true;
      showMessage("Movimiento actualizado correctamente.", "success");
    } else {
      await addDoc(movementsRef, {
        ...data,
        createdAt: serverTimestamp()
      });
      showMessage("Movimiento guardado.", "success");
    }

    movementForm.reset();
    selectMovementType("income");
    dateInput.value = todayAsLocalISO();
    amountInput.value = "";
    categoryInput.value = "";
    saveButton.textContent = "Guardar movimiento";
  } catch (error) {
    console.error(error);
    const detail = error?.code ? ` (${error.code})` : "";
    showMessage(`No se pudo guardar${detail}. Revisa la conexión o las reglas de Firebase.`, "error");
  } finally {
    setSaving(false);
  }
});

function handleMovementActions(event) {
  const editButton = event.target.closest(".edit-button");
  if (editButton) {
    startEditing(editButton.dataset.id);
    return;
  }

  const deleteButton = event.target.closest(".delete-button");
  if (!deleteButton) return;

  pendingDeleteId = deleteButton.dataset.id;
  confirmDialog.showModal();
}

monthDetailList.addEventListener("click", handleMovementActions);
categoryDetailList.addEventListener("click", handleMovementActions);

categorySummary.addEventListener("click", event => {
  const row = event.target.closest("[data-category]");
  if (!row) return;
  selectedCategory = row.dataset.category;
  renderCategoryDetail();
  showView("category");
});

monthGroups.addEventListener("click", event => {
  const row = event.target.closest("[data-month]");
  if (!row) return;
  selectedMonthKey = row.dataset.month;
  renderMonthDetail();
  showView("month");
});

document.querySelectorAll("[data-go]").forEach(button => {
  button.addEventListener("click", () => {
    const destination = button.dataset.go;
    showView(destination);
  });
});

confirmDialog.addEventListener("close", async () => {
  if (confirmDialog.returnValue !== "confirm" || !pendingDeleteId) {
    pendingDeleteId = null;
    return;
  }

  confirmDeleteButton.disabled = true;

  try {
    await deleteDoc(doc(db, "movimientos", pendingDeleteId));
  } catch (error) {
    console.error(error);
    showMessage("No se pudo eliminar el movimiento.", "error");
  } finally {
    confirmDeleteButton.disabled = false;
    pendingDeleteId = null;
  }
});

onSnapshot(
  movementsRef,
  snapshot => {
    movements = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    connectionStatus.textContent = "Sincronizado";
    connectionStatus.className = "status-pill online";
    render();
  },
  error => {
    console.error(error);
    connectionStatus.textContent = "Sin acceso";
    connectionStatus.className = "status-pill offline";
    showMessage("Firebase rechazó la conexión. Debemos revisar las reglas.", "error");
  }
);

window.addEventListener("online", () => {
  connectionStatus.textContent = "Conectando…";
  connectionStatus.className = "status-pill";
});

window.addEventListener("offline", () => {
  connectionStatus.textContent = "Sin internet";
  connectionStatus.className = "status-pill offline";
});

selectMovementType("income");
showView("home");

// Sistema de actualización de la aplicación.
function showAppUpdate(worker) {
  let banner = document.querySelector("#appUpdateBanner");

  if (!banner) {
    banner = document.createElement("div");
    banner.id = "appUpdateBanner";
    banner.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:78px;z-index:9999;max-width:520px;margin:auto;padding:14px 15px;border-radius:16px;background:#fff;color:#17212b;box-shadow:0 12px 35px rgba(0,0,0,.22);border:1px solid #dfe7e3;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;";
    banner.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px"><div style="flex:1"><strong style="display:block;font-size:15px">Nueva versión disponible</strong><span style="display:block;margin-top:2px;font-size:13px;color:#64706b">Hay mejoras listas para instalar.</span></div><button id="appUpdateButton" type="button" style="border:0;border-radius:11px;padding:10px 14px;background:#16855b;color:#fff;font-weight:700">Actualizar</button></div>';
    document.body.appendChild(banner);
  }

  const button = banner.querySelector("#appUpdateButton");
  button.onclick = () => {
    button.disabled = true;
    button.textContent = "Actualizando…";
    worker.postMessage({ type: "SKIP_WAITING" });
  };
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
      const registration = await navigator.serviceWorker.register("./service-worker.js", {
        updateViaCache: "none"
      });

      if (registration.waiting && navigator.serviceWorker.controller) {
        showAppUpdate(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            showAppUpdate(worker);
          }
        });
      });

      await registration.update();

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => {});
        }
      });
    } catch (error) {
      console.error("No se pudo revisar actualizaciones:", error);
    }
  });
}
