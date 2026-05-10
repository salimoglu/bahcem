// ===== TEMA SİSTEMİ =====
(function() {
  const THEME_KEY = "bahcem-theme";
  const themes = ["light", "dark", "blue"];

  function applyTheme(t) {
    if (!themes.includes(t)) t = "light";
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    document.querySelectorAll(".theme-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.t === t);
    });
  }

  // Sayfa yüklenince kayıtlı temayı hemen uygula
  const saved = localStorage.getItem(THEME_KEY) || "light";
  document.documentElement.setAttribute("data-theme", saved);

  // DOM hazır olunca buton olaylarını bağla
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".theme-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.t === saved);
      btn.addEventListener("click", () => applyTheme(btn.dataset.t));
    });
  });
})();


// =============================================
// BAHÇEM — Firebase Auth + Firestore Sürümü
// =============================================

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyBp2bOuZIdTNk6j6CtJ2jb5beyCXife8s4",
  authDomain: "bahcem-app-eceb9.firebaseapp.com",
  projectId: "bahcem-app-eceb9",
  storageBucket: "bahcem-app-eceb9.firebasestorage.app",
  messagingSenderId: "251572935217",
  appId: "1:251572935217:web:41ee9cf20136d6404cd310",
  measurementId: "G-72SMWE72RQ"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ===== DURUM =====
let currentUser = null;
let plants = [];
let unsubscribePlants = null;
let draft = null;
let searchHits = [];
let selectedTitle = null;
let selectedLang = "tr";
let detailPlantId = null;

// ===== EKRAN YÖNETİMİ =====
function showScreen(name) {
  document.getElementById("loading-screen").style.display = "none";
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app-screen").style.display = "none";
  if (name === "loading") document.getElementById("loading-screen").style.display = "flex";
  else if (name === "login") document.getElementById("login-screen").style.display = "flex";
  else if (name === "app") document.getElementById("app-screen").style.display = "block";
}

// ===== AUTH =====
document.getElementById("btn-google-login").addEventListener("click", async () => {
  const errEl = document.getElementById("login-error");
  errEl.textContent = "";
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user") {
      errEl.textContent = "Giriş başarısız: " + e.message;
    }
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  if (unsubscribePlants) { unsubscribePlants(); unsubscribePlants = null; }
  await auth.signOut();
});

auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    document.getElementById("user-name").textContent = user.displayName || user.email;
    const photo = document.getElementById("user-photo");
    if (user.photoURL) {
      photo.src = user.photoURL;
      photo.style.display = "block";
    } else {
      photo.style.display = "none";
    }
    showScreen("app");
    startListening();
    wireApp();
    registerSw();
  } else {
    currentUser = null;
    plants = [];
    if (unsubscribePlants) { unsubscribePlants(); unsubscribePlants = null; }
    showScreen("login");
  }
});

// ===== FIRESTORE — GERÇEK ZAMANLI DİNLEME =====
let appWired = false;

function startListening() {
  if (!currentUser) return;
  if (unsubscribePlants) unsubscribePlants();

  const col = db.collection("users").doc(currentUser.uid).collection("plants");
  unsubscribePlants = col.orderBy("createdAt", "desc").onSnapshot(snap => {
    plants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
  }, err => {
    console.error("Firestore dinleme hatası:", err);
    toast("Veri yüklenemedi");
  });
}

function plantsCol() {
  return db.collection("users").doc(currentUser.uid).collection("plants");
}

// ===== YARDIMCİ =====
function uid() {
  try { return crypto.randomUUID(); }
  catch (e) { return "p-" + Date.now() + "-" + Math.random().toString(16).slice(2); }
}

function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime();
}

function nextWaterTimestamp(p) {
  const base = p.lastWateredAt ? new Date(p.lastWateredAt).getTime() : new Date(p.createdAt).getTime();
  return base + Math.max(1, Number(p.wateringIntervalDays) || 7) * 86400000;
}

function waterStatus(p) {
  const next = nextWaterTimestamp(p);
  const today = startOfDay(Date.now());
  const diff = Math.round((startOfDay(next) - today) / 86400000);
  if (diff < 0) return { key: "late", label: Math.abs(diff) + " gün gecikti", diff };
  if (diff === 0) return { key: "today", label: "Bugün", diff };
  if (diff === 1) return { key: "soon", label: "Yarın", diff };
  return { key: "ok", label: diff + " gün sonra", diff };
}

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }); }
  catch (e) { return "—"; }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function escapeAttr(s) { return String(s).replace(/"/g,"&quot;"); }

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

// ===== WİKİPEDİ =====
async function wikiSearch(lang, q) {
  const url = "https://" + lang + ".wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
    encodeURIComponent(q) + "&format=json&srlimit=10&origin=*";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Arama başarısız");
  const data = await res.json();
  return ((data && data.query && data.query.search) || []).map(x => ({ title: x.title }));
}

async function wikiSummary(lang, title) {
  const url = "https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g,"_"));
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.type === "disambiguation" || data.type === "not_found") return null;
  const imageUrl = (data.originalimage && data.originalimage.source) || (data.thumbnail && data.thumbnail.source) || null;
  return {
    title: data.title || title, excerpt: data.extract || "", imageUrl,
    url: data.content_urls && data.content_urls.desktop ? data.content_urls.desktop.page : null
  };
}

// ===== LİSTE RENDER =====
function renderList() {
  const list = document.getElementById("plant-list");
  const empty = document.getElementById("empty-state");
  if (!list || !empty) return;

  if (!plants.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML = plants.map(p => {
    const st = waterStatus(p);
    const badgeClass = st.key === "late" ? "badge-late" : st.key === "ok" ? "badge-ok" : "badge-soon";
    const thumb = p.imageUrl
      ? `<img class="plant-thumb" src="${escapeAttr(p.imageUrl)}" alt="" loading="lazy" />`
      : `<div class="plant-thumb placeholder" aria-hidden="true">🌿</div>`;
    return `<article class="plant-card" data-id="${escapeAttr(p.id)}" role="button" tabindex="0">` +
      thumb +
      `<div class="plant-meta">` +
      `<h3>${escapeHtml(p.nick || p.wikiTitle)}</h3>` +
      `<p class="excerpt">${escapeHtml((p.excerpt || "").slice(0,220))}${(p.excerpt||"").length>220?"…":""}</p>` +
      `<div class="water-strip"><span class="badge ${badgeClass}">💧 ${escapeHtml(st.label)}</span>` +
      `<span>Son: ${fmtDate(p.lastWateredAt)}</span></div>` +
      `</div></article>`;
  }).join("");

  list.querySelectorAll(".plant-card").forEach(card => {
    card.addEventListener("click", () => openDetail(card.getAttribute("data-id")));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(card.getAttribute("data-id")); }
    });
  });
}

// ===== MODAL: BİTKİ EKLE =====
function openAdd() {
  draft = null; selectedTitle = null; searchHits = [];
  const q = document.getElementById("field-query");
  const nick = document.getElementById("field-nick");
  const intv = document.getElementById("field-interval");
  const prev = document.getElementById("field-preview");
  const sr = document.getElementById("search-results");
  if (q) q.value = "";
  if (nick) nick.value = "";
  if (intv) intv.value = "7";
  if (prev) prev.innerHTML = '<p class="muted">Önce bitki ara; bilgi kartı burada görünür.</p>';
  if (sr) { sr.innerHTML = ""; sr.classList.add("hidden"); }
  const m = document.getElementById("modal-add");
  if (m) { m.classList.add("show"); setTimeout(() => q && q.focus(), 120); }
}

function closeAdd() {
  document.getElementById("modal-add").classList.remove("show");
}

async function runSearch() {
  const qEl = document.getElementById("field-query");
  const prev = document.getElementById("field-preview");
  const sr = document.getElementById("search-results");
  const btn = document.getElementById("btn-fetch");
  const q = (qEl && qEl.value.trim()) || "";
  if (!q) { toast("Bitki adı yazın"); return; }
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Aranıyor…'; }
  draft = null; selectedTitle = null; searchHits = [];
  try {
    let hits = await wikiSearch("tr", q);
    selectedLang = "tr";
    if (!hits.length) { hits = await wikiSearch("en", q); selectedLang = "en"; }
    searchHits = hits;
    if (!hits.length) {
      if (prev) prev.innerHTML = "<p>Vikipedi'de sonuç bulunamadı.</p>";
      if (sr) sr.classList.add("hidden");
      return;
    }
    if (sr) {
      sr.innerHTML = hits.map((h, i) =>
        `<li data-idx="${i}" class="${i===0?"active":""}" role="option">${escapeHtml(h.title)}</li>`
      ).join("");
      sr.classList.remove("hidden");
      sr.querySelectorAll("li").forEach(li => {
        li.addEventListener("click", () => {
          sr.querySelectorAll("li").forEach(x => x.classList.remove("active"));
          li.classList.add("active");
          selectedTitle = hits[Number(li.getAttribute("data-idx"))].title;
          loadSummaryForSelected();
        });
      });
    }
    selectedTitle = hits[0].title;
    await loadSummaryForSelected();
  } catch (e) {
    console.error(e);
    if (prev) prev.innerHTML = "<p>İnternetten veri alınamadı.</p>";
    toast("Hata");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Vikipedi'den bilgi getir"; }
  }
}

async function loadSummaryForSelected() {
  const prev = document.getElementById("field-preview");
  const nick = document.getElementById("field-nick");
  if (!selectedTitle) return;
  if (prev) prev.innerHTML = '<p><span class="loader"></span> Özet yükleniyor…</p>';
  try {
    const sum = await wikiSummary(selectedLang, selectedTitle);
    if (!sum || !sum.excerpt) {
      draft = null;
      if (prev) prev.innerHTML = "<p>Bu başlık için özet çıkarılamadı.</p>";
      return;
    }
    draft = { lang: selectedLang, title: sum.title, excerpt: sum.excerpt, imageUrl: sum.imageUrl, url: sum.url };
    if (nick && !nick.value.trim()) nick.value = sum.title;
    const img = sum.imageUrl ? `<img src="${escapeAttr(sum.imageUrl)}" alt="" />` : "";
    if (prev) prev.innerHTML = img + "<p>" + escapeHtml(sum.excerpt) + "</p>";
  } catch (e) {
    console.error(e);
    draft = null;
    if (prev) prev.innerHTML = "<p>Özet alınamadı.</p>";
  }
}

async function saveNewPlant() {
  if (!draft) { toast("Önce bilgi getirin"); return; }
  if (!currentUser) { toast("Oturum açmanız gerekiyor"); return; }
  const nickEl = document.getElementById("field-nick");
  const intvEl = document.getElementById("field-interval");
  const nick = (nickEl && nickEl.value.trim()) || draft.title;
  const interval = Math.max(1, Math.min(90, Number(intvEl && intvEl.value) || 7));

  const p = {
    nick, wikiTitle: draft.title, wikiLang: draft.lang,
    excerpt: draft.excerpt, imageUrl: draft.imageUrl, url: draft.url,
    wateringIntervalDays: interval, lastWateredAt: null,
    createdAt: new Date().toISOString()
  };

  try {
    await plantsCol().add(p);
    closeAdd();
    toast("Bitki eklendi ✓");
  } catch (e) {
    console.error(e);
    toast("Kaydedilemedi: " + e.message);
  }
}

// ===== MODAL: DETAY =====
function openDetail(id) {
  detailPlantId = id;
  const p = plants.find(x => x.id === id);
  const m = document.getElementById("modal-detail");
  const body = document.getElementById("detail-content");
  if (!p || !m || !body) return;

  const st = waterStatus(p);
  const badgeClass = st.key === "late" ? "badge-late" : st.key === "ok" ? "badge-ok" : "badge-soon";
  const img = p.imageUrl ? `<p><img src="${escapeAttr(p.imageUrl)}" alt="" style="max-width:100%;border-radius:12px"/></p>` : "";
  const link = p.url ? `<p><a href="${escapeAttr(p.url)}" target="_blank" rel="noopener">Vikipedi'de aç</a></p>` : "";

  body.innerHTML =
    `<h3 style="margin:0 0 8px;font-size:1.2rem">${escapeHtml(p.nick || p.wikiTitle)}</h3>` +
    `<p class="badge ${badgeClass}" style="display:inline-flex;margin-bottom:12px">💧 ${escapeHtml(st.label)}</p>` +
    `<p style="margin:8px 0;font-size:.9rem;color:var(--muted)">Son sulama: <strong>${fmtDate(p.lastWateredAt)}</strong> · Aralık: <strong>${p.wateringIntervalDays}</strong> gün</p>` +
    img +
    `<div class="preview-box" style="max-height:none;margin-top:12px">${escapeHtml(p.excerpt || "Özet yok.")}</div>` +
    link +
    `<div style="margin-top:14px" class="field">` +
    `<label for="detail-interval-edit">Sulama aralığı (gün)</label>` +
    `<input type="number" id="detail-interval-edit" min="1" max="90" value="${p.wateringIntervalDays}" />` +
    `</div>` +
    `<div class="modal-actions">` +
    `<button type="button" class="btn btn-primary" id="btn-watered">Suladım ✓</button>` +
    `<button type="button" class="btn btn-secondary" id="btn-save-interval">Aralığı kaydet</button>` +
    `<button type="button" class="btn btn-danger" id="btn-delete-plant">Sil</button>` +
    `</div>`;

  document.getElementById("btn-watered").addEventListener("click", async () => {
    try {
      await plantsCol().doc(id).update({ lastWateredAt: new Date().toISOString() });
      toast("Sulama kaydedildi 💧");
      openDetail(id);
    } catch (e) { toast("Hata: " + e.message); }
  });

  document.getElementById("btn-save-interval").addEventListener("click", async () => {
    const el = document.getElementById("detail-interval-edit");
    const v = Math.max(1, Math.min(90, Number(el.value) || 7));
    try {
      await plantsCol().doc(id).update({ wateringIntervalDays: v });
      toast("Aralık güncellendi");
      openDetail(id);
    } catch (e) { toast("Hata: " + e.message); }
  });

  document.getElementById("btn-delete-plant").addEventListener("click", async () => {
    if (!confirm("Bu bitkiyi silmek istiyor musunuz?")) return;
    try {
      await plantsCol().doc(id).delete();
      m.classList.remove("show");
      toast("Silindi");
    } catch (e) { toast("Silinemedi: " + e.message); }
  });

  m.classList.add("show");
}

function closeDetail() {
  document.getElementById("modal-detail").classList.remove("show");
}

// ===== BAĞLANTI (bir kez çalışır) =====
function wireApp() {
  if (appWired) return;
  appWired = true;

  document.getElementById("btn-open-add").addEventListener("click", openAdd);
  const emp = document.getElementById("btn-open-add-empty");
  if (emp) emp.addEventListener("click", openAdd);
  document.getElementById("modal-add-close").addEventListener("click", closeAdd);
  document.getElementById("modal-detail-close").addEventListener("click", closeDetail);
  document.getElementById("btn-fetch").addEventListener("click", runSearch);
  document.getElementById("btn-save-plant").addEventListener("click", saveNewPlant);
  document.getElementById("modal-add").addEventListener("click", e => { if (e.target.id === "modal-add") closeAdd(); });
  document.getElementById("modal-detail").addEventListener("click", e => { if (e.target.id === "modal-detail") closeDetail(); });

  const qEl = document.getElementById("field-query");
  if (qEl) {
    qEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });
  }
}

// ===== SERVICE WORKER (PWA) =====
async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (w) w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) w.postMessage({ type: "SKIP_WAITING" });
      });
    });
  } catch (e) { console.warn("SW:", e); }
}
