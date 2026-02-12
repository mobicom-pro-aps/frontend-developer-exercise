const BASE_URL = "https://exercise.mobicom-pro.com/docs#/Weather";

export const PATHS = {
  devices: "/devices",
  deviceById: (id) => `/devices/${encodeURIComponent(id)}`,
  weather: "/weather",
  statistics: "/statistics",
  token: "/token",
};

function getToken() {
  return localStorage.getItem("mobicom_token")?.trim() || "";
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseBody(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  const text = await res.text().catch(() => "");
  return text ? { message: text } : null;
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await parseBody(res);
    const msg = data?.error || data?.message || `${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return parseBody(res);
}

// --- AUTH ---
export async function fetchToken(body = {}) {
  const data = await api(PATHS.token, { method: "POST", body }); // { token }
  if (!data?.token) throw new Error("Token mangler i response");
  localStorage.setItem("mobicom_token", data.token);
  return data.token;
}

// --- DEVICES ---
export async function getDevices() {
  return api(PATHS.devices); // Device[]
}

export async function getDevice(id) {
  return api(PATHS.deviceById(id)); // Device
}

export async function putDeviceUpdate(id, update) {
  const payload = { ...update };

  if (payload.vent_level != null) {
    payload.vent_level = String(payload.vent_level);
  }

  return api(PATHS.deviceById(id), { method: "PUT", body: payload });
}

function setDialVisual(temp) {
  temp = clamp(temp, MIN_T, MAX_T);

  // progress
  const t = (temp - MIN_T) / (MAX_T - MIN_T);
  const dashTotal = 400;
  const offset = dashTotal * (1 - t);
  progressEl.style.strokeDasharray = String(dashTotal);
  progressEl.style.strokeDashoffset = String(offset);

  // knob position
  const deg = lerp(START_DEG, END_DEG, t);
  const rad = (deg * Math.PI) / 180;
  const cx = 120, cy = 140, r = 100;

  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);

  const rect = dialWrap.getBoundingClientRect();
  const px = (x / 240) * rect.width;
  const py = (y / 160) * 180;

  knobEl.style.left = `${px}px`;
  knobEl.style.top = `${py}px`;
}

function renderThermostat() {
  const d = state.device;
  if (!d) return;

  const target = Number(d.target_temp);
  const inside = Number(d.current_temp);

  setpointEl.textContent = String(Math.round(target));
  insideEl.textContent = String(Math.round(inside));
  if (state.outsideTemp != null) outsideEl.textContent = String(Math.round(state.outsideTemp));

  setDialVisual(target);

 // fan 0..6 (0 = off)
const vent = Number(d.vent_level ?? 0);

Array.from(fanBarsEl.querySelectorAll(".bar")).forEach((bar) => {
  const isActive = Number(bar.dataset.fan) <= vent && vent !== 0;
  bar.classList.toggle("active", isActive);
});

  // mode
  const mode = String(d.work_mode || "manual");
  if (mode !== "off") state.lastNonOffMode = mode;

  modeCards.forEach(card => {
    card.classList.toggle("active", card.dataset.mode === mode);
  });

  // power
  const isOff = mode === "off";
  powerBtn.classList.toggle("off", isOff);
  powerBtn.setAttribute("aria-pressed", (!isOff).toString());
}

async function loadDevice() {
  const d = await getDevice(state.deviceId);
  state.device = d;
  renderThermostat();
}

async function loadOutside() {
  //hvis weather path er korrekt:
  // const w = await api(PATHS.weather);
  // state.outsideTemp = w.temperature;
  // renderThermostat();

  // midlertidig fallback hvis du ikke har weather wired endnu
}

async function initDevice() {
  const devices = await getDevices();
  const living = devices.find(d => (d.name || "").toLowerCase().includes("stue"));
  const chosen = living || devices[0];
  if (!chosen) throw new Error("Ingen devices fundet");

  state.deviceId = chosen.id;
  await loadDevice();
  await loadOutside();
}

// --- Update helpers (PUT) ---
async function setVentLevel(level) {
  level = clamp(Number(level), 0, 6);
  await putDeviceUpdate(state.deviceId, { vent_level: level });
  await loadDevice();
}

async function setWorkMode(mode) {
  await putDeviceUpdate(state.deviceId, { work_mode: mode });
  await loadDevice();
}

let saveTempTimer = null;
async function setTargetTemp(temp) {
  temp = clamp(Number(temp), MIN_T, MAX_T);

  // Optimistic UI (hurtig følelse)
  state.device = { ...state.device, target_temp: temp };
  renderThermostat();

  // Debounce PUT så du ikke spammer API ved drag
  clearTimeout(saveTempTimer);
  saveTempTimer = setTimeout(async () => {
    await putDeviceUpdate(state.deviceId, { target_temp: temp });
    await loadDevice();
  }, 300);
}

// --- Fan bars build (0..6) ---
function buildFanBars() {
  fanBarsEl.innerHTML = "";

  const off = document.createElement("button");
  off.className = "bar";
  off.dataset.fan = "0";
  off.title = "0";
  off.addEventListener("click", () => setVentLevel(0));
  fanBarsEl.appendChild(off);

  for (let i = 1; i <= 6; i++) {
    const b = document.createElement("button");
    b.className = "bar";
    b.dataset.fan = String(i);
    b.title = String(i);
    b.addEventListener("click", () => setVentLevel(i));
    fanBarsEl.appendChild(b);
  }
}

// --- Mode buttons wiring ---
function wireMode() {
  // power-knap håndterer off.
  modeCards.forEach(card => {
    card.addEventListener("click", () => {
      const mode = card.dataset.mode; // manual/timed/boost
      setWorkMode(mode);
    });
  });

  powerBtn.addEventListener("click", async () => {
    const current = String(state.device?.work_mode || "manual");
    const next = current === "off" ? state.lastNonOffMode : "off";
    await setWorkMode(next);
  });
}

// --- Dial drag wiring ---
function wireDial() {
  if (!dialWrap) return;
  let dragging = false;

  function handlePointer(e) {
    const rect = dialWrap.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const cx = rect.width / 2;
    const cy = 180 * (140 / 160);

    const dx = px - cx;
    const dy = py - cy;

    let deg = Math.atan2(dy, dx) * (180 / Math.PI);
    deg = clamp(deg, END_DEG, START_DEG);

    const t = (deg - START_DEG) / (END_DEG - START_DEG);
    const temp = Math.round(lerp(MIN_T, MAX_T, t));
    setTargetTemp(temp);
  }

  dialWrap.addEventListener("pointerdown", (e) => {
    dragging = true;
    dialWrap.setPointerCapture(e.pointerId);
    handlePointer(e);
  });
  dialWrap.addEventListener("pointermove", (e) => dragging && handlePointer(e));
  dialWrap.addEventListener("pointerup", () => (dragging = false));
  dialWrap.addEventListener("pointercancel", () => (dragging = false));
}

// init
(async function init() {
  buildFanBars();
  wireMode();
  wireDial();
  await initDevice();
})();
