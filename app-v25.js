import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  setDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch
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
const recordsRef = collection(db, "movimientos");
const page = document.body.dataset.page || "home";

const FINANCIAL_TYPES = new Set(["income", "expense", "card_purchase", "card_payment"]);

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

const scheduledPayments = {
  "15": [
    { id: "celulares", name: "Celulares" },
    { id: "agua", name: "Agua" },
    { id: "internet", name: "Internet" },
    { id: "prestamo-casa-1", name: "1er Pago Préstamo Casa", amount: 239000 },
    { id: "tarjeta-bcr-ale", name: "Tarjeta BCR Ale", amount: 42000 },
    { id: "clases-ingles-moises", name: "Clases inglés Moisés", amount: 16000 }
  ],
  "30": [
    { id: "electricidad", name: "Electricidad" },
    { id: "tarjeta-credito", name: "Tarjeta de Crédito" },
    { id: "prestamo-coopenae", name: "Préstamo Coopenae", amount: 178000 },
    { id: "prestamo-casa-2", name: "2do Pago Préstamo Casa", amount: 239000 },
    { id: "prestamo-coonape-ale", name: "Préstamo Coonape Ale", amount: 36000 },
    { id: "tarjeta-coopenae-ale", name: "Tarjeta Coopenae Ale", amount: 45000 }
  ]
};

let allRecords = [];
let movements = [];
let paymentStateRecords = [];
let balanceAdjustmentRecords = [];
let pendingDeleteId = null;
let movementFormPopulated = false;
let adjustmentUnlocked = false;
let adjustmentEditCurrent = false;
let adjustmentEditCredit = false;

const connectionStatus = document.querySelector("#connectionStatus");

function todayAsLocalISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function currentMonthKey() {
  return todayAsLocalISO().slice(0, 7);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function parseAmount(rawValue) {
  const digits = String(rawValue ?? "").replace(/[^0-9]/g, "");
  return digits ? Number(digits) : 0;
}

function calculateBalances(items, adjustments = balanceAdjustmentRecords) {
  let current = 0;
  let card = 0;

  for (const movement of items) {
    const amount = Number(movement.amount) || 0;

    switch (movement.type) {
      case "income":
        current += amount;
        break;
      case "expense":
        current -= amount;
        break;
      case "card_purchase":
        current -= amount;
        card += amount;
        break;
      case "card_payment":
        // El pago de tarjeta SOLO reduce el crédito. Nunca cambia el saldo real.
        card -= amount;
        break;
      default:
        break;
    }
  }

  // Los ajustes manuales se guardan como diferencias. De esta forma,
  // los movimientos futuros siguen sumando/restando normalmente.
  for (const adjustment of adjustments) {
    current += Number(adjustment.currentDelta) || 0;
    card += Number(adjustment.cardDelta) || 0;
  }

  return { current, card: Math.max(0, card) };
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
  if (/(banco|prestamo|credito|bac|bcr|coopenae|conape|coonape|cuota|financ)/.test(text)) return "Bancos";
  if (/(internet|cable|kolbi|liberty|telecable|limpieza casa|servicio casa)/.test(text)) return "Servicios de casa";
  if (/(amazon|temu|shein|aliexpress|compra en linea|compra online)/.test(text)) return "Compras en línea";
  if (/(aseo|limpieza|detergente|jabon|cloro)/.test(text)) return "Aseo";
  if (/(cine|cinema|pelicula|paseo|parque de diversiones|entrada|entretenimiento)/.test(text)) return "Ocio y entretenimiento";
  return "Sin categoría";
}

function isFinancialMovement(item) {
  return FINANCIAL_TYPES.has(item.type);
}

function isManualAdjustmentMovement(item) {
  return String(item.description || "").startsWith("[AJUSTE]");
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
    case "income": return { symbol: "↓", amountClass: "positive", sign: "+" };
    case "expense": return { symbol: "−", amountClass: "negative", sign: "−" };
    case "card_purchase": return { symbol: "▣", amountClass: "negative", sign: "−" };
    case "card_payment": return { symbol: "✓", amountClass: "negative", sign: "−" };
    default: return { symbol: "•", amountClass: "", sign: "" };
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHome() {
  const currentBalanceEl = document.querySelector("#currentBalance");
  const cardBalanceEl = document.querySelector("#cardBalance");
  if (!currentBalanceEl || !cardBalanceEl) return;

  const totals = calculateBalances(movements);
  currentBalanceEl.textContent = formatCurrency(totals.current);
  cardBalanceEl.textContent = formatCurrency(totals.card);
}

function categoryGroupsForMonth(key) {
  const groups = new Map();
  const monthSpending = movements.filter(
    movement => !isManualAdjustmentMovement(movement) && isSpendingMovement(movement) && monthKey(movement.date) === key
  );

  for (const movement of monthSpending) {
    const category = movementCategory(movement);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(movement);
  }
  return groups;
}

function orderedCategories(groups) {
  return [
    ...categories.filter(category => groups.has(category)),
    ...(groups.has("Sin categoría") ? ["Sin categoría"] : [])
  ];
}

function renderHistory() {
  const container = document.querySelector("#historyMonths");
  if (!container) return;

  const monthKeys = [...new Set(
    movements.filter(movement => !isManualAdjustmentMovement(movement) && isSpendingMovement(movement)).map(movement => monthKey(movement.date))
  )].sort().reverse();

  if (!monthKeys.length) {
    container.innerHTML = '<section class="panel list-panel"><p class="empty-state">Todavía no hay gastos registrados.</p></section>';
    return;
  }

  container.innerHTML = "";

  for (const key of monthKeys) {
    const groups = categoryGroupsForMonth(key);
    const ordered = orderedCategories(groups);
    const monthTotal = [...groups.values()].flat().reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const section = document.createElement("section");
    section.className = "panel list-panel month-panel";

    const header = document.createElement("div");
    header.className = "month-panel-header";
    header.innerHTML = `<h2>${escapeHTML(monthLabel(key))}</h2><span>−${escapeHTML(formatCurrency(monthTotal))}</span>`;

    const list = document.createElement("div");
    list.className = "category-summary";

    for (const category of ordered) {
      const items = groups.get(category);
      const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const row = document.createElement("a");
      row.className = "category-row";
      row.href = `./category.html?month=${encodeURIComponent(key)}&category=${encodeURIComponent(category)}`;
      row.innerHTML = `
        <span class="category-icon">${categoryIcons[category] || "📌"}</span>
        <span class="category-main">
          <strong>${escapeHTML(category)}</strong>
          <small>${items.length} ${items.length === 1 ? "movimiento" : "movimientos"}</small>
        </span>
        <span class="category-total">−${escapeHTML(formatCurrency(total))}</span>
        <span class="row-chevron">›</span>
      `;
      list.append(row);
    }

    section.append(header, list);
    container.append(section);
  }
}

function renderTypedHistory() {
  const container = document.querySelector("#typedHistoryMonths");
  if (!container) return;

  const isIncomeHistory = page === "income-history";
  const type = isIncomeHistory ? "income" : "card_purchase";
  const filtered = movements.filter(movement => !isManualAdjustmentMovement(movement) && movement.type === type);
  const monthKeys = [...new Set(filtered.map(movement => monthKey(movement.date)))].sort().reverse();

  if (!monthKeys.length) {
    container.innerHTML = `<section class="panel list-panel"><p class="empty-state">${isIncomeHistory ? "Todavía no hay depósitos registrados." : "Todavía no hay gastos de crédito registrados."}</p></section>`;
    return;
  }

  container.innerHTML = "";

  for (const key of monthKeys) {
    const items = sortedMovements(filtered.filter(movement => monthKey(movement.date) === key));
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const section = document.createElement("section");
    section.className = "panel list-panel month-panel typed-month-panel";

    const header = document.createElement("div");
    header.className = "month-panel-header";
    header.innerHTML = `
      <h2>${escapeHTML(monthLabel(key))}</h2>
      <span class="${isIncomeHistory ? "typed-total-income" : "typed-total-credit"}">${isIncomeHistory ? "+" : "−"}${escapeHTML(formatCurrency(total))}</span>
    `;

    const list = document.createElement("div");
    list.className = "history-list typed-month-list";

    for (const movement of items) {
      const item = document.createElement("article");
      item.className = "history-item typed-history-item";

      const icon = document.createElement("div");
      icon.className = `history-icon ${isIncomeHistory ? "income-history-icon" : "credit-history-icon"}`;
      icon.textContent = isIncomeHistory ? "↓" : (categoryIcons[movementCategory(movement)] || "▣");

      const info = document.createElement("div");
      const categoryLine = !isIncomeHistory
        ? `<span class="detail-category">${escapeHTML(movementCategory(movement))}</span>`
        : "";
      info.innerHTML = `
        <p class="history-description">${escapeHTML(movement.description || (isIncomeHistory ? "Depósito" : "Gasto de crédito"))}</p>
        <span class="history-meta">${escapeHTML(formatDate(movement.date))}</span>
        ${categoryLine}
      `;

      const amount = document.createElement("div");
      amount.className = `history-amount ${isIncomeHistory ? "positive" : "negative"}`;
      amount.textContent = `${isIncomeHistory ? "+" : "−"}${formatCurrency(movement.amount)}`;

      item.append(icon, info, amount);
      list.append(item);
    }

    section.append(header, list);
    container.append(section);
  }
}

function renderMovementList(target, items) {
  if (!target) return;
  if (!items.length) {
    target.innerHTML = '<p class="empty-state">No hay movimientos en esta categoría.</p>';
    return;
  }

  target.innerHTML = "";
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category") || "";
  const month = params.get("month") || "";
  const returnUrl = `./category.html?month=${encodeURIComponent(month)}&category=${encodeURIComponent(category)}`;

  for (const movement of sortedMovements(items)) {
    const visual = movementVisual(movement.type);
    const item = document.createElement("article");
    item.className = "history-item";

    const icon = document.createElement("div");
    icon.className = "history-icon";
    icon.textContent = categoryIcons[movementCategory(movement)] || visual.symbol;

    const info = document.createElement("div");
    info.innerHTML = `
      <p class="history-description">${escapeHTML(movement.description || "Sin descripción")}</p>
      <span class="history-meta">${escapeHTML(typeLabels[movement.type] || "Movimiento")} · ${escapeHTML(formatDate(movement.date))}</span>
      <span class="detail-category">${escapeHTML(movementCategory(movement))}</span>
    `;

    const amountBox = document.createElement("div");
    amountBox.innerHTML = `<div class="history-amount ${visual.amountClass}">${visual.sign}${escapeHTML(formatCurrency(movement.amount))}</div>`;

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-button";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => {
      window.location.href = `./movement.html?edit=${encodeURIComponent(movement.id)}&return=${encodeURIComponent(returnUrl)}`;
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "Eliminar";
    deleteButton.addEventListener("click", () => openDeleteDialog(movement.id));

    actions.append(editButton, deleteButton);
    amountBox.append(actions);
    item.append(icon, info, amountBox);
    target.append(item);
  }
}

function renderCategory() {
  const params = new URLSearchParams(window.location.search);
  const selectedCategory = params.get("category") || "Sin categoría";
  const selectedMonth = params.get("month") || currentMonthKey();

  const title = document.querySelector("#categoryTitle");
  const monthTitle = document.querySelector("#categoryMonth");
  const totalEl = document.querySelector("#categoryTotal");
  const list = document.querySelector("#categoryList");
  if (!title || !monthTitle || !totalEl || !list) return;

  const items = movements.filter(
    movement => !isManualAdjustmentMovement(movement) && isSpendingMovement(movement) &&
      monthKey(movement.date) === selectedMonth &&
      movementCategory(movement) === selectedCategory
  );
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  title.textContent = `${categoryIcons[selectedCategory] || "📌"} ${selectedCategory}`;
  monthTitle.textContent = monthLabel(selectedMonth).toUpperCase();
  totalEl.textContent = `${items.length} ${items.length === 1 ? "movimiento" : "movimientos"} · ${formatCurrency(total)}`;
  renderMovementList(list, items);
}

function openDeleteDialog(id) {
  pendingDeleteId = id;
  const dialog = document.querySelector("#confirmDialog");
  dialog?.showModal();
}

function setupDeleteDialog() {
  const dialog = document.querySelector("#confirmDialog");
  const confirmButton = document.querySelector("#confirmDeleteButton");
  if (!dialog || !confirmButton) return;

  dialog.addEventListener("close", async () => {
    if (dialog.returnValue !== "confirm" || !pendingDeleteId) {
      pendingDeleteId = null;
      return;
    }

    confirmButton.disabled = true;
    try {
      await deleteDoc(doc(db, "movimientos", pendingDeleteId));
    } catch (error) {
      console.error(error);
    } finally {
      pendingDeleteId = null;
      confirmButton.disabled = false;
    }
  });
}

function movementTypeFromParams() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("type");
  return FINANCIAL_TYPES.has(requested) ? requested : "income";
}

function setupMovementForm() {
  const form = document.querySelector("#movementForm");
  if (!form) return;

  const amountInput = document.querySelector("#amount");
  const descriptionInput = document.querySelector("#description");
  const categoryInput = document.querySelector("#category");
  const categoryField = document.querySelector("#categoryField");
  const dateInput = document.querySelector("#date");
  const saveButton = document.querySelector("#saveButton");
  const formMessage = document.querySelector("#formMessage");
  const title = document.querySelector("#movementTitle");
  const badge = document.querySelector("#movementTypeBadge");
  const backLink = document.querySelector("#movementBack");

  const params = new URLSearchParams(window.location.search);
  const editId = params.get("edit");
  const returnUrl = params.get("return");
  if (backLink && returnUrl) backLink.href = returnUrl;

  dateInput.value = todayAsLocalISO();

  amountInput.addEventListener("input", () => {
    const value = parseAmount(amountInput.value);
    amountInput.value = value ? new Intl.NumberFormat("es-CR").format(value) : "";
  });

  function setType(type) {
    const label = typeLabels[type] || "Movimiento";
    title.textContent = editId ? `Editar ${label.toLowerCase()}` : label;
    badge.textContent = label;
    categoryField.hidden = !needsCategory(type);
    categoryInput.required = needsCategory(type);
  }

  setType(movementTypeFromParams());

  form.addEventListener("submit", async event => {
    event.preventDefault();
    formMessage.textContent = "";
    formMessage.className = "form-message";

    const type = form.dataset.type || movementTypeFromParams();
    const amount = parseAmount(amountInput.value);
    const description = descriptionInput.value.trim();
    const date = dateInput.value;
    const category = needsCategory(type) ? categoryInput.value : "";

    if (!amount) return showFormMessage("Escribe un monto válido.", "error");
    if (!description) return showFormMessage("Escribe una descripción.", "error");
    if (!date) return showFormMessage("Selecciona una fecha.", "error");
    if (needsCategory(type) && !category) return showFormMessage("Selecciona una categoría.", "error");

    saveButton.disabled = true;
    saveButton.textContent = editId ? "Guardando cambios…" : "Guardando…";

    try {
      const data = { type, amount, description, category, date };

      if (editId) {
        await updateDoc(doc(db, "movimientos", editId), data);
        showFormMessage("Movimiento actualizado.", "success");
      } else {
        await addDoc(recordsRef, { ...data, createdAt: serverTimestamp() });
        showFormMessage("Movimiento guardado.", "success");
      }

      window.setTimeout(() => {
        window.location.href = editId && returnUrl ? returnUrl : "./register.html";
      }, 450);
    } catch (error) {
      console.error(error);
      showFormMessage("No se pudo guardar el movimiento.", "error");
      saveButton.disabled = false;
      saveButton.textContent = editId ? "Guardar cambios" : "Guardar movimiento";
    }
  });

  function showFormMessage(message, kind) {
    formMessage.textContent = message;
    formMessage.className = `form-message ${kind}`;
  }
}

function populateMovementEditIfNeeded() {
  if (page !== "movement" || movementFormPopulated) return;
  const params = new URLSearchParams(window.location.search);
  const editId = params.get("edit");
  if (!editId) return;

  const movement = movements.find(item => item.id === editId);
  if (!movement) return;

  const form = document.querySelector("#movementForm");
  const amountInput = document.querySelector("#amount");
  const descriptionInput = document.querySelector("#description");
  const categoryInput = document.querySelector("#category");
  const categoryField = document.querySelector("#categoryField");
  const dateInput = document.querySelector("#date");
  const title = document.querySelector("#movementTitle");
  const badge = document.querySelector("#movementTypeBadge");
  const saveButton = document.querySelector("#saveButton");

  form.dataset.type = movement.type;
  amountInput.value = new Intl.NumberFormat("es-CR").format(Number(movement.amount) || 0);
  descriptionInput.value = movement.description || "";
  dateInput.value = movement.date || todayAsLocalISO();
  categoryField.hidden = !needsCategory(movement.type);
  categoryInput.required = needsCategory(movement.type);
  categoryInput.value = movement.category || movementCategory(movement) || "";
  title.textContent = `Editar ${String(typeLabels[movement.type] || "movimiento").toLowerCase()}`;
  badge.textContent = typeLabels[movement.type] || "Movimiento";
  saveButton.textContent = "Guardar cambios";
  movementFormPopulated = true;
}

function paymentStatusDocId(month, cycle, paymentId) {
  return `scheduled_${month}_${cycle}_${paymentId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function localPaymentKey(month, cycle, paymentId) {
  return `finanzas-payment:${month}:${cycle}:${paymentId}`;
}

function paymentPaidState(month, cycle, paymentId) {
  const match = paymentStateRecords.find(item =>
    item.kind === "scheduled_payment_status" &&
    item.monthKey === month &&
    String(item.cycle) === String(cycle) &&
    item.paymentId === paymentId
  );
  if (match) return Boolean(match.paid);
  return localStorage.getItem(localPaymentKey(month, cycle, paymentId)) === "paid";
}

function renderPaymentCycle() {
  const container = document.querySelector("#scheduledPayments");
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const cycle = params.get("cycle") === "30" ? "30" : "15";
  const month = currentMonthKey();
  const payments = scheduledPayments[cycle];

  const title = document.querySelector("#paymentCycleTitle");
  const monthEl = document.querySelector("#paymentMonth");
  title.textContent = `${cycle} de cada mes`;
  monthEl.textContent = monthLabel(month).toUpperCase();

  container.innerHTML = "";

  for (const payment of payments) {
    const paid = paymentPaidState(month, cycle, payment.id);
    const item = document.createElement("article");
    item.className = `payment-item${paid ? " paid" : ""}`;
    item.dataset.paymentId = payment.id;

    const amountHTML = payment.amount ? `<span class="payment-amount">${escapeHTML(formatCurrency(payment.amount))}</span>` : "";
    item.innerHTML = `
      <div class="payment-item-top">
        <div>
          <p class="payment-name">${escapeHTML(payment.name)}</p>
          ${amountHTML}
        </div>
        <span class="payment-state-dot" aria-hidden="true"></span>
      </div>
      <div class="status-toggle" role="group" aria-label="Estado de ${escapeHTML(payment.name)}">
        <button type="button" class="status-option pending ${paid ? "" : "active"}" data-payment-id="${escapeHTML(payment.id)}" data-paid="false">Pendiente</button>
        <button type="button" class="status-option paid ${paid ? "active" : ""}" data-payment-id="${escapeHTML(payment.id)}" data-paid="true">Pagado</button>
      </div>
    `;
    container.append(item);
  }
}

function setupPaymentCycleActions() {
  const container = document.querySelector("#scheduledPayments");
  const message = document.querySelector("#paymentStatusMessage");
  if (!container) return;

  container.addEventListener("click", async event => {
    const button = event.target.closest(".status-option");
    if (!button) return;

    const params = new URLSearchParams(window.location.search);
    const cycle = params.get("cycle") === "30" ? "30" : "15";
    const month = currentMonthKey();
    const paymentId = button.dataset.paymentId;
    const paid = button.dataset.paid === "true";

    localStorage.setItem(localPaymentKey(month, cycle, paymentId), paid ? "paid" : "pending");

    const existing = paymentStateRecords.find(item =>
      item.monthKey === month && String(item.cycle) === cycle && item.paymentId === paymentId
    );
    if (existing) existing.paid = paid;
    else paymentStateRecords.push({ kind: "scheduled_payment_status", monthKey: month, cycle, paymentId, paid });
    renderPaymentCycle();

    message.textContent = "Guardando…";
    message.className = "sync-note";

    try {
      const statusRef = doc(db, "movimientos", paymentStatusDocId(month, cycle, paymentId));
      await setDoc(statusRef, {
        kind: "scheduled_payment_status",
        monthKey: month,
        cycle,
        paymentId,
        paid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      message.textContent = paid ? "Marcado como pagado." : "Marcado como pendiente.";
      message.className = "sync-note success";
    } catch (error) {
      console.error(error);
      message.textContent = "Se guardó en este dispositivo, pero no se pudo sincronizar.";
      message.className = "sync-note error";
    }
  });
}


const ADJUSTMENT_PIN_HASH = "322ac9c5f39fcb8a5cf2d3ad558913ad6b056d8093c50704dda0215ee11c2a3a";

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function formatPlainAmount(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 0 }).format(number);
}

function renderAdjustmentPage() {
  if (page !== "adjustments" || !adjustmentUnlocked) return;

  const content = document.querySelector("#adjustmentContent");
  const currentDisplay = document.querySelector("#adjustmentCurrentDisplay");
  const creditDisplay = document.querySelector("#adjustmentCreditDisplay");
  const currentInput = document.querySelector("#adjustmentCurrentInput");
  const creditInput = document.querySelector("#adjustmentCreditInput");
  if (!content || !currentDisplay || !creditDisplay || !currentInput || !creditInput) return;

  const totals = calculateBalances(movements, balanceAdjustmentRecords);
  content.hidden = false;
  currentDisplay.textContent = formatCurrency(totals.current);
  creditDisplay.textContent = formatCurrency(totals.card);

  if (!adjustmentEditCurrent) currentInput.value = formatPlainAmount(totals.current);
  if (!adjustmentEditCredit) creditInput.value = formatPlainAmount(totals.card);
}

function setupAdjustmentPage() {
  if (page !== "adjustments") return;

  const pinDialog = document.querySelector("#pinDialog");
  const pinForm = document.querySelector("#pinForm");
  const pinInput = document.querySelector("#pinInput");
  const pinMessage = document.querySelector("#pinMessage");
  const currentInput = document.querySelector("#adjustmentCurrentInput");
  const creditInput = document.querySelector("#adjustmentCreditInput");
  const currentEditArea = document.querySelector("#currentEditArea");
  const creditEditArea = document.querySelector("#creditEditArea");
  const editCurrentButton = document.querySelector("#editCurrentButton");
  const editCreditButton = document.querySelector("#editCreditButton");
  const saveButton = document.querySelector("#saveAdjustmentsButton");
  const message = document.querySelector("#adjustmentMessage");

  if (!pinDialog || !pinForm || !pinInput || !currentInput || !creditInput || !saveButton) return;

  pinDialog.addEventListener("cancel", event => event.preventDefault());
  requestAnimationFrame(() => {
    pinDialog.showModal();
    window.setTimeout(() => pinInput.focus(), 80);
  });

  pinInput.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
    pinMessage.textContent = "";
    pinMessage.className = "form-message";
  });

  pinForm.addEventListener("submit", async event => {
    event.preventDefault();
    pinMessage.textContent = "Verificando…";
    pinMessage.className = "form-message";

    try {
      const enteredHash = await sha256Hex(pinInput.value);
      if (enteredHash !== ADJUSTMENT_PIN_HASH) {
        pinMessage.textContent = "PIN incorrecto.";
        pinMessage.className = "form-message error";
        pinInput.value = "";
        pinInput.focus();
        return;
      }

      adjustmentUnlocked = true;
      pinDialog.close();
      renderAdjustmentPage();
    } catch (error) {
      console.error(error);
      pinMessage.textContent = "No se pudo validar el PIN.";
      pinMessage.className = "form-message error";
    }
  });

  function formatAdjustmentInput(input) {
    const digits = String(input.value ?? "").replace(/[^0-9]/g, "");
    input.value = digits === "" ? "" : formatPlainAmount(Number(digits));
  }

  currentInput.addEventListener("input", () => formatAdjustmentInput(currentInput));
  creditInput.addEventListener("input", () => formatAdjustmentInput(creditInput));

  editCurrentButton?.addEventListener("click", () => {
    adjustmentEditCurrent = true;
    currentEditArea.hidden = false;
    saveButton.hidden = false;
    const totals = calculateBalances(movements, balanceAdjustmentRecords);
    currentInput.value = formatPlainAmount(totals.current);
    currentInput.focus();
    currentInput.select();
  });

  editCreditButton?.addEventListener("click", () => {
    adjustmentEditCredit = true;
    creditEditArea.hidden = false;
    saveButton.hidden = false;
    const totals = calculateBalances(movements, balanceAdjustmentRecords);
    creditInput.value = formatPlainAmount(totals.card);
    creditInput.focus();
    creditInput.select();
  });

  saveButton.addEventListener("click", async () => {
    if (!adjustmentUnlocked || (!adjustmentEditCurrent && !adjustmentEditCredit)) return;

    const before = calculateBalances(movements, balanceAdjustmentRecords);
    const desiredCurrent = adjustmentEditCurrent ? parseAmount(currentInput.value) : before.current;
    const desiredCredit = adjustmentEditCredit ? parseAmount(creditInput.value) : before.card;
    const currentDelta = desiredCurrent - before.current;
    const cardDelta = desiredCredit - before.card;

    if (currentDelta === 0 && cardDelta === 0) {
      message.textContent = "No hay cambios para guardar.";
      message.className = "form-message";
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Guardando…";
    message.textContent = "";
    message.className = "form-message";

    try {
      // Guardamos los ajustes como movimientos normales para que sean compatibles
      // con las mismas reglas de Firebase que ya permiten registrar movimientos.
      // El prefijo [AJUSTE] hace que no aparezcan en los históricos visibles.
      const batch = writeBatch(db);
      const date = todayAsLocalISO();

      function addAdjustmentMovement(type, amount, description, category = "") {
        if (!amount || amount <= 0) return;
        const ref = doc(recordsRef);
        batch.set(ref, {
          type,
          amount,
          description: `[AJUSTE] ${description}`,
          category,
          date,
          createdAt: serverTimestamp()
        });
      }

      if (currentDelta > 0) {
        addAdjustmentMovement("income", currentDelta, "Saldo real");
      } else if (currentDelta < 0) {
        addAdjustmentMovement("expense", Math.abs(currentDelta), "Saldo real", "Bancos");
      }

      if (cardDelta > 0) {
        // Aumentar crédito con una compra bajaría el saldo real; por eso se crea
        // un ingreso compensatorio del mismo monto para que el saldo real no cambie.
        addAdjustmentMovement("card_purchase", cardDelta, "Total crédito", "Bancos");
        addAdjustmentMovement("income", cardDelta, "Compensación de crédito");
      } else if (cardDelta < 0) {
        addAdjustmentMovement("card_payment", Math.abs(cardDelta), "Total crédito");
      }

      await batch.commit();

      adjustmentEditCurrent = false;
      adjustmentEditCredit = false;
      currentEditArea.hidden = true;
      creditEditArea.hidden = true;
      saveButton.hidden = true;
      message.textContent = "Ajuste guardado y sincronizado.";
      message.className = "form-message success";
    } catch (error) {
      console.error("Error al guardar ajuste:", error);
      const code = error?.code ? ` (${error.code})` : "";
      message.textContent = `No se pudo guardar el ajuste${code}.`;
      message.className = "form-message error";
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Guardar cambios";
    }
  });
}

function renderPage() {
  if (page === "home") renderHome();
  if (page === "history") renderHistory();
  if (page === "income-history" || page === "credit-history") renderTypedHistory();
  if (page === "category") renderCategory();
  if (page === "movement") populateMovementEditIfNeeded();
  if (page === "payment-cycle") renderPaymentCycle();
  if (page === "adjustments") renderAdjustmentPage();
}

if (page === "movement") setupMovementForm();
if (page === "category") setupDeleteDialog();
if (page === "payment-cycle") setupPaymentCycleActions();
if (page === "adjustments") setupAdjustmentPage();

onSnapshot(
  recordsRef,
  snapshot => {
    allRecords = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    movements = allRecords.filter(isFinancialMovement);
    paymentStateRecords = allRecords.filter(item => item.kind === "scheduled_payment_status");
    balanceAdjustmentRecords = allRecords.filter(item => item.kind === "balance_adjustment");

    if (connectionStatus) {
      connectionStatus.textContent = "Sincronizado";
      connectionStatus.className = "status-pill online" + (connectionStatus.classList.contains("compact") ? " compact" : "");
    }
    renderPage();
  },
  error => {
    console.error(error);
    if (connectionStatus) {
      connectionStatus.textContent = "Sin acceso";
      connectionStatus.className = "status-pill offline" + (connectionStatus.classList.contains("compact") ? " compact" : "");
    }
    renderPage();
  }
);

window.addEventListener("online", () => {
  if (!connectionStatus) return;
  connectionStatus.textContent = "Conectando…";
});

window.addEventListener("offline", () => {
  if (!connectionStatus) return;
  connectionStatus.textContent = "Sin internet";
  connectionStatus.className = "status-pill offline" + (connectionStatus.classList.contains("compact") ? " compact" : "");
});

function showAppUpdate(worker) {
  let banner = document.querySelector("#appUpdateBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "appUpdateBanner";
    banner.style.cssText = "position:fixed;left:12px;right:12px;bottom:102px;z-index:9999;max-width:560px;margin:auto;padding:14px 15px;border-radius:18px;background:#102119;color:#f3f7f4;box-shadow:0 18px 45px rgba(0,0,0,.4);border:1px solid rgba(196,236,213,.13);font-family:Inter,system-ui,sans-serif";
    banner.innerHTML = '<div style="display:flex;align-items:center;gap:12px"><div style="flex:1"><strong style="display:block;font-size:14px">Nueva versión disponible</strong><span style="display:block;margin-top:3px;font-size:11px;color:#8fa49a">Actualiza para cargar los cambios.</span></div><button id="appUpdateButton" type="button" style="border:0;border-radius:12px;padding:10px 13px;background:#2bd47d;color:#04110a;font-weight:800">Actualizar</button></div>';
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
      const registration = await navigator.serviceWorker.register("./service-worker.js?v=25", { updateViaCache: "none" });
      if (registration.waiting && navigator.serviceWorker.controller) showAppUpdate(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) showAppUpdate(worker);
        });
      });

      await registration.update();
    } catch (error) {
      console.error("No se pudo revisar actualizaciones:", error);
    }
  });
}
