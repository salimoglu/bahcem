// ===== TEMA SİSTEMİ =====
(function () {
  const KEY = "bahcem-theme";
  const themes = ["light", "dark", "blue"];
  function apply(t) {
    if (!themes.includes(t)) t = "light";
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(KEY, t);
    document.querySelectorAll(".theme-btn").forEach(b => b.classList.toggle("active", b.dataset.t === t));
  }
  const saved = localStorage.getItem(KEY) || "light";
  document.documentElement.setAttribute("data-theme", saved);
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".theme-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.t === saved);
      b.addEventListener("click", () => apply(b.dataset.t));
    });
  });
})();

// =============================================
// BAHÇEM — Bahçe + Bitki Sistemi
// =============================================

// Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBp2bOuZIdTNk6j6CtJ2jb5beyCXife8s4",
  authDomain: "bahcem-app-eceb9.firebaseapp.com",
  projectId: "bahcem-app-eceb9",
  storageBucket: "bahcem-app-eceb9.firebasestorage.app",
  messagingSenderId: "251572935217",
  appId: "1:251572935217:web:41ee9cf20136d6404cd310"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ===== DURUM =====
let currentUser      = null;
let gardens          = [];        // kullanıcının bahçeleri
let currentGardenId  = null;      // açık bahçe
let plants           = [];        // açık bahçedeki bitkiler
let unsubGardens     = null;
let unsubPlants      = null;
let appWired         = false;

// Bitki ekleme draft
let plantDraft       = null;      // { nameTr, nameLat, excerpt, imageUrl, light, waterDays, wikiUrl }
let plantInterval    = 7;

// ── Popüler bitki listesi (öneri kataloğu) ──
const POPULAR_PLANTS = [
  { q:"Monstera deliciosa", tr:"Monstera", emoji:"🌿" },
  { q:"Lavandula",          tr:"Lavanta",  emoji:"💜" },
  { q:"Cactaceae",          tr:"Kaktüs",   emoji:"🌵" },
  { q:"Ocimum basilicum",   tr:"Fesleğen", emoji:"🌱" },
  { q:"Orchidaceae",        tr:"Orkide",   emoji:"🌸" },
  { q:"Mentha",             tr:"Nane",     emoji:"🍃" },
  { q:"Aloe vera",          tr:"Aloe Vera",emoji:"🌵" },
  { q:"Helianthus annuus",  tr:"Ayçiçeği", emoji:"🌻" },
  { q:"Rosa",               tr:"Gül",      emoji:"🌹" },
  { q:"Ficus lyrata",       tr:"Keman Yaprağı",emoji:"🌳" },
  { q:"Olea europaea",      tr:"Zeytin",   emoji:"🫒" },
  { q:"Capsicum",           tr:"Biber",    emoji:"🌶️" },
  { q:"Fragaria",           tr:"Çilek",    emoji:"🍓" },
  { q:"Rosmarinus",         tr:"Biberiye", emoji:"🌿" },
  { q:"Citrus limon",       tr:"Limon",    emoji:"🍋" },
  { q:"Begonia",            tr:"Begonvil", emoji:"🌺" },
  { q:"Sansevieria",        tr:"Pasa Çiçeği",emoji:"🌿" },
  { q:"Pothos",             tr:"Pothos",   emoji:"🍀" },
  { q:"Ficus benjamina",    tr:"Benjamin", emoji:"🌳" },
  { q:"Spathiphyllum",      tr:"Barış Çiçeği",emoji:"🌼" },
];

// ===== YARDIMCILAR =====
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function escAttr(s) { return String(s).replace(/"/g,"&quot;"); }

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2400);
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); }

function waterStatus(p) {
  const base = p.lastWateredAt ? new Date(p.lastWateredAt).getTime() : new Date(p.createdAt).getTime();
  const next = base + Math.max(1, Number(p.wateringIntervalDays)||7) * 86400000;
  const diff = Math.round((startOfDay(next) - startOfDay(Date.now())) / 86400000);
  if (diff < 0) return { key:"late",  label: Math.abs(diff)+" gün gecikti" };
  if (diff === 0) return { key:"today", label: "Bugün sulanmalı" };
  if (diff === 1) return { key:"soon",  label: "Yarın sulanmalı" };
  return { key:"ok", label: diff+" gün sonra" };
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("tr-TR", { day:"numeric", month:"short", year:"numeric" });
}

// ===== EKRAN GEÇİŞİ =====
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
}

function showApp(name) {
  ["loading-screen","login-screen","app-screen"].forEach(id => {
    document.getElementById(id).style.display = "none";
  });
  document.getElementById(name).style.display = name === "app-screen" ? "block" : "flex";
}

// ===== FIRESTORE YOLLAR =====
function gardensCol() { return db.collection("users").doc(currentUser.uid).collection("gardens"); }
function plantsCol(gid) { return db.collection("users").doc(currentUser.uid).collection("gardens").doc(gid).collection("plants"); }

// ===== AUTH =====
document.getElementById("btn-google-login").addEventListener("click", async () => {
  const err = document.getElementById("login-error");
  err.textContent = "";
  try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
  catch (e) { if (e.code !== "auth/popup-closed-by-user") err.textContent = "Giriş başarısız: " + e.message; }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  if (unsubGardens) { unsubGardens(); unsubGardens = null; }
  if (unsubPlants)  { unsubPlants();  unsubPlants  = null; }
  await auth.signOut();
});

auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    const photo = document.getElementById("user-photo");
    document.getElementById("user-name").textContent = user.displayName || user.email;
    if (user.photoURL) { photo.src = user.photoURL; photo.style.display = "block"; }
    else photo.style.display = "none";
    showApp("app-screen");
    showScreen("screen-gardens");
    listenGardens();
    wireOnce();
    registerSw();
  } else {
    currentUser = null; gardens = []; plants = [];
    if (unsubGardens) { unsubGardens(); unsubGardens = null; }
    if (unsubPlants)  { unsubPlants();  unsubPlants  = null; }
    showApp("login-screen");
  }
});

// ===== BAHÇELER =====
function listenGardens() {
  if (unsubGardens) unsubGardens();
  unsubGardens = gardensCol().orderBy("createdAt","asc").onSnapshot(snap => {
    gardens = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGardens();
  });
}

function renderGardens() {
  const list  = document.getElementById("garden-list");
  const empty = document.getElementById("gardens-empty");
  if (!gardens.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.innerHTML = gardens.map(g => `
    <div class="garden-card" data-gid="${escAttr(g.id)}" role="button" tabindex="0">
      <div class="garden-card-icon">🌿</div>
      <div class="garden-card-body">
        <h3>${escHtml(g.name)}</h3>
        <p class="garden-card-sub">${g.plantCount||0} bitki</p>
      </div>
      <svg class="garden-card-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  `).join("");
  list.querySelectorAll(".garden-card").forEach(c => {
    c.addEventListener("click", () => openGarden(c.dataset.gid));
    c.addEventListener("keydown", e => { if (e.key==="Enter"||e.key===" ") openGarden(c.dataset.gid); });
  });
}

async function openGarden(gid) {
  currentGardenId = gid;
  const g = gardens.find(x => x.id === gid);
  document.getElementById("garden-title-display").textContent = g ? g.name : "";
  showScreen("screen-plants");
  listenPlants(gid);
}

// ===== BAHÇEYİ YENİDEN ADLANDIR =====
let gardenModalMode = "add"; // "add" | "rename"

function openGardenModal(mode) {
  gardenModalMode = mode;
  const m     = document.getElementById("modal-garden");
  const title = document.getElementById("modal-garden-title");
  const inp   = document.getElementById("field-garden-name");
  if (mode === "rename") {
    title.textContent = "Bahçe adını değiştir";
    const g = gardens.find(x => x.id === currentGardenId);
    inp.value = g ? g.name : "";
  } else {
    title.textContent = "Yeni bahçe";
    inp.value = "";
  }
  m.classList.add("show");
  setTimeout(() => inp.focus(), 100);
}

function closeGardenModal() { document.getElementById("modal-garden").classList.remove("show"); }

async function saveGarden() {
  const name = document.getElementById("field-garden-name").value.trim();
  if (!name) { toast("Bahçe adı boş olamaz"); return; }
  try {
    if (gardenModalMode === "rename" && currentGardenId) {
      await gardensCol().doc(currentGardenId).update({ name });
      document.getElementById("garden-title-display").textContent = name;
      toast("Ad güncellendi ✓");
    } else {
      const count = gardens.length + 1;
      const finalName = name || `${count}. Bahçem`;
      await gardensCol().add({ name: finalName, createdAt: new Date().toISOString(), plantCount: 0 });
      toast("Bahçe eklendi ✓");
    }
    closeGardenModal();
  } catch (e) { toast("Hata: " + e.message); }
}

// ===== BİTKİLER =====
function listenPlants(gid) {
  if (unsubPlants) { unsubPlants(); unsubPlants = null; }
  unsubPlants = plantsCol(gid).orderBy("createdAt","desc").onSnapshot(snap => {
    plants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlants();
    // Bahçe bitkisayısını güncelle
    gardensCol().doc(gid).update({ plantCount: plants.length }).catch(()=>{});
  });
}

function renderPlants() {
  const list  = document.getElementById("plant-list");
  const empty = document.getElementById("plants-empty");
  if (!plants.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.innerHTML = plants.map(p => {
    const st = waterStatus(p);
    const cls = st.key==="late"?"badge-late": st.key==="ok"?"badge-ok":"badge-soon";
    const thumb = p.imageUrl
      ? `<img class="plant-thumb" src="${escAttr(p.imageUrl)}" alt="" loading="lazy"/>`
      : `<div class="plant-thumb placeholder">${p.emoji||"🌿"}</div>`;
    const latin = p.nameLat ? `<span class="plant-latin">${escHtml(p.nameLat)}</span>` : "";
    const light = p.light ? `<span class="info-badge info-light">☀️ ${escHtml(p.light)}</span>` : "";
    return `<article class="plant-card" data-id="${escAttr(p.id)}" role="button" tabindex="0">
      ${thumb}
      <div class="plant-meta">
        <div class="plant-name-row">
          <h3>${escHtml(p.nameTr||p.nick||p.wikiTitle||"Bitki")}</h3>
          ${latin}
        </div>
        <p class="excerpt">${escHtml((p.excerpt||"").slice(0,160))}${(p.excerpt||"").length>160?"…":""}</p>
        <div class="water-strip">
          ${light}
          <span class="badge ${cls}">💧 ${escHtml(st.label)}</span>
        </div>
      </div>
    </article>`;
  }).join("");
  list.querySelectorAll(".plant-card").forEach(c => {
    c.addEventListener("click", () => openPlantDetail(c.dataset.id));
    c.addEventListener("keydown", e => { if (e.key==="Enter"||e.key===" ") openPlantDetail(c.dataset.id); });
  });
}

// ===== BİTKİ DETAY MODAL =====
function openPlantDetail(pid) {
  const p = plants.find(x => x.id === pid);
  if (!p) return;
  const st  = waterStatus(p);
  const cls = st.key==="late"?"badge-late": st.key==="ok"?"badge-ok":"badge-soon";
  const img = p.imageUrl ? `<img src="${escAttr(p.imageUrl)}" alt="" style="max-width:100%;border-radius:12px;margin-bottom:10px"/>` : "";
  const link = p.wikiUrl ? `<a href="${escAttr(p.wikiUrl)}" target="_blank" rel="noopener" style="font-size:.85rem">Vikipedi'de aç ↗</a>` : "";
  const latin = p.nameLat ? `<div style="font-size:.85rem;color:var(--muted);font-style:italic;margin-bottom:8px">${escHtml(p.nameLat)}</div>` : "";
  const light = p.light ? `<span class="info-badge info-light" style="margin-bottom:10px;display:inline-block">☀️ ${escHtml(p.light)}</span>` : "";

  document.getElementById("plant-detail-content").innerHTML = `
    ${img}
    <h3 style="margin:0 0 2px;font-size:1.2rem">${escHtml(p.nameTr||p.nick||"Bitki")}</h3>
    ${latin}
    ${light}
    <span class="badge ${cls}" style="margin-bottom:12px;display:inline-flex">💧 ${escHtml(st.label)}</span>
    <p style="font-size:.85rem;color:var(--muted);margin:4px 0 12px">Son sulama: <strong>${fmtDate(p.lastWateredAt)}</strong> · Aralık: <strong>${p.wateringIntervalDays||7}</strong> gün</p>
    <div class="preview-box" style="max-height:none;margin-bottom:12px">${escHtml(p.excerpt||"Bilgi yok.")}</div>
    ${link}
    <div class="field" style="margin-top:14px">
      <label for="detail-interval">Sulama aralığı (gün)</label>
      <input type="number" id="detail-interval" min="1" max="90" value="${p.wateringIntervalDays||7}" />
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="btn-detail-water">Suladım ✓</button>
      <button type="button" class="btn btn-secondary" id="btn-detail-save-interval">Aralığı kaydet</button>
      <button type="button" class="btn btn-danger" id="btn-detail-delete">Sil</button>
    </div>
  `;

  document.getElementById("btn-detail-water").onclick = async () => {
    await plantsCol(currentGardenId).doc(pid).update({ lastWateredAt: new Date().toISOString() });
    toast("Sulama kaydedildi 💧"); openPlantDetail(pid);
  };
  document.getElementById("btn-detail-save-interval").onclick = async () => {
    const v = Math.max(1, Math.min(90, Number(document.getElementById("detail-interval").value)||7));
    await plantsCol(currentGardenId).doc(pid).update({ wateringIntervalDays: v });
    toast("Aralık güncellendi ✓"); openPlantDetail(pid);
  };
  document.getElementById("btn-detail-delete").onclick = async () => {
    if (!confirm("Bu bitkiyi silmek istiyor musunuz?")) return;
    await plantsCol(currentGardenId).doc(pid).delete();
    document.getElementById("modal-plant-detail").classList.remove("show");
    toast("Silindi");
  };

  document.getElementById("modal-plant-detail").classList.add("show");
}

// ===== BİTKİ EKLEME MODAL =====
function openAddPlant() {
  plantDraft    = null;
  plantInterval = 7;
  document.getElementById("field-plant-search").value = "";
  document.getElementById("plant-search-results").innerHTML = "";
  document.getElementById("plant-search-results").classList.add("hidden");
  document.getElementById("plant-preview-card").classList.add("hidden");
  document.getElementById("plant-add-status").textContent = "";
  document.getElementById("btn-save-plant").disabled = true;
  document.getElementById("ppc-interval-val").textContent = "7";
  // Popüler bitkiler
  renderPopularPlants();
  document.getElementById("modal-add-plant").classList.add("show");
  setTimeout(() => document.getElementById("field-plant-search").focus(), 120);
}

function closeAddPlant() { document.getElementById("modal-add-plant").classList.remove("show"); }

function renderPopularPlants() {
  const grid = document.getElementById("plant-search-results");
  grid.innerHTML = POPULAR_PLANTS.map((p,i) =>
    `<button class="popular-plant-btn" data-idx="${i}" type="button">
      <span class="popular-emoji">${p.emoji}</span>
      <span class="popular-name">${escHtml(p.tr)}</span>
    </button>`
  ).join("");
  grid.classList.remove("hidden");
  grid.querySelectorAll(".popular-plant-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const pp = POPULAR_PLANTS[Number(btn.dataset.idx)];
      document.getElementById("field-plant-search").value = pp.tr;
      fetchPlantInfo(pp.q, pp.tr);
    });
  });
}

// Wiki'den bitki bilgisi çek
async function fetchPlantInfo(query, nameTrHint) {
  const status = document.getElementById("plant-add-status");
  status.innerHTML = '<span class="loader"></span> Bilgi getiriliyor…';
  document.getElementById("plant-preview-card").classList.add("hidden");
  document.getElementById("btn-save-plant").disabled = true;
  plantDraft = null;

  try {
    // Önce Türkçe dene
    let data = await wikiGetSummary("tr", query);
    if (!data || !data.extract) data = await wikiGetSummary("en", query);
    if (!data || !data.extract) throw new Error("Bilgi bulunamadı");

    // Latince adı bulmaya çalış (parantez içinde genellikle)
    let nameLat = "";
    const latMatch = data.extract.match(/\(([A-Z][a-z]+(?:\s+[a-z]+)+)\)/);
    if (latMatch) nameLat = latMatch[1];

    // Işık tahmini
    const ex = data.extract.toLowerCase();
    let light = "Yarı gölge";
    if (ex.includes("tam güneş")||ex.includes("güneşi sever")||ex.includes("güneşli")||ex.includes("full sun")) light = "Tam güneş";
    else if (ex.includes("gölge")||ex.includes("shade")||ex.includes("loş")) light = "Gölge";
    else if (ex.includes("parlak")||ex.includes("aydınlık")||ex.includes("indirect")) light = "Parlak dolaylı ışık";

    // Sulama tahmini
    let waterDays = 7;
    if (ex.includes("kaktüs")||ex.includes("sukulent")||ex.includes("cactus")||ex.includes("succulent")) waterDays = 14;
    else if (ex.includes("tropikal")||ex.includes("tropical")||ex.includes("nemli")) waterDays = 3;
    else if (ex.includes("orkide")||ex.includes("orchid")) waterDays = 5;

    const imageUrl = (data.originalimage && data.originalimage.source) ||
                     (data.thumbnail && data.thumbnail.source) || "";

    plantDraft = {
      nameTr:   nameTrHint || data.title,
      nameLat,
      excerpt:  data.extract.slice(0, 400),
      imageUrl,
      light,
      waterDays,
      wikiUrl: data.content_urls?.desktop?.page || ""
    };
    plantInterval = waterDays;

    // Kart göster
    document.getElementById("ppc-img").src = imageUrl;
    document.getElementById("ppc-img").style.display = imageUrl ? "block" : "none";
    document.getElementById("ppc-name-tr").textContent  = plantDraft.nameTr;
    document.getElementById("ppc-name-lat").textContent = nameLat || "";
    document.getElementById("ppc-excerpt").textContent  = plantDraft.excerpt;
    document.getElementById("ppc-light").textContent    = "☀️ " + light;
    document.getElementById("ppc-water-freq").textContent = "💧 Her " + waterDays + " günde bir";
    document.getElementById("ppc-interval-val").textContent = String(plantInterval);
    document.getElementById("plant-preview-card").classList.remove("hidden");
    document.getElementById("btn-save-plant").disabled = false;
    status.textContent = "";

  } catch (e) {
    status.textContent = "⚠️ " + (e.message || "Bilgi alınamadı, farklı bir isim deneyin.");
    plantDraft = null;
  }
}

async function wikiGetSummary(lang, title) {
  // Önce search, sonra summary
  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&format=json&srlimit=3&origin=*`;
  const sRes = await fetch(searchUrl);
  const sData = await sRes.json();
  const hits = (sData?.query?.search)||[];
  if (!hits.length) return null;

  const pageTitle = hits[0].title;
  const sumUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g,"_"))}`;
  const pRes = await fetch(sumUrl);
  if (!pRes.ok) return null;
  const p = await pRes.json();
  if (p.type === "disambiguation" || p.type === "not_found") return null;
  return p;
}

async function savePlant() {
  if (!plantDraft || !currentGardenId) return;
  const p = {
    nameTr:             plantDraft.nameTr,
    nameLat:            plantDraft.nameLat,
    excerpt:            plantDraft.excerpt,
    imageUrl:           plantDraft.imageUrl,
    light:              plantDraft.light,
    wateringIntervalDays: plantInterval,
    wikiUrl:            plantDraft.wikiUrl,
    lastWateredAt:      null,
    createdAt:          new Date().toISOString()
  };
  try {
    await plantsCol(currentGardenId).add(p);
    closeAddPlant();
    toast("Bitki eklendi 🌿");
  } catch (e) { toast("Hata: " + e.message); }
}

// ===== BAĞLANTI =====
function wireOnce() {
  if (appWired) return;
  appWired = true;

  // Geri butonu
  document.getElementById("btn-back").addEventListener("click", () => {
    if (unsubPlants) { unsubPlants(); unsubPlants = null; }
    showScreen("screen-gardens");
  });

  // Bahçe ekle
  document.getElementById("btn-add-garden").addEventListener("click",       () => openGardenModal("add"));
  document.getElementById("btn-add-garden-empty").addEventListener("click", () => openGardenModal("add"));
  document.getElementById("modal-garden-close").addEventListener("click",   closeGardenModal);
  document.getElementById("btn-save-garden").addEventListener("click",      saveGarden);
  document.getElementById("modal-garden").addEventListener("click", e => { if (e.target.id==="modal-garden") closeGardenModal(); });
  document.getElementById("field-garden-name").addEventListener("keydown", e => { if (e.key==="Enter") saveGarden(); });

  // Bahçe yeniden adlandır
  document.getElementById("btn-rename-garden").addEventListener("click", () => openGardenModal("rename"));

  // Bitki ekle
  document.getElementById("btn-add-plant").addEventListener("click",       openAddPlant);
  document.getElementById("btn-add-plant-empty").addEventListener("click", openAddPlant);
  document.getElementById("modal-plant-close").addEventListener("click",   closeAddPlant);
  document.getElementById("modal-add-plant").addEventListener("click", e => { if (e.target.id==="modal-add-plant") closeAddPlant(); });

  // Arama
  document.getElementById("btn-plant-search").addEventListener("click", () => {
    const q = document.getElementById("field-plant-search").value.trim();
    if (q) fetchPlantInfo(q, q);
  });
  document.getElementById("field-plant-search").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const q = document.getElementById("field-plant-search").value.trim();
      if (q) fetchPlantInfo(q, q);
    }
  });

  // Sulama aralığı +/-
  document.getElementById("ppc-step-down").addEventListener("click", () => {
    plantInterval = Math.max(1, plantInterval - 1);
    document.getElementById("ppc-interval-val").textContent = String(plantInterval);
  });
  document.getElementById("ppc-step-up").addEventListener("click", () => {
    plantInterval = Math.min(90, plantInterval + 1);
    document.getElementById("ppc-interval-val").textContent = String(plantInterval);
  });

  // Kaydet
  document.getElementById("btn-save-plant").addEventListener("click", savePlant);

  // Detay modal kapat
  document.getElementById("modal-detail-close").addEventListener("click", () => {
    document.getElementById("modal-plant-detail").classList.remove("show");
  });
  document.getElementById("modal-plant-detail").addEventListener("click", e => {
    if (e.target.id==="modal-plant-detail") document.getElementById("modal-plant-detail").classList.remove("show");
  });
}

// ===== SERVICE WORKER =====
async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  try { await navigator.serviceWorker.register("sw.js"); } catch(e) { console.warn("SW:", e); }
}
