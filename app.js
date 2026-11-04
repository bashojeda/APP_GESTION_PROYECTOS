const STORAGE_KEY = "layer3d.workspace.v1";
const STORAGE_BUCKET = "project-files";
const CLOUD_CONFIGURED = Boolean(
  window.LAYER_SUPABASE_CONFIG?.url
  && window.LAYER_SUPABASE_CONFIG?.anonKey
  && !window.LAYER_SUPABASE_CONFIG.url.includes("YOUR_PROJECT_ID")
  && !window.LAYER_SUPABASE_CONFIG.anonKey.includes("YOUR_SUPABASE")
);
if (CLOUD_CONFIGURED) document.body.classList.add("cloud-auth-mode");
const statuses = {
  pending: "Pendiente",
  preparing: "Preparando archivos",
  queue: "En cola de impresión",
  printing: "Imprimiendo",
  postprocessing: "En postprocesado",
  painting: "Pintura y acabados",
  ready: "Listo para entregar",
  delivered: "Entregado",
  cancelled: "Cancelado"
};
const priorities = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };
const priorityWeight = { low: 1, normal: 2, high: 3, urgent: 4 };
const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const money = value => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
const dateOnly = value => value ? new Date(`${value}T12:00:00`) : null;
const todayISO = () => new Date().toISOString().slice(0, 10);
const dateLabel = value => {
  const date = dateOnly(value);
  return date ? `${date.getDate()} ${monthNames[date.getMonth()]}` : "Sin fecha";
};
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
let attachmentDBPromise;
let supabaseClient = null;
let cloudUser = null;
let signingUp = false;
let cloudSaveQueue = Promise.resolve();
let legacyImportPending = false;
let syncTimer;

function localStateKey() {
  return cloudUser ? `${STORAGE_KEY}.${cloudUser.id}` : STORAGE_KEY;
}

function normalizeState(value) {
  const defaults = createSeed();
  return {
    ...defaults,
    ...value,
    projects: Array.isArray(value.projects) ? value.projects : defaults.projects,
    materials: Array.isArray(value.materials) ? value.materials : defaults.materials,
    prints: Array.isArray(value.prints) ? value.prints : defaults.prints,
    activity: Array.isArray(value.activity) ? value.activity : defaults.activity
  };
}

function setSyncStatus(message, stateName = "idle") {
  const element = $("#syncStatus");
  if (!element) return;
  element.textContent = message;
  element.dataset.state = stateName;
  element.hidden = !cloudUser;
}

function showAuthScreen(message = "") {
  $("#authScreen").hidden = false;
  $("#authMessage").textContent = message;
}

function showCloudError(error, context) {
  console.error(context, error);
  setSyncStatus("Error de sincronización", "error");
  showToast(error?.message || "No se pudo sincronizar con Supabase.");
}

function attachmentDB() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("Este navegador no permite guardar archivos localmente."));
  if (!attachmentDBPromise) {
    attachmentDBPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("layer3d-attachments", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento de archivos."));
    });
  }
  return attachmentDBPromise;
}

async function saveAttachment(file, projectId) {
  if (cloudUser) {
    if (file.size > 50 * 1024 * 1024) throw new Error("Cada archivo debe pesar menos de 50 MB.");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "archivo";
    const path = `${cloudUser.id}/${projectId}/${uid()}_${safeName}`;
    const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });
    if (error) throw error;
    return { id: uid(), name: file.name, type: file.type || "application/octet-stream", size: file.size, storagePath: path };
  }
  const db = await attachmentDB();
  const attachment = { id: uid(), name: file.name, type: file.type || "application/octet-stream", size: file.size, blob: file };
  await new Promise((resolve, reject) => {
    const request = db.transaction("files", "readwrite").objectStore("files").put(attachment);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error || new Error("No se pudo guardar el archivo."));
  });
  return { id: attachment.id, name: attachment.name, type: attachment.type, size: attachment.size };
}
async function getAttachment(id) {
  const db = await attachmentDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction("files", "readonly").objectStore("files").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se pudo leer el archivo."));
  });
}

function createSeed() {
  const today = new Date();
  const addDays = days => {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const projects = [
    { id: "p1", name: "Casco Mandalorian", client: "Carlos Mendoza", phone: "55 1234 5678", category: "Cascos", status: "printing", priority: "high", dueDate: addDays(5), createdAt: addDays(-8), description: "Casco a escala real, acabado metálico satinado.", price: 3200, depositTarget: 1600, estimatedHours: 30, pieces: 4, notes: [{ text: "Archivos revisados y soportes optimizados.", date: addDays(-7) }], payments: [{ id: "pay1", amount: 1600, date: addDays(-7), note: "Anticipo" }], extraCosts: 120, labor: 300 },
    { id: "p2", name: "Set de accesorios sci-fi", client: "Valeria Ruiz", phone: "55 5555 1212", category: "Accesorios", status: "queue", priority: "low", dueDate: addDays(9), createdAt: addDays(-3), description: "Set de tres accesorios pequeños.", price: 950, depositTarget: 475, estimatedHours: 2, pieces: 3, notes: [], payments: [{ id: "pay2", amount: 475, date: addDays(-2), note: "Anticipo" }], extraCosts: 0, labor: 100 },
    { id: "p3", name: "Máscara Oni", client: "Diego Torres", phone: "", category: "Máscaras", status: "pending", priority: "normal", dueDate: addDays(7), createdAt: addDays(-2), description: "Máscara decorativa con acabado rojo y negro.", price: 1800, depositTarget: 900, estimatedHours: 8, pieces: 2, notes: [], payments: [], extraCosts: 0, labor: 180 },
    { id: "p4", name: "Soporte para cámara", client: "Estudio Norte", phone: "", category: "Piezas funcionales", status: "ready", priority: "normal", dueDate: addDays(1), createdAt: addDays(-10), description: "Pieza funcional reforzada en PETG.", price: 620, depositTarget: 310, estimatedHours: 4, pieces: 1, notes: [{ text: "Pieza probada y lista para entregar.", date: addDays(-1) }], payments: [{ id: "pay3", amount: 300, date: addDays(-8), note: "Anticipo" }], extraCosts: 30, labor: 90 },
    { id: "p5", name: "Figura dragón articulado", client: "Ana López", phone: "55 1010 9090", category: "Figuras", status: "delivered", priority: "normal", dueDate: addDays(-4), createdAt: addDays(-18), description: "Figura articulada de 25 cm.", price: 1250, depositTarget: 625, estimatedHours: 11, pieces: 1, notes: [], payments: [{ id: "pay4", amount: 625, date: addDays(-15), note: "Anticipo" }, { id: "pay5", amount: 625, date: addDays(-3), note: "Liquidación" }], extraCosts: 75, labor: 150 }
  ];
  return {
    projects,
    materials: [
      { id: "m1", type: "PLA", brand: "Polymaker", color: "Negro mate", initialWeight: 1000, remainingWeight: 680, price: 420, supplier: "Filamento MX", lowThreshold: 200 },
      { id: "m2", type: "PETG", brand: "eSUN", color: "Gris", initialWeight: 1000, remainingWeight: 390, price: 360, supplier: "Filamento MX", lowThreshold: 200 },
      { id: "m3", type: "PLA", brand: "Creality", color: "Plata", initialWeight: 1000, remainingWeight: 150, price: 310, supplier: "Maker Shop", lowThreshold: 200 }
    ],
    prints: [
      { id: "pr1", projectId: "p1", pieceName: "Sección frontal", materialId: "m1", weight: 180, estimatedHours: 10, actualHours: 10.4, result: "successful", date: addDays(-1), notes: "Impresión limpia." },
      { id: "pr2", projectId: "p5", pieceName: "Cuerpo articulado", materialId: "m2", weight: 220, estimatedHours: 11, actualHours: 12, result: "successful", date: addDays(-5), notes: "" }
    ],
    printerName: "Bambu Lab P1S",
    printerHoursPerDay: 20,
    activity: [
      { id: "a1", text: "La impresión de <strong>Sección frontal</strong> fue registrada", date: new Date(Date.now() - 3.6e6).toISOString(), color: "blue" },
      { id: "a2", text: "Se recibió un anticipo para <strong>Casco Mandalorian</strong>", date: new Date(Date.now() - 8.64e6).toISOString(), color: "purple" },
      { id: "a3", text: "<strong>Soporte para cámara</strong> está listo para entregar", date: new Date(Date.now() - 1.7e7).toISOString(), color: "orange" }
    ]
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(localStateKey()) || localStorage.getItem(STORAGE_KEY);
    if (!saved) return createSeed();
    const parsed = JSON.parse(saved);
    return normalizeState(parsed);
  } catch (error) {
    console.error("No se pudieron cargar los datos guardados.", error);
    return createSeed();
  }
}
let state = loadState();
let activeView = "dashboard";
let projectFilter = "all";
let projectSearch = "";
let toastTimer;

function saveState() {
  try {
    localStorage.setItem(localStateKey(), JSON.stringify(state));
  } catch (error) {
    console.error("No se pudieron guardar los cambios.", error);
    showToast("No se pudieron guardar los cambios. Revisa el espacio del navegador.");
    throw error;
  }
  if (cloudUser) queueCloudSave();
}

function queueCloudSave() {
  const userId = cloudUser.id;
  const snapshot = JSON.parse(JSON.stringify(state));
  clearTimeout(syncTimer);
  setSyncStatus("Guardado local · sincronizando…", "pending");
  cloudSaveQueue = cloudSaveQueue.catch(() => {}).then(async () => {
    if (!cloudUser || cloudUser.id !== userId) return;
    const { error } = await supabaseClient.from("workspace_state").upsert({
      user_id: userId,
      state: snapshot,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    if (error) throw error;
    if (legacyImportPending) {
      localStorage.removeItem(STORAGE_KEY);
      legacyImportPending = false;
    }
    setSyncStatus("Sincronizado", "synced");
    syncTimer = setTimeout(() => setSyncStatus("Nube conectada", "idle"), 3000);
  }).catch(error => showCloudError(error, "No se pudo guardar el espacio de trabajo en Supabase."));
}

async function migrateLegacyAttachments() {
  let migrated = false;
  for (const project of state.projects) {
    for (const attachment of project.attachments || []) {
      if (attachment.storagePath || !attachment.id) continue;
      try {
        const localFile = await getAttachment(attachment.id);
        if (!localFile?.blob) continue;
        const uploaded = await saveAttachment(localFile.blob, project.id);
        attachment.storagePath = uploaded.storagePath;
        attachment.type = uploaded.type;
        attachment.size = uploaded.size;
        migrated = true;
      } catch (error) {
        console.error(`No se pudo migrar el archivo ${attachment.name}.`, error);
        throw new Error(`No se pudo migrar el archivo "${attachment.name}". Revisa tu conexión e inténtalo de nuevo.`);
      }
    }
  }
  return migrated;
}

async function openWorkspace(session) {
  cloudUser = session.user;
  $("#authScreen").hidden = true;
  $("#signOutButton").hidden = false;
  $("#localModeBanner").hidden = true;
  setSyncStatus("Cargando nube…", "pending");
  try {
    const { data, error } = await supabaseClient.from("workspace_state")
      .select("state")
      .eq("user_id", cloudUser.id)
      .maybeSingle();
    if (error) throw error;
    if (data?.state) {
      state = normalizeState(data.state);
      legacyImportPending = false;
    } else {
      const userCache = localStorage.getItem(localStateKey());
      const legacyCache = localStorage.getItem(STORAGE_KEY);
      state = normalizeState(userCache || legacyCache ? JSON.parse(userCache || legacyCache) : createSeed());
      legacyImportPending = !userCache && Boolean(legacyCache);
    }
    const migratedAttachments = await migrateLegacyAttachments();
    localStorage.setItem(localStateKey(), JSON.stringify(state));
    if (data?.state) {
      setSyncStatus("Sincronizado", "synced");
      if (migratedAttachments) queueCloudSave();
    } else {
      queueCloudSave();
    }
    render();
    $("#user-profile-name").textContent = cloudUser.email || "Mi taller";
    $("#user-profile-label").textContent = "Sincronizado en la nube";
  } catch (error) {
    showCloudError(error, "No se pudo cargar el espacio de trabajo desde Supabase.");
    showAuthScreen(`No se pudieron cargar tus datos. ${error.message || "Verifica la tabla y las políticas de Supabase."}`);
    $("#signOutButton").hidden = false;
    $("#authSignOutButton").hidden = false;
  }
}

function setAuthMode(createAccount) {
  signingUp = createAccount;
  $("#authTitle").textContent = createAccount ? "Crea tu cuenta" : "Inicia sesión";
  $("#authSubmit").textContent = createAccount ? "Crear cuenta" : "Iniciar sesión";
  $("#authModeToggle").textContent = createAccount ? "¿Ya tienes cuenta? Iniciar sesión" : "¿Primera vez? Crear cuenta";
  $("#authPassword").autocomplete = createAccount ? "new-password" : "current-password";
  $("#authMessage").textContent = "";
}

async function initCloud() {
  const config = window.LAYER_SUPABASE_CONFIG;
  if (!CLOUD_CONFIGURED) {
    $("#localModeBanner").hidden = false;
    return;
  }
  if (!window.supabase?.createClient) {
    document.body.classList.add("cloud-auth-mode");
    showAuthScreen("No se pudo cargar el cliente de Supabase. Revisa tu conexión e inténtalo de nuevo.");
    return;
  }
  document.body.classList.add("cloud-auth-mode");
  $("#localModeBanner").hidden = true;
  supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  $("#authModeToggle").addEventListener("click", () => setAuthMode(!signingUp));
  $("#authSignOutButton").addEventListener("click", async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      $("#authMessage").textContent = error.message || "No se pudo cerrar la sesión.";
      return;
    }
    $("#authSignOutButton").hidden = true;
    setAuthMode(false);
    showAuthScreen();
  });
  $("#authForm").addEventListener("submit", async event => {
    event.preventDefault();
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    $("#authSubmit").disabled = true;
    $("#authMessage").textContent = signingUp ? "Creando cuenta…" : "Iniciando sesión…";
    try {
      if (signingUp) {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          await openWorkspace(data.session);
        } else {
          setAuthMode(false);
          $("#authMessage").textContent = "Cuenta creada. Revisa tu correo para confirmar la dirección y después inicia sesión.";
        }
      } else {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await openWorkspace(data.session);
      }
    } catch (error) {
      console.error("Error de autenticación con Supabase.", error);
      $("#authMessage").textContent = error.message || "No se pudo completar la autenticación.";
    } finally {
      $("#authSubmit").disabled = false;
    }
  });
  $("#signOutButton").addEventListener("click", async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) return showCloudError(error, "No se pudo cerrar la sesión de Supabase.");
    cloudUser = null;
    $("#signOutButton").hidden = true;
    setAuthMode(false);
    showAuthScreen();
  });
  $("#syncStatus").addEventListener("click", () => {
    if (cloudUser) queueCloudSave();
  });
  window.addEventListener("online", () => {
    if (cloudUser) queueCloudSave();
  });
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      cloudUser = null;
      $("#signOutButton").hidden = true;
      setAuthMode(false);
      showAuthScreen();
    }
  });
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    showAuthScreen(`No se pudo verificar la sesión. ${error.message}`);
    return;
  }
  if (data.session) await openWorkspace(data.session);
  else {
    $("#authSignOutButton").hidden = true;
    showAuthScreen();
  }
}
function logActivity(text, color = "blue") {
  state.activity.unshift({ id: uid(), text, date: new Date().toISOString(), color });
  state.activity = state.activity.slice(0, 30);
}
function projectById(id) { return state.projects.find(project => project.id === id); }
function materialById(id) { return state.materials.find(material => material.id === id); }
function paidAmount(project) { return (project.payments || []).reduce((total, payment) => total + Number(payment.amount || 0), 0); }
function projectMaterialCost(projectId) {
  return state.prints.filter(print => print.projectId === projectId).reduce((total, print) => {
    const material = materialById(print.materialId);
    return total + (material && material.initialWeight > 0 ? (Number(print.weight) || 0) * material.price / material.initialWeight : 0);
  }, 0);
}
function productionCost(project) {
  return projectMaterialCost(project.id) + Number(project.extraCosts || 0) + Number(project.labor || 0);
}
function balance(project) { return Math.max(0, Number(project.price || 0) - paidAmount(project)); }
function isActive(project) { return !["delivered", "cancelled"].includes(project.status); }
function isOverdue(project) {
  return isActive(project) && project.dueDate && project.dueDate < todayISO();
}
function statusPill(status) {
  const className = status === "printing" || status === "queue" ? status : status;
  return `<span class="status-pill status-${className}">${escapeHtml(statuses[status] || status)}</span>`;
}
function priorityPill(priority) { return `<span class="priority-pill priority-${priority}">${escapeHtml(priorities[priority] || "Normal")}</span>`; }
function relativeTime(value) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 3600000) return `hace ${Math.max(1, Math.floor(elapsed / 60000))} min`;
  if (elapsed < 86400000) return `hace ${Math.floor(elapsed / 3600000)} h`;
  return `hace ${Math.floor(elapsed / 86400000)} d`;
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
function setView(view) {
  activeView = view;
  $$(".nav-link[data-view]").forEach(link => link.classList.toggle("active", link.dataset.view === view));
  $("#pageTitle").textContent = ({ dashboard: "Dashboard", projects: "Proyectos", queue: "Cola de impresión", prints: "Impresiones", inventory: "Inventario", finances: "Finanzas", reports: "Reportes", settings: "Configuración" })[view];
  $("#sidebar").classList.remove("open");
  render();
}
function pageHeading(title, subtitle, actions = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function render() {
  $("#projectNavCount").textContent = state.projects.filter(isActive).length;
  const printing = state.projects.find(project => project.status === "printing");
  const queuedHours = state.projects.filter(project => ["queue", "printing"].includes(project.status)).reduce((sum, project) => sum + Number(project.estimatedHours || 0), 0);
  $("#printerName").textContent = escapeHtml(state.printerName || "Mi impresora");
  $("#printerAvailability").textContent = printing ? `Imprimiendo: ${printing.name}` : "Lista para trabajar";
  $("#printerProgress").style.width = printing ? "68%" : "0";
  $("#printerQueueText").textContent = queuedHours ? `${queuedHours} h de trabajo programado` : "Sin trabajos en cola";
  $("#alertDot").style.display = state.projects.some(isOverdue) || state.materials.some(material => material.remainingWeight <= material.lowThreshold) ? "block" : "none";
  const views = { dashboard: renderDashboard, projects: renderProjects, queue: renderQueue, prints: renderPrints, inventory: renderInventory, finances: renderFinances, reports: renderReports, settings: renderSettings };
  $("#pageContent").innerHTML = (views[activeView] || renderDashboard)();
  bindPageEvents();
}

function renderDashboard() {
  const active = state.projects.filter(isActive);
  const pending = active.filter(project => ["pending", "preparing", "queue"].includes(project.status)).length;
  const printing = active.filter(project => ["printing", "postprocessing", "painting"].includes(project.status)).length;
  const finished = state.projects.filter(project => ["ready", "delivered"].includes(project.status)).length;
  const overdue = active.filter(isOverdue).length;
  const revenue = state.projects.reduce((sum, project) => sum + paidAmount(project), 0);
  const outstanding = state.projects.filter(isActive).reduce((sum, project) => sum + balance(project), 0);
  const deposits = state.projects.reduce((sum, project) => sum + (project.payments || []).filter(payment => /anticipo/i.test(payment.note || "")).reduce((total, payment) => total + Number(payment.amount), 0), 0);
  const dueSoon = state.projects.filter(project => isActive(project) && project.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const activity = state.activity.slice(0, 5);
  const stat = (title, value, note, icon, tone = "") => `<article class="stat-card"><div class="stat-top"><span>${title}</span><span class="stat-icon">${icon}</span></div><div class="stat-value ${tone}">${value}</div><div class="stat-note">${note}</div></article>`;
  return `${pageHeading("Buenos días 👋", "Este es el resumen de actividad de tu taller.", `<button class="secondary-button" data-view="queue">Ver planificación ↗</button>`)}
    <div class="stats-grid">
      ${stat("Proyectos activos", active.length, "Encargos en curso", "▤")}
      ${stat("Pendientes de iniciar", pending, "Por preparar o imprimir", "◷")}
      ${stat("En producción", printing, "Imprimiendo y acabados", "▦", printing ? "positive" : "")}
      ${stat("Listos / entregados", finished, `${overdue} atrasado${overdue === 1 ? "" : "s"}`, "✓", overdue ? "warning" : "")}
      ${stat("Ingresos recibidos", money(revenue), "Pagos registrados", "$", "positive")}
      ${stat("Pendiente de cobro", money(outstanding), "Proyectos activos", "◴", outstanding ? "warning" : "")}
      ${stat("Anticipos recibidos", money(deposits), "Movimientos etiquetados como anticipo", "↙")}
      ${stat("Proyectos atrasados", overdue, "Requieren seguimiento", "!", overdue ? "danger" : "")}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-header"><div><h2>Actividad reciente</h2><p>Últimos movimientos de tu taller</p></div><button class="text-button" data-view="projects">Ver proyectos</button></div>
        <div class="activity-list">${activity.length ? activity.map(item => `<div class="activity-item"><span class="activity-mark ${escapeHtml(item.color)}"></span><div class="activity-copy">${item.text}</div><span class="activity-time">${relativeTime(item.date)}</span></div>`).join("") : `<div class="empty-state"><strong>Aún no hay actividad</strong>Los cambios aparecerán aquí.</div>`}</div>
      </section>
      <section class="panel"><div class="panel-header"><div><h2>Próximas entregas</h2><p>Fechas límite más cercanas</p></div><button class="text-button" data-view="projects">Ver todas</button></div>
        <div class="due-list">${dueSoon.length ? dueSoon.map(project => {
          const date = dateOnly(project.dueDate);
          const days = Math.ceil((date - dateOnly(todayISO())) / 86400000);
          return `<div class="due-item" data-open-project="${project.id}"><div class="due-date"><span>${monthNames[date.getMonth()]}</span><strong>${date.getDate()}</strong></div><div class="due-info"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.client || "Cliente sin nombre")}</span></div><span class="due-days ${days < 0 ? "late" : ""}">${days < 0 ? `${Math.abs(days)} d tarde` : days === 0 ? "Hoy" : `${days} días`}</span></div>`;
        }).join("") : `<div class="empty-state"><strong>Sin entregas programadas</strong>Agrega una fecha a tus proyectos.</div>`}</div>
      </section>
    </div>`;
}

function projectTable(projects) {
  if (!projects.length) return `<div class="empty-state"><strong>No hay proyectos que coincidan</strong>Prueba otra búsqueda o crea un proyecto nuevo.</div>`;
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Proyecto</th><th>Estado</th><th>Prioridad</th><th>Entrega</th><th>Pago pendiente</th><th></th></tr></thead><tbody>${projects.map(project => `<tr class="clickable-row" data-open-project="${project.id}">
    <td class="project-cell"><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.client || "Cliente sin nombre")} · ${escapeHtml(project.category || "Otros")}</small></td>
    <td>${statusPill(project.status)}</td><td>${priorityPill(project.priority)}</td>
    <td class="${isOverdue(project) ? "danger" : ""}">${dateLabel(project.dueDate)}${isOverdue(project) ? " · atrasado" : ""}</td>
    <td class="money">${money(balance(project))}</td><td><button class="queue-row-actions" data-open-project="${project.id}" aria-label="Abrir proyecto">↗</button></td>
  </tr>`).join("")}</tbody></table></div>`;
}
function renderProjects() {
  const filtered = state.projects.filter(project => {
    const matchesText = `${project.name} ${project.client} ${project.category}`.toLowerCase().includes(projectSearch.toLowerCase());
    const matchesFilter = projectFilter === "all" || (projectFilter === "overdue" ? isOverdue(project) : project.status === projectFilter);
    return matchesText && matchesFilter;
  }).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const filters = `<div class="filter-bar"><label class="search-box"><span>⌕</span><input id="projectSearch" type="search" placeholder="Buscar proyecto o cliente..." value="${escapeHtml(projectSearch)}"></label><select id="projectFilter"><option value="all">Todos los proyectos</option><option value="pending">Pendiente</option><option value="preparing">Preparando archivos</option><option value="queue">En cola</option><option value="printing">Imprimiendo</option><option value="postprocessing">En postprocesado</option><option value="painting">Pintura y acabados</option><option value="ready">Listo para entregar</option><option value="delivered">Entregado</option><option value="cancelled">Cancelado</option><option value="overdue">Atrasados</option></select></div>`;
  return `${pageHeading("Proyectos", `${state.projects.length} encargos registrados · ${state.projects.filter(isActive).length} activos`, `<button class="primary-button" data-action="new-project">＋ Nuevo proyecto</button>`)}
    ${filters}<section class="panel">${projectTable(filtered)}</section>`;
}

function getPlan() {
  const queue = state.projects.filter(project => ["pending", "preparing", "queue", "printing"].includes(project.status) && Number(project.estimatedHours) > 0);
  const now = new Date();
  const activePrint = queue.find(project => project.status === "printing");
  const scheduled = queue.filter(project => project.id !== activePrint?.id).map(project => {
    const daysLeft = project.dueDate ? Math.max(0, Math.ceil((dateOnly(project.dueDate) - dateOnly(todayISO())) / 86400000)) : 30;
    const hours = Number(project.estimatedHours) || 1;
    const urgency = project.dueDate ? Math.max(0, 10 - daysLeft) : 1;
    const priority = priorityWeight[project.priority] || 2;
    const quick = hours <= 4 ? 1.5 : hours <= 10 ? .75 : 0;
    const overdueBoost = isOverdue(project) ? 8 : 0;
    const score = priority * 2.2 + urgency + quick + overdueBoost;
    let reason = `Prioridad ${priorities[project.priority]?.toLowerCase() || "normal"}`;
    if (isOverdue(project)) reason = "Entrega atrasada";
    else if (daysLeft <= 2) reason = `Entrega en ${daysLeft} día${daysLeft === 1 ? "" : "s"}`;
    else if (hours <= 4) reason = "Trabajo corto: libera máquina rápido";
    else if (project.priority === "urgent" || project.priority === "high") reason = "Prioridad del cliente";
    else if (project.dueDate) reason = `Fecha límite: ${dateLabel(project.dueDate)}`;
    return { project, score, reason, hours };
  }).sort((a, b) => b.score - a.score || (a.project.dueDate || "9999").localeCompare(b.project.dueDate || "9999"));
  const plan = [];
  if (activePrint) plan.push({ project: activePrint, hours: Number(activePrint.estimatedHours), reason: "Impresión en curso", running: true });
  scheduled.forEach(item => plan.push({ ...item, running: false }));
  let time = new Date(now);
  return plan.map((item, index) => {
    const start = new Date(time);
    time = new Date(time.getTime() + item.hours * 3600000);
    return { ...item, index, start, end: new Date(time) };
  });
}
function renderQueue() {
  const plan = getPlan();
  const totalHours = plan.reduce((sum, item) => sum + item.hours, 0);
  const freeDays = state.printerHoursPerDay > 0 ? Math.ceil(totalHours / state.printerHoursPerDay) : 0;
  const first = plan.find(item => !item.running);
  let recommendation = "Agrega proyectos pendientes con horas estimadas para recibir una sugerencia de orden.";
  if (first) recommendation = `<strong>${escapeHtml(first.project.name)}</strong> es la siguiente recomendación. ${escapeHtml(first.reason)}. El orden equilibra prioridad del cliente, fecha límite y liberación temprana de la impresora; puedes cambiarlo en cualquier momento.`;
  const rows = plan.map(item => `<div class="queue-row"><span class="queue-rank">${item.running ? "▶" : String(item.index + 1).padStart(2, "0")}</span><div class="queue-project"><strong>${escapeHtml(item.project.name)}</strong><small>${escapeHtml(item.project.client || "Cliente sin nombre")} · ${escapeHtml(item.project.category || "Otros")}</small></div><div class="queue-meta">${item.hours} h estimadas<small>${item.project.pieces || 1} pieza${Number(item.project.pieces) === 1 ? "" : "s"} · ${priorities[item.project.priority] || "Normal"}</small></div><div class="queue-meta">${dateLabel(item.project.dueDate)}<small>Fecha de entrega</small></div><span class="queue-reason">${escapeHtml(item.reason)}</span><button class="queue-row-actions" data-open-project="${item.project.id}" aria-label="Abrir proyecto">↗</button></div>`).join("");
  return `${pageHeading("Cola de impresión", "Planifica el siguiente trabajo y conoce cuándo quedará libre la impresora.", `<button class="secondary-button" data-view="projects">Gestionar proyectos</button>`)}
    <div class="queue-summary"><div class="queue-summary-card"><span>Disponibilidad de impresora</span><strong>${plan.length ? dateTimeLabel(plan[plan.length - 1].end) : "Disponible ahora"}</strong><small>${plan.length ? `${totalHours.toFixed(1)} h programadas · ${freeDays} día${freeDays === 1 ? "" : "s"} aprox.` : "No hay trabajos en cola"}</small></div><div class="queue-summary-card"><span>Trabajos por planificar</span><strong>${plan.filter(item => !item.running).length}</strong><small>Proyectos con horas estimadas</small></div><div class="queue-summary-card"><span>Jornada disponible</span><strong>${state.printerHoursPerDay} h <small>/ día</small></strong><small>Configurable en ajustes</small></div></div>
    <div class="recommendation"><div class="recommend-icon">✦</div><div><h3>Sugerencia inteligente de planificación</h3><p>${recommendation}</p></div></div>
    <section class="panel"><div class="panel-header"><div><h2>Orden de impresión recomendado</h2><p>La recomendación es orientativa; tú mantienes el control.</p></div><span class="status-pill status-queue">${plan.length} trabajos</span></div><div class="queue-list" style="padding:13px">${rows || `<div class="empty-state"><strong>Tu cola está despejada</strong>Cuando registres proyectos con tiempo de impresión, aparecerá una propuesta.</div>`}</div></section>`;
}
function dateTimeLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Disponible ahora";
  return date.toLocaleString("es-MX", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function renderPrints() {
  const prints = [...state.prints].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const successful = prints.filter(print => print.result === "successful").length;
  const failed = prints.filter(print => print.result === "failed").length;
  const wasted = prints.filter(print => print.result === "failed").reduce((sum, print) => sum + Number(print.weight || 0), 0);
  return `${pageHeading("Impresiones", "Registro de trabajos, materiales consumidos y resultados.", `<button class="primary-button" data-action="new-print">＋ Registrar impresión</button>`)}
    <div class="queue-summary"><div class="queue-summary-card"><span>Trabajos registrados</span><strong>${prints.length}</strong><small>Todos los proyectos</small></div><div class="queue-summary-card"><span>Impresiones exitosas</span><strong class="positive">${successful}</strong><small>${prints.length ? Math.round(successful / prints.length * 100) : 0}% de éxito</small></div><div class="queue-summary-card"><span>Desperdicio por fallas</span><strong class="${wasted ? "warning" : ""}">${wasted.toFixed(0)} g</strong><small>${failed} impresión${failed === 1 ? "" : "es"} fallida${failed === 1 ? "" : "s"}</small></div></div>
    <section class="panel">${prints.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Pieza / proyecto</th><th>Material</th><th>Resultado</th><th>Tiempo real</th><th>Peso</th><th>Fecha</th></tr></thead><tbody>${prints.map(print => {
      const project = projectById(print.projectId);
      const material = materialById(print.materialId);
      const result = print.result === "successful" ? "Exitosa" : print.result === "failed" ? "Fallida" : "Cancelada";
      const resultClass = print.result === "successful" ? "positive" : print.result === "failed" ? "danger" : "";
      return `<tr><td class="project-cell"><strong>${escapeHtml(print.pieceName)}</strong><small>${escapeHtml(project?.name || "Proyecto eliminado")}</small></td><td>${material ? `${escapeHtml(material.type)} · ${escapeHtml(material.color)}` : "—"}</td><td><span class="result-pill ${resultClass}">${result}</span></td><td>${print.actualHours || print.estimatedHours || 0} h</td><td>${print.weight || 0} g</td><td>${dateLabel(print.date)}</td></tr>`;
    }).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>Aún no hay impresiones registradas</strong>Registra cada pieza para controlar el tiempo y consumo.</div>`}</section>`;
}

function renderInventory() {
  const low = state.materials.filter(material => Number(material.remainingWeight) <= Number(material.lowThreshold || 0));
  const cards = state.materials.map(material => {
    const percent = material.initialWeight > 0 ? Math.max(0, Math.min(100, material.remainingWeight / material.initialWeight * 100)) : 0;
    const isLow = material.remainingWeight <= material.lowThreshold;
    return `<article class="material-card ${isLow ? "low-stock" : ""}"><div class="material-top"><div><h3>${escapeHtml(material.type)} ${escapeHtml(material.color)}</h3><p>${escapeHtml(material.brand || "Sin marca")} · ${escapeHtml(material.supplier || "Sin proveedor")}</p></div><span class="material-swatch"></span></div><div class="material-weight"><span>Disponible</span><strong class="${isLow ? "warning" : ""}">${Number(material.remainingWeight).toFixed(0)} g</strong></div><div class="stock-bar"><span style="width:${percent}%"></span></div><div class="material-footer"><span>${percent.toFixed(0)}% del rollo</span><span>${isLow ? "⚠ Bajo inventario" : `${money(material.price)} / rollo`}</span></div></article>`;
  });
  return `${pageHeading("Inventario", "Controla filamentos y consumibles de tu taller.", `<button class="primary-button" data-action="new-material">＋ Agregar material</button>`)}
    ${low.length ? `<div class="recommendation" style="margin-bottom:14px"><div class="recommend-icon" style="color:var(--orange)">!</div><div><h3>Material por agotarse</h3><p>${low.map(material => `${escapeHtml(material.type)} ${escapeHtml(material.color)} (${material.remainingWeight} g)`).join(" · ")}. Considera reabastecer.</p></div></div>` : ""}
    ${cards.length ? `<div class="inventory-grid">${cards.join("")}</div>` : `<section class="panel"><div class="empty-state"><strong>Tu inventario está vacío</strong>Agrega materiales para descontarlos al registrar impresiones.</div></section>`}`;
}

function renderFinances() {
  const revenue = state.projects.reduce((sum, project) => sum + paidAmount(project), 0);
  const outstanding = state.projects.filter(isActive).reduce((sum, project) => sum + balance(project), 0);
  const totalCosts = state.projects.reduce((sum, project) => sum + productionCost(project), 0);
  const expectedProfit = state.projects.reduce((sum, project) => sum + Math.max(0, Number(project.price || 0) - productionCost(project)), 0);
  const projects = state.projects.filter(project => Number(project.price) > 0).sort((a, b) => balance(b) - balance(a));
  return `${pageHeading("Finanzas", "Ingresos, pagos pendientes y rentabilidad de tus encargos.", `<button class="primary-button" data-action="new-payment">＋ Registrar pago</button>`)}
    <div class="finance-hero"><div class="finance-card"><span>Ingresos recibidos</span><strong class="positive">${money(revenue)}</strong><small>Pagos registrados en tus proyectos</small></div><div class="finance-card"><span>Por cobrar</span><strong class="warning">${money(outstanding)}</strong><small>Saldo pendiente en proyectos activos</small></div><div class="finance-card"><span>Costos de producción</span><strong>${money(totalCosts)}</strong><small>Materiales + mano de obra + otros</small></div></div>
    <div class="queue-summary"><div class="queue-summary-card"><span>Ganancia estimada</span><strong class="positive">${money(expectedProfit)}</strong><small>Venta total menos costos registrados</small></div><div class="queue-summary-card"><span>Anticipos recomendados</span><strong>${money(state.projects.reduce((sum, project) => sum + Number(project.depositTarget || project.price * .5), 0))}</strong><small>50% del precio acordado</small></div><div class="queue-summary-card"><span>Pagos recibidos</span><strong>${state.projects.reduce((sum, project) => sum + (project.payments || []).length, 0)}</strong><small>Movimientos registrados</small></div></div>
    <section class="panel"><div class="panel-header"><div><h2>Estado financiero por proyecto</h2><p>El anticipo sugerido se calcula al 50% del precio.</p></div></div>${projects.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Proyecto</th><th>Venta</th><th>Anticipo sugerido</th><th>Pagado</th><th>Saldo</th><th>Ganancia est.</th></tr></thead><tbody>${projects.map(project => `<tr class="clickable-row" data-open-project="${project.id}"><td class="project-cell"><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.client || "Cliente sin nombre")}</small></td><td>${money(project.price)}</td><td>${money(project.depositTarget || project.price * .5)}</td><td class="positive">${money(paidAmount(project))}</td><td class="${balance(project) ? "warning" : ""}">${money(balance(project))}</td><td class="${Number(project.price) - productionCost(project) >= 0 ? "positive" : "danger"}">${money(Number(project.price) - productionCost(project))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>Sin datos financieros</strong>Agrega un precio acordado a tus proyectos.</div>`}</section>`;
}

function renderReports() {
  const months = [];
  const current = new Date();
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(current.getFullYear(), current.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const payments = state.projects.flatMap(project => project.payments || []).filter(payment => (payment.date || "").startsWith(key)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const profits = state.projects.flatMap(project => (project.payments || []).filter(payment => (payment.date || "").startsWith(key)).map(payment => Number(payment.amount || 0) - productionCost(project) / Math.max(1, (project.payments || []).length))).reduce((sum, value) => sum + value, 0);
    months.push({ name: monthNames[date.getMonth()], income: payments, profit: Math.max(0, profits) });
  }
  const max = Math.max(1, ...months.map(month => month.income));
  const bars = months.map(month => `<div class="chart-column" title="${month.name}: ${money(month.income)}"><span class="chart-bar" style="height:${Math.max(2, month.income / max * 95)}%"></span><span class="chart-bar profit-bar" style="height:${Math.max(2, month.profit / max * 95)}%"></span></div>`).join("");
  const totalHours = state.prints.reduce((sum, print) => sum + Number(print.actualHours || print.estimatedHours || 0), 0);
  const successful = state.prints.filter(print => print.result === "successful");
  const avg = successful.length ? successful.reduce((sum, print) => sum + Number(print.actualHours || print.estimatedHours || 0), 0) / successful.length : 0;
  const failed = state.prints.filter(print => print.result === "failed");
  const wasted = failed.reduce((sum, print) => sum + Number(print.weight || 0), 0);
  const materialCounts = {};
  state.prints.forEach(print => { if (print.materialId) materialCounts[print.materialId] = (materialCounts[print.materialId] || 0) + Number(print.weight || 0); });
  const mostUsedId = Object.keys(materialCounts).sort((a, b) => materialCounts[b] - materialCounts[a])[0];
  const mostUsed = materialById(mostUsedId);
  const completed = state.projects.filter(project => project.status === "delivered").length;
  const cancelled = state.projects.filter(project => project.status === "cancelled").length;
  const topProjects = state.projects.filter(project => Number(project.price) > 0).map(project => ({ project, profit: Number(project.price) - productionCost(project) })).sort((a, b) => b.profit - a.profit).slice(0, 3);
  return `${pageHeading("Reportes", "Una vista general del rendimiento de tu taller.", `<button class="secondary-button" id="exportData">Exportar datos ↗</button>`)}
    <div class="report-grid"><section class="panel chart-panel"><div class="panel-header"><div><h2>Ingresos y ganancias</h2><p>Movimientos de los últimos 6 meses · MXN</p></div></div><div class="chart">${bars}</div><div class="chart-labels">${months.map(month => `<span>${month.name}</span>`).join("")}</div><div class="chart-legend"><span><i class="legend-dot"></i>Ingresos</span><span><i class="legend-dot profit"></i>Ganancia estimada</span></div></section>
    <section class="panel"><div class="panel-header"><div><h2>Indicadores de producción</h2><p>Acumulado registrado</p></div></div><div class="report-metrics"><div class="report-metric"><span>Proyectos completados</span><strong>${completed}</strong></div><div class="report-metric"><span>Proyectos cancelados</span><strong>${cancelled}</strong></div><div class="report-metric"><span>Horas de impresión</span><strong>${totalHours.toFixed(1)} h</strong></div><div class="report-metric"><span>Tiempo promedio / trabajo</span><strong>${avg.toFixed(1)} h</strong></div><div class="report-metric"><span>Material más usado</span><strong>${mostUsed ? escapeHtml(mostUsed.type) : "—"}</strong></div><div class="report-metric"><span>Material desperdiciado</span><strong class="${wasted ? "warning" : ""}">${wasted} g</strong></div></div></section>
    <section class="panel" style="grid-column:1/-1"><div class="panel-header"><div><h2>Proyectos más rentables</h2><p>Precio de venta menos costos registrados</p></div></div>${topProjects.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Proyecto</th><th>Cliente</th><th>Venta</th><th>Costos</th><th>Ganancia</th><th>Margen</th></tr></thead><tbody>${topProjects.map(({ project, profit }) => `<tr><td>${escapeHtml(project.name)}</td><td>${escapeHtml(project.client || "—")}</td><td>${money(project.price)}</td><td>${money(productionCost(project))}</td><td class="positive">${money(profit)}</td><td>${project.price ? `${Math.round(profit / project.price * 100)}%` : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-inline">Agrega proyectos con precio para ver rentabilidad.</div>`}</section></div>`;
}

function renderSettings() {
  return `${pageHeading("Configuración", "Ajusta la planificación y gestiona tus datos.", "")}
    <div class="settings-grid"><section class="panel settings-panel"><h2>Impresora y planificación</h2><p>La disponibilidad estimada se calcula con las horas de trabajo por día configuradas.</p><label class="settings-field">Nombre de la impresora<input class="settings-input" id="settingPrinter" value="${escapeHtml(state.printerName || "")}"></label><label class="settings-field">Horas disponibles por día<input class="settings-input" id="settingHours" type="number" min="1" max="24" value="${Number(state.printerHoursPerDay) || 20}"></label><button class="primary-button" id="saveSettings">Guardar cambios</button></section>
    <section class="panel settings-panel"><h2>Datos del taller</h2><p>Los datos se guardan en este navegador. Exporta una copia de seguridad para conservarlos o moverlos a otro dispositivo.</p><button class="secondary-button" id="exportDataSettings">Descargar respaldo JSON</button></section>
    <section class="panel settings-panel danger-zone"><h2>Reiniciar espacio de trabajo</h2><p>Elimina los datos guardados en este navegador y restaura los datos de ejemplo. Esta acción no se puede deshacer.</p><button class="secondary-button" id="resetData">Restaurar datos de ejemplo</button></section></div>`;
}

function updateSelectOptions() {
  const projectOptions = state.projects.filter(project => !["delivered", "cancelled"].includes(project.status)).map(project => `<option value="${project.id}">${escapeHtml(project.name)} · ${escapeHtml(project.client || "Sin cliente")}</option>`).join("");
  $("#printProjectSelect").innerHTML = projectOptions || `<option value="">Primero crea un proyecto</option>`;
  $("#paymentProjectSelect").innerHTML = state.projects.filter(project => Number(project.price) > paidAmount(project)).map(project => `<option value="${project.id}">${escapeHtml(project.name)} · ${money(balance(project))} pendiente</option>`).join("") || `<option value="">No hay saldos pendientes</option>`;
  $("#printMaterialSelect").innerHTML = `<option value="">Sin asignar</option>` + state.materials.map(material => `<option value="${material.id}">${escapeHtml(material.type)} · ${escapeHtml(material.color)} (${material.remainingWeight} g)</option>`).join("");
}
function openDialog(id) {
  if (id === "printDialog" || id === "paymentDialog") updateSelectOptions();
  const dialog = $(`#${id}`);
  if (dialog && !dialog.open) dialog.showModal();
}
function bindPageEvents() {
  $$("[data-view]", $("#pageContent")).forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
  $$("[data-action]", $("#pageContent")).forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.action;
    openDialog(({ "new-project": "projectDialog", "new-print": "printDialog", "new-material": "inventoryDialog", "new-payment": "paymentDialog" })[action]);
  }));
  $$("[data-open-project]", $("#pageContent")).forEach(element => element.addEventListener("click", event => {
    event.stopPropagation();
    if (event.target.closest("button") && !event.target.closest("[data-open-project]")) return;
    openProjectDetail(element.dataset.openProject);
  }));
  const search = $("#projectSearch");
  if (search) search.addEventListener("input", () => { projectSearch = search.value; const position = search.selectionStart; render(); const newSearch = $("#projectSearch"); newSearch.focus(); newSearch.setSelectionRange(position, position); });
  const filter = $("#projectFilter");
  if (filter) { filter.value = projectFilter; filter.addEventListener("change", () => { projectFilter = filter.value; render(); }); }
  const exportButton = $("#exportData") || $("#exportDataSettings");
  if (exportButton) exportButton.addEventListener("click", exportBackup);
  const saveSettingsButton = $("#saveSettings");
  if (saveSettingsButton) saveSettingsButton.addEventListener("click", () => {
    const hours = Number($("#settingHours").value);
    if (!hours || hours < 1 || hours > 24) return showToast("Las horas disponibles deben estar entre 1 y 24.");
    state.printerName = $("#settingPrinter").value.trim() || "Mi impresora";
    state.printerHoursPerDay = hours;
    saveState(); render(); showToast("Configuración guardada.");
  });
  const reset = $("#resetData");
  if (reset) reset.addEventListener("click", () => {
    if (!confirm("¿Restaurar los datos de ejemplo? Se reemplazarán los datos guardados en este navegador.")) return;
    state = createSeed(); saveState(); render(); showToast("Espacio de trabajo restaurado.");
  });
}

function openProjectDetail(id) {
  const project = projectById(id);
  if (!project) return;
  const prints = state.prints.filter(print => print.projectId === id);
  const costs = productionCost(project);
  const paid = paidAmount(project);
  const margin = Number(project.price) ? Math.round((Number(project.price) - costs) / Number(project.price) * 100) : 0;
  const dialog = $("#detailDialog");
  dialog.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">${escapeHtml(project.category || "PROYECTO").toUpperCase()} · ${escapeHtml(project.client || "CLIENTE SIN NOMBRE").toUpperCase()}</span><h2>${escapeHtml(project.name)}</h2></div><button type="button" class="close-button" data-close="detailDialog" aria-label="Cerrar">×</button></div>
    <div class="detail-pairs"><div class="detail-pair"><span>Estado</span><strong>${statusPill(project.status)}</strong></div><div class="detail-pair"><span>Prioridad</span><strong>${priorityPill(project.priority)}</strong></div><div class="detail-pair"><span>Entrega estimada</span><strong class="${isOverdue(project) ? "danger" : ""}">${dateLabel(project.dueDate)}${isOverdue(project) ? " · Atrasado" : ""}</strong></div><div class="detail-pair"><span>Cliente / contacto</span><strong>${escapeHtml(project.client || "—")} ${project.phone ? `· ${escapeHtml(project.phone)}` : ""}</strong></div><div class="detail-pair"><span>Tiempo / piezas</span><strong>${Number(project.estimatedHours || 0)} h · ${Number(project.pieces || 1)} piezas</strong></div><div class="detail-pair"><span>Descripción</span><strong>${escapeHtml(project.description || "Sin descripción")}</strong></div></div>
    <div class="detail-section"><h3>Resumen financiero · MXN</h3><div class="detail-pairs"><div class="detail-pair"><span>Precio · anticipo sugerido (50%)</span><strong>${money(project.price)} · ${money(project.depositTarget || project.price * .5)}</strong></div><div class="detail-pair"><span>Pagado · saldo</span><strong class="positive">${money(paid)} · <span class="${balance(project) ? "warning" : "positive"}">${money(balance(project))}</span></strong></div><div class="detail-pair"><span>Costo de producción</span><strong>${money(costs)}</strong></div><div class="detail-pair"><span>Ganancia · margen estimado</span><strong class="${Number(project.price) - costs >= 0 ? "positive" : "danger"}">${money(Number(project.price) - costs)} · ${margin}%</strong></div></div><div class="detail-actions"><button class="secondary-button" data-detail-action="payment">＋ Registrar pago</button><button class="secondary-button" data-detail-action="costs">Editar otros costos</button></div></div>
    <div class="detail-section"><h3>Impresiones (${prints.length})</h3>${prints.length ? prints.map(print => `<div class="note-entry"><strong>${escapeHtml(print.pieceName)}</strong> · ${print.result === "successful" ? "Exitosa" : print.result === "failed" ? "Fallida" : "Cancelada"} · ${print.weight || 0} g · ${print.actualHours || print.estimatedHours || 0} h<small>${dateLabel(print.date)}${print.notes ? ` · ${escapeHtml(print.notes)}` : ""}</small></div>`).join("") : `<div class="empty-inline">Todavía no hay impresiones asociadas.</div>`}<div class="detail-actions"><button class="secondary-button" data-detail-action="print">＋ Registrar impresión</button></div></div>
    <div class="detail-section"><h3>Archivos y referencias (${(project.attachments || []).length})</h3>${(project.attachments || []).map(file => `<div class="note-entry"><button class="text-button" data-download-attachment="${file.id}">${escapeHtml(file.name)}</button><small>${(Number(file.size) / 1024 / 1024).toFixed(2)} MB · ${escapeHtml(file.type || "Archivo")}</small></div>`).join("") || `<div class="empty-inline">Fotos, referencias, STL, 3MF, OBJ y otros documentos.</div>`}<input id="projectFiles" type="file" multiple accept="image/*,.stl,.3mf,.obj,.pdf,.step,.stp,.gcode" hidden><div class="detail-actions"><button class="secondary-button" data-detail-action="attachments">＋ Adjuntar archivos</button></div></div>
    <div class="detail-section"><h3>Notas y seguimiento</h3>${(project.notes || []).map(note => `<div class="note-entry">${escapeHtml(note.text)}<small>${dateLabel(note.date)}</small></div>`).join("") || `<div class="empty-inline">Agrega avances, problemas o cambios del proyecto.</div>`}<div class="detail-actions"><button class="secondary-button" data-detail-action="note">＋ Agregar nota</button><button class="secondary-button" data-detail-action="duplicate">Duplicar proyecto</button></div></div>
    <div class="detail-actions"><select class="settings-input" id="detailStatus" style="width:auto;min-width:170px">${Object.entries(statuses).map(([key, label]) => `<option value="${key}" ${key === project.status ? "selected" : ""}>${label}</option>`).join("")}</select><button class="primary-button" data-detail-action="status">Actualizar estado</button><button type="button" class="secondary-button" data-close="detailDialog">Cerrar</button></div>`;
  dialog.showModal();
  $$("[data-close]", dialog).forEach(button => button.addEventListener("click", () => dialog.close()));
  $$("[data-download-attachment]", dialog).forEach(button => button.addEventListener("click", async () => {
    try {
      const attachment = (project.attachments || []).find(item => item.id === button.dataset.downloadAttachment);
      if (!attachment) throw new Error("No se encontró el archivo adjunto.");
      let blob;
      if (cloudUser && attachment.storagePath) {
        const { data, error } = await supabaseClient.storage.from(STORAGE_BUCKET).download(attachment.storagePath);
        if (error) throw error;
        blob = data;
      } else {
        const file = await getAttachment(attachment.id);
        if (!file) throw new Error("No se encontró el archivo guardado en este dispositivo.");
        blob = file.blob;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error("No se pudo abrir el archivo adjunto.", error);
      showToast(error.message || "No se pudo abrir el archivo.");
    }
  }));
  $("#projectFiles", dialog).addEventListener("change", async event => {
    const files = [...event.target.files];
    if (!files.length) return;
    try {
      project.attachments = project.attachments || [];
      for (const file of files) project.attachments.push(await saveAttachment(file, project.id));
      logActivity(`Se adjuntaron archivos a <strong>${escapeHtml(project.name)}</strong>`, "purple");
      saveState(); dialog.close(); render(); openProjectDetail(id); showToast("Archivos adjuntados al proyecto.");
    } catch (error) {
      console.error("No se pudieron guardar los archivos adjuntos.", error);
      showToast(error.message || "No se pudieron guardar los archivos.");
    }
  });
  $$("[data-detail-action]", dialog).forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.detailAction;
    if (action === "note") {
      const text = prompt("Escribe una nota de seguimiento:");
      if (!text?.trim()) return;
      project.notes = project.notes || [];
      project.notes.unshift({ text: text.trim(), date: todayISO() });
      logActivity(`Se agregó una nota a <strong>${escapeHtml(project.name)}</strong>`, "purple");
      saveState(); dialog.close(); render(); openProjectDetail(id);
    } else if (action === "costs") {
      const other = prompt("Otros costos del proyecto (MXN):", String(project.extraCosts || 0));
      if (other === null || !Number.isFinite(Number(other)) || Number(other) < 0) return showToast("Ingresa un monto válido.");
      const labor = prompt("Mano de obra (MXN):", String(project.labor || 0));
      if (labor === null || !Number.isFinite(Number(labor)) || Number(labor) < 0) return showToast("Ingresa un monto válido.");
      project.extraCosts = Number(other); project.labor = Number(labor);
      logActivity(`Se actualizaron los costos de <strong>${escapeHtml(project.name)}</strong>`, "orange");
      saveState(); dialog.close(); render(); openProjectDetail(id);
    } else if (action === "payment") {
      dialog.close(); updateSelectOptions(); $("#paymentProjectSelect").value = id; openDialog("paymentDialog");
    } else if (action === "print") {
      dialog.close(); updateSelectOptions(); $("#printProjectSelect").value = id; openDialog("printDialog");
    } else if (action === "attachments") {
      $("#projectFiles", dialog).click();
    } else if (action === "duplicate") {
      const copy = { ...project, id: uid(), name: `${project.name} (copia)`, status: "pending", createdAt: todayISO(), payments: [], notes: [], dueDate: "", depositTarget: Number(project.price || 0) * .5 };
      state.projects.unshift(copy); logActivity(`Se duplicó el proyecto <strong>${escapeHtml(project.name)}</strong>`, "blue");
      saveState(); dialog.close(); render(); showToast("Proyecto duplicado.");
    } else if (action === "status") {
      const next = $("#detailStatus").value;
      if (next === project.status) return showToast("El proyecto ya tiene ese estado.");
      const previous = statuses[project.status];
      project.status = next;
      logActivity(`<strong>${escapeHtml(project.name)}</strong> cambió de ${escapeHtml(previous)} a ${escapeHtml(statuses[next])}`, "orange");
      saveState(); dialog.close(); render(); showToast("Estado actualizado.");
    }
  }));
}

function bindGlobalEvents() {
  $$(".nav-link[data-view], .brand[data-view]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); setView(link.dataset.view); }));
  $("#quickAddProject").addEventListener("click", () => openDialog("projectDialog"));
  $("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $$("[data-close]").forEach(button => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));
  $("#projectForm").addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const price = Number(data.price) || 0;
    const project = { id: uid(), name: data.name.trim(), client: data.client.trim(), phone: data.phone.trim(), category: data.category, status: "pending", priority: data.priority, dueDate: data.dueDate, createdAt: todayISO(), description: data.description.trim(), price, depositTarget: price * .5, estimatedHours: Number(data.estimatedHours) || 0, pieces: Number(data.pieces) || 1, notes: [], payments: [], extraCosts: 0, labor: 0 };
    state.projects.unshift(project); logActivity(`Nuevo proyecto: <strong>${escapeHtml(project.name)}</strong>`, "blue");
    saveState(); event.currentTarget.reset(); $("#projectDialog").close(); setView("projects"); showToast("Proyecto creado.");
  });
  $("#printForm").addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const project = projectById(data.projectId);
    if (!project) return showToast("Selecciona un proyecto válido.");
    const weight = Number(data.weight) || 0;
    const material = materialById(data.materialId);
    if (material && weight > Number(material.remainingWeight)) return showToast(`Inventario insuficiente. Disponible: ${material.remainingWeight} g.`);
    const print = { id: uid(), projectId: project.id, pieceName: data.pieceName.trim(), materialId: data.materialId, weight, estimatedHours: Number(data.estimatedHours) || 0, actualHours: Number(data.actualHours) || 0, result: data.result, date: todayISO(), notes: data.notes.trim() };
    state.prints.unshift(print);
    if (material) material.remainingWeight = Math.max(0, Number(material.remainingWeight) - weight);
    if (data.result === "successful" && project.status === "queue") project.status = "printing";
    logActivity(`La impresión de <strong>${escapeHtml(print.pieceName)}</strong> fue registrada para ${escapeHtml(project.name)}`, data.result === "failed" ? "orange" : "blue");
    saveState(); event.currentTarget.reset(); $("#printDialog").close(); render(); showToast("Impresión registrada e inventario actualizado.");
  });
  $("#inventoryForm").addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const material = { id: uid(), type: data.type.trim(), brand: data.brand.trim(), color: data.color.trim(), initialWeight: Number(data.initialWeight) || 0, remainingWeight: data.remainingWeight === "" ? Number(data.initialWeight) || 0 : Number(data.remainingWeight), price: Number(data.price) || 0, supplier: data.supplier.trim(), lowThreshold: Number(data.lowThreshold) || 0 };
    if (material.remainingWeight > material.initialWeight) return showToast("El peso disponible no puede superar el peso inicial.");
    state.materials.unshift(material); logActivity(`Se agregó ${escapeHtml(material.type)} ${escapeHtml(material.color)} al inventario`, "purple");
    saveState(); event.currentTarget.reset(); $("#inventoryDialog").close(); render(); showToast("Material agregado al inventario.");
  });
  $("#paymentForm").addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const project = projectById(data.projectId);
    const amount = Number(data.amount);
    if (!project || !amount || amount <= 0) return showToast("Selecciona un proyecto e ingresa un monto válido.");
    if (amount > balance(project)) return showToast(`El pago supera el saldo pendiente de ${money(balance(project))}.`);
    project.payments = project.payments || [];
    project.payments.push({ id: uid(), amount, date: data.date || todayISO(), note: data.note.trim() || "Pago" });
    logActivity(`Se registró un pago de <strong>${money(amount)}</strong> para ${escapeHtml(project.name)}`, "purple");
    saveState(); event.currentTarget.reset(); $("#paymentDialog").close(); render(); showToast("Pago registrado.");
  });
  $("#paymentForm [name=date]").value = todayISO();
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `layer-respaldo-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Respaldo descargado.");
}

function init() {
  $("#todayLabel").textContent = new Date().toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  bindGlobalEvents();
  render();
  initCloud().catch(error => {
    showCloudError(error, "No se pudo inicializar Supabase.");
    if (CLOUD_CONFIGURED) showAuthScreen("No se pudo conectar con Supabase. Revisa la configuración y vuelve a cargar la página.");
  });
}
init();
