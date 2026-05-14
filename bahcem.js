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

// Formspree: https://formspree.io — yeni form oluşturup “form endpoint” ID’sini buraya yazın (örn. xvgw…).
const FORMSPREE_FORM_ID = ""; // Formspree ID buraya gelecek

const PREF_WATER_OVERRIDE = "bahcem-pref-water-override";
const PREF_WATER_DAYS = "bahcem-pref-water-days";
const PREF_COMPACT = "bahcem-pref-compact";

let currentUser = null, gardens = [], plants = [];
let currentGardenId = null;
let unsubGardens = null, unsubPlants = null;
let appWired = false;
let selectedPlants = new Map(); // id → {dbPlant, interval, imageUrl}
let searchTimeout = null;

// ─── YARDIMCILAR ───
const esc  = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const escA = s => String(s).replace(/"/g,"&quot;");

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2500);
}

function getPrefWaterOverride() {
  return localStorage.getItem(PREF_WATER_OVERRIDE) === "1";
}
function getPrefWaterDays() {
  const n = parseInt(localStorage.getItem(PREF_WATER_DAYS) || "7", 10);
  return Math.min(90, Math.max(1, n || 7));
}
function intervalForNewPlant(dbPlant) {
  if (getPrefWaterOverride()) return getPrefWaterDays();
  return Math.max(1, Number(dbPlant.waterDays) || 7);
}
function applyCompactFromStorage() {
  const app = document.getElementById("app-screen");
  if (!app) return;
  app.classList.toggle("app-compact", localStorage.getItem(PREF_COMPACT) === "1");
  if (gardens.length) renderGardens();
  if (plants.length) renderPlants();
}
function syncWaterDaysInputState() {
  const elOv = document.getElementById("pref-water-override");
  const elDays = document.getElementById("pref-water-days");
  if (!elOv || !elDays) return;
  elDays.disabled = !elOv.checked;
}
function updateNotifStatus() {
  const statusEl = document.getElementById("notif-status-text");
  const btnEl    = document.getElementById("btn-notif-toggle");
  if (!statusEl || !btnEl) return;
  if (!("Notification" in window)) {
    statusEl.textContent = "❌ Bu tarayıcı bildirimleri desteklemiyor";
    return;
  }
  if (Notification.permission === "granted") {
    statusEl.textContent = "✅ Bildirimler açık — Her sabah 08:00'de kontrol edilir";
    btnEl.style.display = "none";
  } else if (Notification.permission === "denied") {
    statusEl.textContent = "🚫 Bildirimler engellendi — Tarayıcı ayarlarından izin verin";
    btnEl.style.display = "none";
  } else {
    statusEl.textContent = "🔔 Bildirimler kapalı";
    btnEl.style.display = "inline-flex";
    btnEl.textContent = "Bildirimleri Aç";
    btnEl.onclick = async () => {
      await requestNotifPermission();
      updateNotifStatus();
    };
  }
}

function openSettingsModal() {
  document.getElementById("pref-water-override").checked = getPrefWaterOverride();
  document.getElementById("pref-water-days").value = String(getPrefWaterDays());
  document.getElementById("pref-compact").checked = localStorage.getItem(PREF_COMPACT) === "1";
  syncWaterDaysInputState();
  document.getElementById("modal-settings").classList.add("show");
}
function closeSettingsModal() {
  document.getElementById("modal-settings").classList.remove("show");
}
function saveSettingsFromModal() {
  let days = parseInt(document.getElementById("pref-water-days").value, 10);
  if (!Number.isFinite(days)) days = 7;
  days = Math.min(90, Math.max(1, days));
  localStorage.setItem(PREF_WATER_DAYS, String(days));
  localStorage.setItem(PREF_WATER_OVERRIDE, document.getElementById("pref-water-override").checked ? "1" : "0");
  localStorage.setItem(PREF_COMPACT, document.getElementById("pref-compact").checked ? "1" : "0");
  applyCompactFromStorage();
  closeSettingsModal();
  toast("Ayarlar kaydedildi ✓");
}
function closeFeedbackModal() {
  // artık bağımsız modal yok — ayarlar içinde
}

async function submitFeedback(ev) {
  if (ev) ev.preventDefault();

  const msgEl = document.getElementById("field-feedback-msg");
  const msg   = msgEl ? msgEl.value.trim() : "";
  if (!msg) { toast("Lütfen bir mesaj yazın"); return; }

  const typeRadioEl = document.querySelector('input[name="feedback-type"]:checked');
  const type  = typeRadioEl ? typeRadioEl.value : "oneri";
  const label = { oneri:"Öneri", sikayet:"Şikayet", hata:"Hata Bildirimi" }[type] || type;
  const name  = currentUser ? (currentUser.displayName || "Kullanıcı") : "Anonim";
  const email = currentUser ? (currentUser.email || "") : "";

  const subj = encodeURIComponent("[Bahçem] " + label);
  const body = encodeURIComponent(
    label.toUpperCase() + "\n\n" + msg +
    "\n\n---\nGönderen: " + name + (email ? " (" + email + ")" : "")
  );
  window.location.href = "mailto:salimoglu61@gmail.com?subject=" + subj + "&body=" + body;
  // Textarea temizle + sonuç mesajı göster
  const msgEl2 = document.getElementById("field-feedback-msg");
  if (msgEl2) msgEl2.value = "";
  const resEl = document.getElementById("feedback-result");
  if (resEl) {
    resEl.textContent = "✓ Mail uygulamanız açıldı. Gönderin!";
    setTimeout(() => { if (resEl) resEl.textContent = ""; }, 4000);
  }
  toast("Mail uygulamanız açıldı 📧");
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
    // Kullanıcı bilgisi artık ayarlar modalında gösterilir
    const ph = document.getElementById("settings-avatar");
    if (ph) {
      if (user.photoURL) { ph.src = user.photoURL; ph.style.display = "block"; }
      else ph.style.display = "none";
    }
    const nameEl = document.getElementById("settings-user-name");
    if (nameEl) nameEl.textContent = user.displayName || "";
    const emailEl = document.getElementById("settings-user-email");
    if (emailEl) emailEl.textContent = user.email || "";
    showApp("app-screen"); showScreen("screen-gardens");
    listenGardens(); applyCompactFromStorage(); wireOnce(); registerSw();
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
  selectedPlants.clear(); activeCat = "all";
  const searchEl = document.getElementById("field-plant-search");
  if (searchEl) searchEl.value = "";
  document.querySelectorAll(".cat-tab").forEach(t => t.classList.toggle("active", t.dataset.cat === "all"));
  renderCatalog("", "all");
  updateSelectionBar();
  document.getElementById("modal-add-plant").classList.add("show");
  setTimeout(() => { if (searchEl) searchEl.focus(); }, 120);
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
  // Bahçedeki mevcut bitki adları (küçük harfle karşılaştırma için)
  const existingNames = new Set(plants.map(p => (p.nameTr||"").toLocaleLowerCase("tr")));

  grid.innerHTML = results.map(p => {
    const idx = PLANTS_DB.indexOf(p);
    const sel = selectedPlants.has(p.id);
    const inGarden = existingNames.has(p.nameTr.toLocaleLowerCase("tr"));
    let cls = "popular-plant-btn";
    if (sel) cls += " selected";
    if (inGarden && !sel) cls += " already-added";
    return `<button class="${cls}" data-idx="${idx}" data-pid="${p.id}" type="button">
      ${sel    ? '<span class="sel-check">✓</span>' : ''}
      ${inGarden && !sel ? '<span class="already-badge">✓</span>' : ''}
      <span class="popular-emoji">${p.emoji}</span>
      <span class="popular-name">${esc(p.nameTr)}</span>
    </button>`;
  }).join("");
  grid.querySelectorAll(".popular-plant-btn").forEach(btn => {
    const dbPlant = PLANTS_DB[Number(btn.dataset.idx)];
    // Kısa tık → seç/kaldır
    btn.addEventListener("click", () => togglePlantSelect(dbPlant, btn));
    // Long press → önizleme
    let pressTimer = null;
    btn.addEventListener("pointerdown", () => {
      pressTimer = setTimeout(() => { pressTimer = null; showPlantPreview(dbPlant); }, 500);
    });
    btn.addEventListener("pointerup",   () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    btn.addEventListener("pointerleave",() => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    btn.addEventListener("contextmenu", e => { e.preventDefault(); showPlantPreview(dbPlant); });
  });
}




// ─── BİTKİ ÖNİZLEME (long press) ───
function showPlantPreview(dbPlant) {
  const m   = document.getElementById("modal-plant-preview");
  const box = document.getElementById("preview-content");
  const inGarden = plants.some(p => (p.nameTr||"").toLocaleLowerCase("tr") === dbPlant.nameTr.toLocaleLowerCase("tr"));
  const sel = selectedPlants.has(dbPlant.id);

  // İskelet göster, Wikipedia yüklenene kadar
  box.innerHTML = `
    <div class="preview-header">
      <span class="preview-emoji">${dbPlant.emoji}</span>
      <div class="preview-titles">
        <span class="preview-name-tr">${esc(dbPlant.nameTr)}</span>
        <span class="preview-name-lat">${esc(dbPlant.nameLat||"")}</span>
      </div>
      ${inGarden ? '<span class="preview-already-tag">✓ Bahçende var</span>' : ""}
    </div>
    <div class="preview-badges">
      <span class="ppc-badge ppc-badge-light">☀️ ${esc(dbPlant.light)}</span>
      <span class="ppc-badge ppc-badge-water">💧 Her ${intervalForNewPlant(dbPlant)} günde bir</span>
    </div>
    <div class="preview-care">${esc(dbPlant.care||"")}</div>
    <div id="preview-wiki-area" class="preview-wiki-loading">
      <span class="loader"></span> Wikipedia yükleniyor…
    </div>
    <div class="preview-actions">
      ${inGarden
        ? `<span class="preview-in-garden-note">Bu bitki zaten bahçende ekli.</span>`
        : sel
          ? `<button type="button" class="btn btn-ghost btn-sm" id="preview-desel-btn">Seçimi kaldır</button>`
          : `<button type="button" class="btn btn-primary btn-sm" id="preview-sel-btn">+ Seç</button>`
      }
      <button type="button" class="btn btn-ghost btn-sm" id="preview-close-btn">Kapat</button>
    </div>
  `;

  // Buton olayları
  document.getElementById("preview-close-btn").onclick = () => m.classList.remove("show");
  const selBtn = document.getElementById("preview-sel-btn");
  if (selBtn) selBtn.onclick = () => {
    selectedPlants.set(dbPlant.id, { dbPlant, interval: intervalForNewPlant(dbPlant), imageUrl: "" });
    fetchWikimediaImage(dbPlant.nameLat || dbPlant.nameTr).then(url => {
      if (selectedPlants.has(dbPlant.id)) selectedPlants.get(dbPlant.id).imageUrl = url;
    }).catch(()=>{});
    updateSelectionBar(); renderCatalog();
    m.classList.remove("show");
    toast(`${dbPlant.nameTr} seçildi`);
  };
  const deselBtn = document.getElementById("preview-desel-btn");
  if (deselBtn) deselBtn.onclick = () => {
    selectedPlants.delete(dbPlant.id);
    updateSelectionBar(); renderCatalog();
    m.classList.remove("show");
  };

  m.classList.add("show");

  // Wikipedia'dan Türkçe özet çek (önce TR, olmadı EN)
  fetchWikiPreview(dbPlant).then(wiki => {
    const area = document.getElementById("preview-wiki-area");
    if (!area) return; // modal kapandıysa
    if (!wiki) {
      area.innerHTML = "";
      return;
    }
    area.className = "preview-wiki-area";
    area.innerHTML = `
      <a class="preview-wiki-link" href="${escA(wiki.url)}" target="_blank" rel="noopener">
        🌐 Vikipedi'de oku ↗
      </a>
    `;
  }).catch(() => {
    const area = document.getElementById("preview-wiki-area");
    if (area) area.innerHTML = "";
  });
}

// Latince addan cins adını çıkar: "Aglaonema red" → "Aglaonema"
function genusFrom(nameLat) {
  if (!nameLat) return "";
  return nameLat.trim().split(/\s+/)[0];
}

// Wikipedia özeti çek — TR önce, EN fallback, cins adı fallback
async function fetchWikiPreview(dbPlant) {
  const genus = genusFrom(dbPlant.nameLat);
  // Sorgular: özel addan genele doğru
  const queries = [
    { lang: "tr", q: dbPlant.nameTr },
    { lang: "tr", q: dbPlant.nameLat },
    { lang: "tr", q: genus },
    { lang: "en", q: dbPlant.nameLat },
    { lang: "en", q: genus },
    { lang: "en", q: dbPlant.nameTr },
  ].filter(x => x.q && x.q.trim().length > 1);

  // Aynı (lang,q) ikilisini tekrar deneme
  const tried = new Set();

  for (const { lang, q } of queries) {
    const key = lang + ":" + q.toLowerCase();
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      const searchRes = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=5&origin=*`
      );
      if (!searchRes.ok) continue;
      const hits = (await searchRes.json())?.query?.search || [];
      for (const hit of hits.slice(0, 3)) {
        try {
          const sumRes = await fetch(
            `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g,"_"))}`
          );
          if (!sumRes.ok) continue;
          const data = await sumRes.json();
          if (data.type === "disambiguation" || !data.extract || data.extract.length < 30) continue;
          return {
            url: data.content_urls?.desktop?.page ||
                 `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g,"_"))}`
          };
        } catch(e) { continue; }
      }
    } catch(e) { continue; }
  }

  // Son çare: Wikipedia arama sayfası (her zaman çalışır)
  const fbQ = dbPlant.nameLat || dbPlant.nameTr;
  return { url: `https://tr.wikipedia.org/w/index.php?search=${encodeURIComponent(fbQ)}` };
}

// Seç / kaldır
function togglePlantSelect(dbPlant, btn) {
  // Zaten bahçede varsa seçme
  if (btn.classList.contains("already-added")) {
    toast(`${dbPlant.nameTr} zaten bu bahçede ekli`);
    return;
  }
  if (selectedPlants.has(dbPlant.id)) {
    selectedPlants.delete(dbPlant.id);
    btn.classList.remove("selected");
    btn.querySelector(".sel-check")?.remove();
  } else {
    selectedPlants.set(dbPlant.id, { dbPlant, interval: intervalForNewPlant(dbPlant), imageUrl: "" });
    btn.classList.add("selected");
    if (!btn.querySelector(".sel-check")) {
      const chk = document.createElement("span");
      chk.className = "sel-check"; chk.textContent = "✓";
      btn.prepend(chk);
    }
    // Arka planda görsel çek
    fetchWikimediaImage(dbPlant.nameLat || dbPlant.nameTr).then(url => {
      if (selectedPlants.has(dbPlant.id)) {
        selectedPlants.get(dbPlant.id).imageUrl = url;
      }
    }).catch(()=>{});
  }
  updateSelectionBar();
}

// Seçim çubuğunu güncelle
function updateSelectionBar() {
  const count = selectedPlants.size;
  const bar   = document.getElementById("selection-bar");
  const label = document.getElementById("sel-count-label");
  if (count === 0) {
    bar.classList.add("hidden");
  } else {
    bar.classList.remove("hidden");
    label.textContent = count === 1 ? "1 bitki seçildi" : `${count} bitki seçildi`;
  }
  document.getElementById("btn-save-plant").disabled = count === 0;
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
  if (!selectedPlants.size || !currentGardenId) return;
  const btn = document.getElementById("btn-save-plant");
  btn.disabled = true;
  const count = selectedPlants.size;
  btn.textContent = count > 1 ? `${count} bitki ekleniyor…` : "Ekleniyor…";
  try {
    const col = plantsCol(currentGardenId);
    const now = new Date().toISOString();
    // Paralel kaydet
    await Promise.all([...selectedPlants.values()].map(({ dbPlant, interval, imageUrl }) =>
      col.add({
        nameTr:              dbPlant.nameTr,
        nameLat:             dbPlant.nameLat  || "",
        care:                dbPlant.care     || "",
        excerpt:             "",
        imageUrl:            imageUrl         || "",
        light:               dbPlant.light    || "",
        emoji:               dbPlant.emoji    || "🌿",
        wateringIntervalDays: interval,
        wikiUrl:             `https://tr.wikipedia.org/wiki/${encodeURIComponent((dbPlant.nameLat||dbPlant.nameTr).replace(/ /g,"_"))}`,
        lastWateredAt:       null,
        wateringHistory:     [],
        createdAt:           now
      })
    ));
    closeAddPlant();
    toast(count > 1 ? `${count} bitki eklendi 🌿` : "Bitki eklendi 🌿");
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

  // sulama aralığı: seçim çubuğundan yönetilir

  // Temizle
  const clearBtn = document.getElementById("btn-clear-sel"); if (clearBtn) clearBtn.addEventListener("click", () => {
    selectedPlants.clear();
    updateSelectionBar();
    renderCatalog(); // seçim işaretlerini kaldır
  });

  // Kaydet
  document.getElementById("btn-save-plant").addEventListener("click", savePlant);

  // Önizleme modalı kapat (backdrop tık)
  document.getElementById("modal-plant-preview").addEventListener("click", e => {
    if (e.target.id === "modal-plant-preview") document.getElementById("modal-plant-preview").classList.remove("show");
  });

  // Detay kapat
  document.getElementById("modal-detail-close").addEventListener("click", () =>
    document.getElementById("modal-plant-detail").classList.remove("show")
  );
  document.getElementById("modal-plant-detail").addEventListener("click", e => {
    if(e.target.id==="modal-plant-detail") document.getElementById("modal-plant-detail").classList.remove("show");
  });

  document.getElementById("btn-settings").addEventListener("click", openSettingsModal);
  document.getElementById("modal-settings-close").addEventListener("click", closeSettingsModal);
  document.getElementById("btn-settings-save").addEventListener("click", saveSettingsFromModal);
  document.getElementById("modal-settings").addEventListener("click", e => { if (e.target.id === "modal-settings") closeSettingsModal(); });
  document.getElementById("pref-water-override").addEventListener("change", syncWaterDaysInputState);

  // Ayarlar içindeki feedback gönder butonu
  document.getElementById("btn-feedback-send").addEventListener("click", submitFeedback);
}

async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  try { await navigator.serviceWorker.register("sw.js"); } catch(e) { console.warn("SW:",e); }
}
