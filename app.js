import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
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
  expense: "Gasto",
  card_purchase: "Compra con tarjeta",
  card_payment: "Pago de tarjeta"
};

let selectedType = "income";
let movements = [];
let pendingDeleteId = null;

const currentBalanceEl = document.querySelector("#currentBalance");
const cardBalanceEl = document.querySelector("#cardBalance");
const movementCountEl = document.querySelector("#movementCount");
const historyListEl = document.querySelector("#historyList");
const movementForm = document.querySelector("#movementForm");
const amountInput = document.querySelector("#amount");
const descriptionInput = document.querySelector("#description");
const dateInput = document.querySelector("#date");
const saveButton = document.querySelector("#saveButton");
const formMessage = document.querySelector("#formMessage");
const connectionStatus = document.querySelector("#connectionStatus");
const confirmDialog = document.querySelector("#confirmDialog");
const confirmDeleteButton = document.querySelector("#confirmDeleteButton");

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
  const digits = rawValue.replace(/[^0-9]/g, "");
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
          totals.card += amount;
          break;
        case "card_payment":
          totals.current -= amount;
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

function movementVisual(type) {
  switch (type) {
    case "income": return { symbol: "↓", className: "", amountClass: "positive", sign: "+" };
    case "expense": return { symbol: "↑", className: "negative", amountClass: "negative", sign: "−" };
    case "card_purchase": return { symbol: "💳", className: "card", amountClass: "negative", sign: "+" };
    case "card_payment": return { symbol: "✓", className: "card negative", amountClass: "negative", sign: "−" };
    default: return { symbol: "•", className: "", amountClass: "", sign: "" };
  }
}

function render() {
  const totals = calculateBalances(movements);
  currentBalanceEl.textContent = formatCurrency(totals.current);
  cardBalanceEl.textContent = formatCurrency(Math.max(0, totals.card));
  movementCountEl.textContent = String(movements.length);

  if (!movements.length) {
    historyListEl.innerHTML = '<p class="empty-state">Todavía no hay movimientos.</p>';
    return;
  }

  historyListEl.innerHTML = "";
  for (const movement of sortedMovements(movements)) {
    const visual = movementVisual(movement.type);
    const item = document.createElement("article");
    item.className = `history-item ${visual.className}`.trim();

    const icon = document.createElement("div");
    icon.className = "history-icon";
    icon.textContent = visual.symbol;

    const info = document.createElement("div");
    const description = document.createElement("p");
    description.className = "history-description";
    description.textContent = movement.description;
    const meta = document.createElement("p");
    meta.className = "history-meta";
    meta.textContent = `${typeLabels[movement.type] ?? "Movimiento"} · ${formatDate(movement.date)}`;
    info.append(description, meta);

    const amountBox = document.createElement("div");
    const amount = document.createElement("div");
    amount.className = `history-amount ${visual.amountClass}`.trim();
    amount.textContent = `${visual.sign}${formatCurrency(Number(movement.amount) || 0)}`;
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "Eliminar";
    deleteButton.dataset.id = movement.id;
    amountBox.append(amount, deleteButton);

    item.append(icon, info, amountBox);
    historyListEl.append(item);
  }
}

function showMessage(message, kind = "") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${kind}`.trim();
}

function setSaving(isSaving) {
  saveButton.disabled = isSaving;
  saveButton.textContent = isSaving ? "Guardando…" : "Guardar movimiento";
}

for (const button of document.querySelectorAll(".type-button")) {
  button.addEventListener("click", () => {
    selectedType = button.dataset.type;
    document.querySelectorAll(".type-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  });
}

movementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const amount = parseAmount(amountInput.value);
  const description = descriptionInput.value.trim();
  const date = dateInput.value;

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

  if (!date) {
    showMessage("Selecciona una fecha.", "error");
    dateInput.focus();
    return;
  }

  const totals = calculateBalances(movements);
  if (
  ((selectedType === "expense" || selectedType === "card_payment") &&
    amount > totals.current) ||
  (selectedType === "card_payment" &&
    amount > Math.max(0, totals.card))
) {
  showMessage("Saldo insuficiente", "error");
  return;
}
  }

  setSaving(true);
  try {
    await addDoc(movementsRef, {
      type: selectedType,
      amount,
      description,
      date,
      createdAt: serverTimestamp()
    });
    movementForm.reset();
    dateInput.value = todayAsLocalISO();
    amountInput.value = "";
    showMessage("Movimiento guardado.", "success");
  } catch (error) {
    console.error(error);
    showMessage("No se pudo guardar. Revisa la conexión o las reglas de Firebase.", "error");
  } finally {
    setSaving(false);
  }
});

historyListEl.addEventListener("click", (event) => {
  const button = event.target.closest(".delete-button");
  if (!button) return;
  pendingDeleteId = button.dataset.id;
  confirmDialog.showModal();
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
  (snapshot) => {
    movements = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    connectionStatus.textContent = "Sincronizado";
    connectionStatus.className = "status-pill online";
    render();
  },
  (error) => {
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(console.error));
}
