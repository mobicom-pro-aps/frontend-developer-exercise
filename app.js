const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  route: "home",
  power: true,
  setpoint: 23,
  inside: 22,
  outside: 11,
  fan: 3,
  mode: "manual",
};

const pages = $$(".page");
const navLinks = $$(".bn-item");
const pageTitle = $("#pageTitle");
const leftBtn = $("#leftBtn");

const setpointEl = $("#setpoint");
const insideEl = $("#inside");
const outsideEl = $("#outside");
const knobEl = $("#knob");
const progressEl = $("#dialProgress");

const powerBtn = $("#powerBtn");
const fanBars = $("#fanBars");
const modeCards = $$(".mode-card");

// Route → title + left button (burger vs back)
function setRoute(route) {
  state.route = route;

  pages.forEach(p => p.classList.toggle("active", p.dataset.page === route));
  navLinks.forEach(a => a.classList.toggle("active", a.dataset.link === route));

  if (route === "home") {
    pageTitle.textContent = "Smart Home";
    leftBtn.textContent = "☰";
  } else if (route === "heat") {
    pageTitle.textContent = "Varme";
    leftBtn.textContent = "‹";
  } else {
    pageTitle.textContent = "Statistik";
    leftBtn.textContent = "‹";
  }

  $("#content").focus();
}

function getRouteFromHash() {
  const raw = (location.hash || "#/home").replace("#/", "");
  if (raw === "heat" || raw === "stats" || raw === "home") return raw;
  return "home";
}

// --- Thermostat dial math ---
// Halv-bue fra venstre til højre: vinkel 180° -> 0° (eller 210 -> -30 for “pænere”)
const MIN_T = 10;
const MAX_T = 30;
const START_DEG = 210;  // venstre lidt nede
const END_DEG = -30;    // højre lidt nede

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function lerp(a,b,t){ return a + (b-a)*t; }

function setDial(temp) {
  temp = clamp(temp, MIN_T, MAX_T);
  state.setpoint = temp;

  if (setpointEl) setpointEl.textContent = String(temp);

  // progress stroke (dashoffset)
  // vi bruger en “fake” længde (400), det ser fint ud for denne path
  const t = (temp - MIN_T) / (MAX_T - MIN_T);
  const dashTotal = 400;
  const offset = dashTotal * (1 - t);
  progressEl.style.strokeDasharray = String(dashTotal);
  progressEl.style.strokeDashoffset = String(offset);

  // knob position
  const deg = lerp(START_DEG, END_DEG, t);
  const rad = (deg * Math.PI) / 180;

  // koordinater på vores SVG-ish center (120,140) med radius ~100
  const cx = 120, cy = 140, r = 100;

  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);

  // dial-wrap er relativ: vi mapper SVG coords til % af container
  // dial svg viewBox 240x160 → knob x/y i den samme skala.
  const wrap = $("#dial");
  const rect = wrap.getBoundingClientRect();

  // X: 240 units → rect.width
  // Y: 160 units → 180px-ish område, men knob sidder pænt ved at mappe mod 180px højden.
  const px = (x / 240) * rect.width;
  const py = (y / 160) * 180; // dial svg højde

  knobEl.style.left = `${px}px`;
  knobEl.style.top = `${py}px`;
}

function render() {
  // temps
  if (insideEl) insideEl.textContent = String(state.inside);
  if (outsideEl) outsideEl.textContent = String(state.outside);

  // power
  if (powerBtn) {
    powerBtn.classList.toggle("off", !state.power);
    powerBtn.setAttribute("aria-pressed", state.power ? "true" : "false");
  }

  // fan
  if (fanBars) {
    const bars = $$("#fanBars .bar");
    bars.forEach((b, idx) => {
      const on = (idx + 1) <= state.fan;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  // mode
  modeCards.forEach(c => c.classList.toggle("active", c.dataset.mode === state.mode));

  setDial(state.setpoint);
}

// --- Dial drag (touch/mouse) ---
function handleDialPointer(e) {
  const wrap = $("#dial");
  const rect = wrap.getBoundingClientRect();

  // Brug pointer position -> beregn vinkel omkring center i dial-området
  const px = (e.clientX - rect.left);
  const py = (e.clientY - rect.top);

  // center i pixel for dial område (cirka)
  const cx = rect.width / 2;
  const cy = 180 * (140 / 160); // samme mapping som før

  const dx = px - cx;
  const dy = py - cy;

  let deg = Math.atan2(dy, dx) * (180 / Math.PI); // -180..180
  // Vi vil have område START_DEG..END_DEG (210..-30)
  // Normaliser til [ -180..180 ] allerede. Sørg for at “venstre side” håndteres
  // Lidt simpel clamp: begræns til [-30..210]
  deg = clamp(deg, END_DEG, START_DEG);

  // map deg -> temp
  const t = (deg - START_DEG) / (END_DEG - START_DEG); // 0..1
  const temp = Math.round(lerp(MIN_T, MAX_T, t));
  setDial(temp);
}

function bindEvents() {
  window.addEventListener("hashchange", () => setRoute(getRouteFromHash()));

  leftBtn.addEventListener("click", () => {
    if (state.route === "home") {
      // evt. åbne menu (valgfrit)
    } else {
      location.hash = "#/home";
    }
  });

  // power
  powerBtn?.addEventListener("click", () => {
    state.power = !state.power;
    render();
    // her kan du POST til API: setStatus({ power: state.power, ... })
  });

  // fan
  $$("#fanBars .bar").forEach((b) => {
    b.addEventListener("click", () => {
      state.fan = Number(b.dataset.fan);
      render();
      // POST fan
    });
  });

  // mode
  modeCards.forEach((c) => {
    c.addEventListener("click", () => {
      state.mode = c.dataset.mode;
      render();
      // POST mode
    });
  });

  // dial drag
  const dial = $("#dial");
  let dragging = false;

  dial?.addEventListener("pointerdown", (e) => {
    dragging = true;
    dial.setPointerCapture(e.pointerId);
    handleDialPointer(e);
  });

  dial?.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    handleDialPointer(e);
  });

  dial?.addEventListener("pointerup", () => { dragging = false; });
  dial?.addEventListener("pointercancel", () => { dragging = false; });
}

(function init(){
  if (!location.hash) location.hash = "#/home";
  setRoute(getRouteFromHash());
  bindEvents();
  render();
})();
