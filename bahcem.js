// ===== TEMA =====
(function () {
  const KEY = "bahcem-theme", themes = ["light","dark","blue"];
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
// BAHÇEM — Ana Uygulama
// =============================================
const firebaseConfig = {
  apiKey:"AIzaSyBp2bOuZIdTNk6j6CtJ2jb5beyCXife8s4",
  authDomain:"bahcem-app-eceb9.firebaseapp.com",
  projectId:"bahcem-app-eceb9",
  storageBucket:"bahcem-app-eceb9.firebasestorage.app",
  messagingSenderId:"251572935217",
  appId:"1:251572935217:web:41ee9cf20136d6404cd310"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

let currentUser = null, gardens = [], plants = [];
let currentGardenId = null;
let unsubGardens = null, unsubPlants = null;
let appWired = false;
let plantDraft = null, plantInterval = 7;
let searchTimeout = null;

// ─── YARDIMCILAR ───
const esc  = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const escA = s => String(s).replace(/"/g,"&quot;");

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2500);
}

function waterStatus(p) {
  // Hiç sulanmamışsa hemen uyar
  if (!p.lastWateredAt) return { key:"late", label:"Henüz sulanmadı", pct: 100 };
  const days = Math.max(1, Number(p.wateringIntervalDays) || 7);
  const base = new Date(p.lastWateredAt).getTime();
  const next = base + days * 86400000;
  const diff = Math.round((next - Date.now()) / 86400000);
  if (diff < 0)   return { key:"late",  label:`${Math.abs(diff)} gün gecikti`,  pct: 100 };
  if (diff === 0) return { key:"today", label:"Bugün sulanmalı",                pct: 100 };
  if (diff === 1) return { key:"soon",  label:"Yarın sulanmalı",                pct: Math.round((1/days)*100) };
  return                 { key:"ok",    label:`${diff} gün sonra`,              pct: Math.round(((days-diff)/days)*100) };
}

function fmtDate(iso) {
  if (!iso) return "Henüz sulanmadı";
  return new Date(iso).toLocaleDateString("tr-TR", { day:"numeric", month:"short", year:"numeric" });
}

// ─── EKRAN GEÇİŞİ ───
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => {
    s.classList.remove("hidden");
    s.classList.toggle("active", s.id === id);
  });
}
function showApp(name) {
  ["loading-screen","login-screen","app-screen"].forEach(id =>
    document.getElementById(id).style.display = "none"
  );
  document.getElementById(name).style.display = name === "app-screen" ? "block" : "flex";
}

// ─── FIRESTORE YOLLAR ───
const gardensCol = () => db.collection("users").doc(currentUser.uid).collection("gardens");
const plantsCol  = (gid) => db.collection("users").doc(currentUser.uid).collection("gardens").doc(gid).collection("plants");

// ─── AUTH ───
document.getElementById("btn-google-login").addEventListener("click", async () => {
  const err = document.getElementById("login-error");
  err.textContent = "";
  try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
  catch(e) { if (e.code !== "auth/popup-closed-by-user") err.textContent = "Giriş başarısız: " + e.message; }
});
document.getElementById("btn-logout").addEventListener("click", async () => {
  if (unsubGardens) { unsubGardens(); unsubGardens = null; }
  if (unsubPlants)  { unsubPlants();  unsubPlants  = null; }
  await auth.signOut();
});
auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    const ph = document.getElementById("user-photo");
    document.getElementById("user-name").textContent = user.displayName || user.email;
    if (user.photoURL) { ph.src = user.photoURL; ph.style.display = "block"; } else ph.style.display = "none";
    showApp("app-screen"); showScreen("screen-gardens");
    listenGardens(); wireOnce(); registerSw();
  } else {
    currentUser = null; gardens = []; plants = [];
    if (unsubGardens) { unsubGardens(); unsubGardens = null; }
    if (unsubPlants)  { unsubPlants();  unsubPlants  = null; }
    showApp("login-screen");
  }
});

// ─── BAHÇELER ───
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
  if (!gardens.length) { list.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  list.innerHTML = gardens.map(g => `
    <div class="garden-card" data-gid="${escA(g.id)}" role="button" tabindex="0">
      <div class="garden-card-icon">🌿</div>
      <div class="garden-card-body">
        <h3>${esc(g.name)}</h3>
        <div class="garden-card-stats">
          <span class="gc-stat">${g.plantCount||0} bitki</span>
          ${(g.plantCount||0) > 0 ? `
          <span class="gc-stat gc-ok">✓ ${g.okCount||0} tamam</span>
          ${(g.needWater||0) > 0 ? `<span class="gc-stat gc-warn">💧 ${g.needWater} sulama</span>` : ""}
          ` : ""}
        </div>
      </div>
      <svg class="garden-card-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`).join("");
  list.querySelectorAll(".garden-card").forEach(c => {
    c.addEventListener("click", () => openGarden(c.dataset.gid));
    c.addEventListener("keydown", e => { if (e.key==="Enter"||e.key===" ") openGarden(c.dataset.gid); });
  });
}

function openGarden(gid) {
  currentGardenId = gid;
  const g = gardens.find(x => x.id === gid);
  document.getElementById("garden-title-display").textContent = g ? g.name : "";
  showScreen("screen-plants");
  listenPlants(gid);
}

// ─── BAHÇE MODAL ───
let gardenModalMode = "add";
function openGardenModal(mode) {
  gardenModalMode = mode;
  const inp = document.getElementById("field-garden-name");
  document.getElementById("modal-garden-title").textContent = mode === "rename" ? "Bahçe adını değiştir" : "Yeni bahçe";
  if (mode === "rename") { const g = gardens.find(x => x.id === currentGardenId); inp.value = g ? g.name : ""; }
  else inp.value = "";
  document.getElementById("modal-garden").classList.add("show");
  setTimeout(() => inp.focus(), 100);
}
function closeGardenModal() { document.getElementById("modal-garden").classList.remove("show"); }
async function saveGarden() {
  const inp = document.getElementById("field-garden-name");
  let name = inp.value.trim();
  if (!name) {
    const count = gardens.length + 1;
    name = `${count}. Bahçem`;
  }
  try {
    if (gardenModalMode === "rename" && currentGardenId) {
      await gardensCol().doc(currentGardenId).update({ name });
      document.getElementById("garden-title-display").textContent = name;
      toast("Ad güncellendi ✓");
    } else {
      await gardensCol().add({ name, createdAt: new Date().toISOString(), plantCount: 0 });
      toast("Bahçe eklendi ✓");
    }
    closeGardenModal();
  } catch(e) { toast("Hata: " + e.message); }
}

// ─── BİTKİLER ───
function listenPlants(gid) {
  if (unsubPlants) { unsubPlants(); unsubPlants = null; }
  unsubPlants = plantsCol(gid).orderBy("createdAt","desc").onSnapshot(snap => {
    plants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlants();
    // Sulama istatistiklerini Firestore'a kaydet (bahçe kartında göstermek için)
    const total   = plants.length;
    const needWater = plants.filter(p => waterStatus(p).key !== "ok").length;
    const okCount   = total - needWater;
    gardensCol().doc(gid).update({ plantCount: total, needWater, okCount }).catch(()=>{});
  });
}

function renderPlants() {
  const list  = document.getElementById("plant-list");
  const empty = document.getElementById("plants-empty");
  if (!plants.length) { list.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  list.innerHTML = plants.map(p => {
    const st = waterStatus(p);
    const borderCls = st.key === "ok" ? "card-ok" : "card-warn";
    const badgeCls  = st.key === "late" ? "badge-late" : st.key === "ok" ? "badge-ok" : "badge-soon";
    const thumb = p.imageUrl
      ? `<img class="plant-thumb" src="${escA(p.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display='flex'"/><div class="plant-thumb placeholder" style="display:none">${esc(p.emoji||"🌿")}</div>`
      : `<div class="plant-thumb placeholder">${esc(p.emoji||"🌿")}</div>`;
    const latin = p.nameLat ? `<span class="plant-latin">${esc(p.nameLat)}</span>` : "";
    const light = p.light   ? `<span class="info-badge info-light">${esc(p.light)}</span>` : "";
    return `
      <article class="plant-card ${borderCls}" data-id="${escA(p.id)}" role="button" tabindex="0">
        <div class="plant-card-img">${thumb}</div>
        <div class="plant-meta">
          <h3>${esc(p.nameTr||"Bitki")}</h3>
          ${latin}
          ${light}
          <span class="badge ${badgeCls}">💧 ${esc(st.label)}</span>
        </div>
      </article>`;
  }).join("");

  list.querySelectorAll(".plant-card").forEach(c => {
    c.addEventListener("click", () => openPlantDetail(c.dataset.id));
    c.addEventListener("keydown", e => { if (e.key==="Enter"||e.key===" ") openPlantDetail(c.dataset.id); });
  });
}

// ─── BİTKİ DETAY ───
function openPlantDetail(pid) {
  const p = plants.find(x => x.id === pid);
  if (!p) return;
  const st  = waterStatus(p);
  const cls = st.key==="late"?"badge-late": st.key==="ok"?"badge-ok":"badge-soon";
  const img = p.imageUrl ? `<img src="${escA(p.imageUrl)}" alt="" style="width:100%;height:180px;object-fit:cover;border-radius:12px;margin-bottom:12px" onerror="this.style.display='none'"/>` : "";
  const link = p.wikiUrl ? `<a href="${escA(p.wikiUrl)}" target="_blank" rel="noopener" style="font-size:.85rem">Vikipedi'de aç ↗</a>` : "";

  document.getElementById("plant-detail-content").innerHTML = `
    ${img}
    <h3 style="margin:0 0 2px;font-size:1.15rem">${esc(p.nameTr||"Bitki")}</h3>
    ${p.nameLat ? `<div style="font-size:.8rem;color:var(--muted);font-style:italic;margin-bottom:8px">${esc(p.nameLat)}</div>` : ""}
    ${p.light   ? `<span class="info-badge info-light" style="margin-bottom:10px;display:inline-block">${esc(p.light)}</span>` : ""}
    <br>
    <span class="badge ${cls}" style="margin-bottom:10px;display:inline-flex">💧 ${esc(st.label)}</span>
    <p style="font-size:.82rem;color:var(--muted);margin:0 0 10px">
      Son sulama: <strong>${fmtDate(p.lastWateredAt)}</strong>
    </p>
    ${p.care ? `<div class="preview-box" style="margin-bottom:10px;max-height:none">${esc(p.care)}</div>` : ""}
    ${p.excerpt && p.excerpt !== p.care ? `<div class="preview-box" style="margin-bottom:10px;max-height:120px">${esc(p.excerpt)}</div>` : ""}
    ${link}
    <div class="field" style="margin-top:14px">
      <label for="detail-interval">Sulama aralığı (gün)</label>
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
        <button type="button" class="ppc-step" id="det-step-down">−</button>
        <span id="det-interval-val" style="font-size:1.1rem;font-weight:800;min-width:28px;text-align:center;color:var(--accent-dark)">${p.wateringIntervalDays||7}</span>
        <span style="font-size:.8rem;color:var(--muted)">gün</span>
        <button type="button" class="ppc-step" id="det-step-up">+</button>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary"   id="btn-det-water">💧 Suladım</button>
      <button type="button" class="btn btn-secondary" id="btn-det-save">Aralığı kaydet</button>
      <button type="button" class="btn btn-danger"    id="btn-det-del">Sil</button>
    </div>
    ${(p.wateringHistory&&p.wateringHistory.length) ? `
    <div class="water-history">
      <div class="water-history-title">💧 Sulama Geçmişi</div>
      <div class="water-history-list">
        ${[...p.wateringHistory].reverse().slice(0,10).map((iso,i) => {
          const d = new Date(iso);
          const dateStr = d.toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric"});
          const timeStr = d.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"});
          return `<div class="water-history-row ${i===0?"wh-latest":""}">
            <span class="wh-dot"></span>
            <span class="wh-date">${dateStr}</span>
            <span class="wh-time">${timeStr}</span>
          </div>`;
        }).join("")}
        ${p.wateringHistory.length > 10 ? `<div class="wh-more">+ ${p.wateringHistory.length-10} daha…</div>` : ""}
      </div>
    </div>` : ""}
  `;

  let detInterval = p.wateringIntervalDays || 7;
  document.getElementById("det-step-down").onclick = () => {
    detInterval = Math.max(1, detInterval - 1);
    document.getElementById("det-interval-val").textContent = detInterval;
  };
  document.getElementById("det-step-up").onclick = () => {
    detInterval = Math.min(90, detInterval + 1);
    document.getElementById("det-interval-val").textContent = detInterval;
  };
  document.getElementById("btn-det-water").onclick = async () => {
    const now = new Date().toISOString();
    const history = [...(p.wateringHistory||[]), now];
    if (history.length > 30) history.splice(0, history.length - 30); // son 30 kayıt
    await plantsCol(currentGardenId).doc(pid).update({ lastWateredAt: now, wateringHistory: history });
    // local güncelle (modal yeniden açılacak)
    p.lastWateredAt = now; p.wateringHistory = history;
    toast("Sulama kaydedildi 💧"); openPlantDetail(pid);
  };
  document.getElementById("btn-det-save").onclick = async () => {
    await plantsCol(currentGardenId).doc(pid).update({ wateringIntervalDays: detInterval });
    toast("Aralık güncellendi ✓"); openPlantDetail(pid);
  };
  document.getElementById("btn-det-del").onclick = async () => {
    if (!confirm("Bu bitkiyi silmek istiyor musunuz?")) return;
    await plantsCol(currentGardenId).doc(pid).delete();
    document.getElementById("modal-plant-detail").classList.remove("show"); toast("Silindi");
  };
  document.getElementById("modal-plant-detail").classList.add("show");
}

// ─── BİTKİ EKLEME ───
function openAddPlant() {
  plantDraft = null; plantInterval = 7; activeCat = "all";
  document.getElementById("field-plant-search").value = "";
  document.getElementById("plant-add-status").textContent = "";
  document.getElementById("plant-preview-card").classList.add("hidden");
  document.getElementById("btn-save-plant").disabled = true;
  document.getElementById("ppc-interval-val").textContent = "7";
  // Kategori sekmelerini sıfırla
  document.querySelectorAll(".cat-tab").forEach(t => t.classList.toggle("active", t.dataset.cat === "all"));
  renderCatalog("", "all");
  document.getElementById("modal-add-plant").classList.add("show");
  setTimeout(() => document.getElementById("field-plant-search").focus(), 120);
}
function closeAddPlant() { document.getElementById("modal-add-plant").classList.remove("show"); }

// Aktif kategori
let activeCat = "all";

// Veritabanından arama + kategori filtresi + render
function renderCatalog(query, cat) {
  if (cat !== undefined) activeCat = cat;
  const q = (query || document.getElementById("field-plant-search").value || "").trim().toLocaleLowerCase("tr");

  let results = PLANTS_DB;
  if (activeCat && activeCat !== "all") {
    results = results.filter(p => p.category === activeCat);
  }
  if (q) {
    results = results.filter(p =>
      p.nameTr.toLocaleLowerCase("tr").includes(q) ||
      p.nameLat.toLocaleLowerCase("tr").includes(q) ||
      (p.care||"").toLocaleLowerCase("tr").includes(q)
    );
  }

  const grid = document.getElementById("plant-search-results");
  if (!results.length) {
    grid.innerHTML = `<p style="grid-column:1/-1;color:var(--muted);font-size:.9rem;padding:8px 0">Sonuç bulunamadı.</p>`;
    return;
  }
  grid.innerHTML = results.map(p => {
    const idx = PLANTS_DB.indexOf(p);
    return `<button class="popular-plant-btn" data-idx="${idx}" type="button">
      <span class="popular-emoji">${p.emoji}</span>
      <span class="popular-name">${esc(p.nameTr)}</span>
    </button>`;
  }).join("");
  grid.querySelectorAll(".popular-plant-btn").forEach(btn => {
    btn.addEventListener("click", () => selectPlantFromDB(PLANTS_DB[Number(btn.dataset.idx)]));
  });
}

// DB'den bitki seç — Wikimedia'dan görsel çek
async function selectPlantFromDB(dbPlant) {
  plantDraft = null;
  document.getElementById("btn-save-plant").disabled = true;
  document.getElementById("plant-preview-card").classList.add("hidden");
  document.getElementById("plant-add-status").innerHTML = '<span class="loader"></span> Görsel yükleniyor…';

  // Wikimedia Commons'tan güvenli görsel çek
  let imageUrl = "";
  try {
    imageUrl = await fetchWikimediaImage(dbPlant.nameLat || dbPlant.nameTr);
  } catch(e) { /* görselsiz devam */ }

  plantDraft = {
    nameTr:    dbPlant.nameTr,
    nameLat:   dbPlant.nameLat,
    care:      dbPlant.care,
    excerpt:   "",
    imageUrl,
    light:     dbPlant.light,
    waterDays: dbPlant.waterDays,
    emoji:     dbPlant.emoji,
    wikiUrl:   `https://tr.wikipedia.org/wiki/${encodeURIComponent((dbPlant.nameLat||dbPlant.nameTr).replace(/ /g,"_"))}`
  };
  plantInterval = dbPlant.waterDays;

  // Kart doldur
  const imgEl = document.getElementById("ppc-img");
  if (imageUrl) { imgEl.src = imageUrl; imgEl.style.display = "block"; }
  else          { imgEl.style.display = "none"; }

  document.getElementById("ppc-emoji").textContent      = dbPlant.emoji;
  document.getElementById("ppc-name-tr").textContent    = dbPlant.nameTr;
  document.getElementById("ppc-name-lat").textContent   = dbPlant.nameLat || "";
  document.getElementById("ppc-excerpt").textContent    = dbPlant.care || "";
  document.getElementById("ppc-light").textContent      = dbPlant.light;
  document.getElementById("ppc-water-freq").textContent = `Her ${dbPlant.waterDays} günde bir`;
  document.getElementById("ppc-interval-val").textContent = String(plantInterval);
  document.getElementById("plant-preview-card").classList.remove("hidden");
  document.getElementById("plant-add-status").textContent = "";
  document.getElementById("btn-save-plant").disabled = false;
}

// Wikimedia Commons API — güvenli telif hakkı temiz görseller
async function fetchWikimediaImage(searchTerm) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(searchTerm)}&prop=pageimages&format=json&pithumbsize=400&origin=*`;
  const res  = await fetch(url);
  const data = await res.json();
  const pages = data?.query?.pages || {};
  for (const page of Object.values(pages)) {
    if (page.thumbnail?.source) return page.thumbnail.source;
  }
  // İkinci deneme: arama ile
  const url2 = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchTerm)}&format=json&srlimit=1&origin=*`;
  const res2  = await fetch(url2);
  const data2 = await res2.json();
  const hits  = data2?.query?.search || [];
  if (!hits.length) return "";
  const url3 = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(hits[0].title)}&prop=pageimages&format=json&pithumbsize=400&origin=*`;
  const res3  = await fetch(url3);
  const data3 = await res3.json();
  const pages3 = data3?.query?.pages || {};
  for (const page of Object.values(pages3)) {
    if (page.thumbnail?.source) return page.thumbnail.source;
  }
  return "";
}

async function savePlant() {
  if (!plantDraft || !currentGardenId) return;
  const btn = document.getElementById("btn-save-plant");
  btn.disabled = true; btn.textContent = "Kaydediliyor…";
  try {
    await plantsCol(currentGardenId).add({
      nameTr:              plantDraft.nameTr,
      nameLat:             plantDraft.nameLat || "",
      care:                plantDraft.care    || "",
      excerpt:             plantDraft.excerpt || "",
      imageUrl:            plantDraft.imageUrl|| "",
      light:               plantDraft.light   || "",
      emoji:               plantDraft.emoji   || "🌿",
      wateringIntervalDays: plantInterval,
      wikiUrl:             plantDraft.wikiUrl || "",
      lastWateredAt:       null,
      wateringHistory:     [],
      createdAt:           new Date().toISOString()
    });
    closeAddPlant();
    toast("Bitki eklendi 🌿");
  } catch(e) {
    toast("Hata: " + e.message);
    btn.disabled = false; btn.textContent = "Bahçeye ekle";
  }
}

// ─── BAĞLANTI ───
function wireOnce() {
  if (appWired) return;
  appWired = true;

  // Geri
  document.getElementById("btn-back").addEventListener("click", () => {
    if (unsubPlants) { unsubPlants(); unsubPlants = null; }
    showScreen("screen-gardens");
  });

  // Bahçe
  document.getElementById("btn-add-garden").addEventListener("click",       () => openGardenModal("add"));
  document.getElementById("btn-add-garden-empty").addEventListener("click", () => openGardenModal("add"));
  document.getElementById("modal-garden-close").addEventListener("click",   closeGardenModal);
  document.getElementById("btn-save-garden").addEventListener("click",      saveGarden);
  document.getElementById("modal-garden").addEventListener("click", e => { if(e.target.id==="modal-garden") closeGardenModal(); });
  document.getElementById("field-garden-name").addEventListener("keydown", e => { if(e.key==="Enter") saveGarden(); });
  document.getElementById("btn-rename-garden").addEventListener("click", () => openGardenModal("rename"));

  // Bitki ekle
  document.getElementById("btn-add-plant").addEventListener("click",       openAddPlant);
  document.getElementById("btn-add-plant-empty").addEventListener("click", openAddPlant);
  document.getElementById("modal-plant-close").addEventListener("click",   closeAddPlant);
  document.getElementById("modal-add-plant").addEventListener("click", e => { if(e.target.id==="modal-add-plant") closeAddPlant(); });

  // Kategori sekmeleri
  document.getElementById("cat-tabs").addEventListener("click", e => {
    const tab = e.target.closest(".cat-tab");
    if (!tab) return;
    document.querySelectorAll(".cat-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    renderCatalog("", tab.dataset.cat);
  });

  // Canlı arama
  document.getElementById("field-plant-search").addEventListener("input", e => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => renderCatalog(e.target.value), 200);
  });

  // Sulama aralığı
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

  // Detay kapat
  document.getElementById("modal-detail-close").addEventListener("click", () =>
    document.getElementById("modal-plant-detail").classList.remove("show")
  );
  document.getElementById("modal-plant-detail").addEventListener("click", e => {
    if(e.target.id==="modal-plant-detail") document.getElementById("modal-plant-detail").classList.remove("show");
  });
}

async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  try { await navigator.serviceWorker.register("sw.js"); } catch(e) { console.warn("SW:",e); }
}
