(() => {
  const STORAGE_KEY = "bahcem-plants-v1";

  /** @typedef {{ id: string, nick: string, wikiTitle: string, wikiLang: string, excerpt: string, imageUrl: string | null, url: string | null, wateringIntervalDays: number, lastWateredAt: string | null, createdAt: string }} Plant */

  function uid() {
    try {
      return crypto.randomUUID();
    } catch (e) {
      return "p-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }
  }

  function loadPlants() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  /** @param {Plant[]} plants */
  function savePlants(plants) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plants));
  }

  /**
   * @param {string} lang
   * @param {string} q
   * @returns {Promise<{ title: string }[]>}
   */
  async function wikiSearch(lang, q) {
    const url =
      "https://" +
      lang +
      ".wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
      encodeURIComponent(q) +
      "&format=json&srlimit=10&origin=*";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Arama başarısız");
    const data = await res.json();
    const list = (data && data.query && data.query.search) || [];
    return list.map((x) => ({ title: x.title }));
  }

  /**
   * @param {string} lang
   * @param {string} title
   */
  async function wikiSummary(lang, title) {
    const pathTitle = encodeURIComponent(title.replace(/ /g, "_"));
    const url = "https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + pathTitle;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.type === "disambiguation" || data.type === "not_found") return null;
    const imageUrl =
      (data.originalimage && data.originalimage.source) ||
      (data.thumbnail && data.thumbnail.source) ||
      null;
    return {
      title: data.title || title,
      excerpt: data.extract || "",
      imageUrl,
      url: data.content_urls && data.content_urls.desktop ? data.content_urls.desktop.page : null
    };
  }

  /**
   * @param {string} q
   * @returns {Promise<{ lang: string, title: string, excerpt: string, imageUrl: string | null, url: string | null } | null>}
   */
  async function fetchPlantInfo(q) {
    const query = (q || "").trim();
    if (!query) return null;

    const trSearch = await wikiSearch("tr", query);
    if (trSearch.length) {
      for (const s of trSearch.slice(0, 5)) {
        const sum = await wikiSummary("tr", s.title);
        if (sum && sum.excerpt) {
          return { lang: "tr", title: sum.title, excerpt: sum.excerpt, imageUrl: sum.imageUrl, url: sum.url };
        }
      }
    }

    const enSearch = await wikiSearch("en", query);
    if (enSearch.length) {
      for (const s of enSearch.slice(0, 5)) {
        const sum = await wikiSummary("en", s.title);
        if (sum && sum.excerpt) {
          return { lang: "en", title: sum.title, excerpt: sum.excerpt, imageUrl: sum.imageUrl, url: sum.url };
        }
      }
    }

    return null;
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }

  /** @param {Plant} p */
  function nextWaterTimestamp(p) {
    const base = p.lastWateredAt ? new Date(p.lastWateredAt).getTime() : new Date(p.createdAt).getTime();
    const days = Math.max(1, Number(p.wateringIntervalDays) || 7);
    return base + days * 86400000;
  }

  /** @param {Plant} p */
  function waterStatus(p) {
    const next = nextWaterTimestamp(p);
    const today = startOfDay(Date.now());
    const nextDay = startOfDay(next);
    const diff = Math.round((nextDay - today) / 86400000);
    if (diff < 0) return { key: "late", label: Math.abs(diff) + " gün gecikti", diff };
    if (diff === 0) return { key: "today", label: "Bugün", diff };
    if (diff === 1) return { key: "soon", label: "Yarın", diff };
    return { key: "ok", label: diff + " gün sonra", diff };
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("tr-TR", {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    } catch (e) {
      return "—";
    }
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  const els = {
    list: null,
    empty: null,
    btnAdd: null,
    modalAdd: null,
    modalDetail: null,
    formSearch: null,
    formNick: null,
    formInterval: null,
    btnFetch: null,
    btnSave: null,
    searchResults: null,
    preview: null,
    detailBody: null,
    toast: null
  };

  let plants = loadPlants();
  let draft = /** @type {null | { lang: string, title: string, excerpt: string, imageUrl: string | null, url: string | null }} */ (
    null
  );
  let searchHits = /** @type { { title: string }[] } */ ([]);
  let selectedTitle = /** @type {string | null} */ (null);
  let selectedLang = "tr";
  let detailPlantId = /** @type {string | null} */ (null);

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

    list.innerHTML = plants
      .map((p) => {
        const st = waterStatus(p);
        const badgeClass = st.key === "late" ? "badge-late" : st.key === "ok" ? "badge-ok" : "badge-soon";
        const thumb = p.imageUrl
          ? `<img class="plant-thumb" src="${escapeAttr(p.imageUrl)}" alt="" loading="lazy" />`
          : `<div class="plant-thumb placeholder" aria-hidden="true">🌿</div>`;
        return (
          `<article class="plant-card" data-id="${escapeAttr(p.id)}" role="button" tabindex="0">` +
          thumb +
          `<div class="plant-meta">` +
          `<h3>${escapeHtml(p.nick || p.wikiTitle)}</h3>` +
          `<p class="excerpt">${escapeHtml((p.excerpt || "").slice(0, 220))}${(p.excerpt || "").length > 220 ? "…" : ""}</p>` +
          `<div class="water-strip">` +
          `<span class="badge ${badgeClass}">💧 ${escapeHtml(st.label)}</span>` +
          `<span>Son: ${fmtDate(p.lastWateredAt)}</span>` +
          `</div></div></article>`
        );
      })
      .join("");

    list.querySelectorAll(".plant-card").forEach((card) => {
      card.addEventListener("click", () => openDetail(card.getAttribute("data-id")));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail(card.getAttribute("data-id"));
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** @param {string} s */
  function escapeAttr(s) {
    return String(s).replace(/"/g, "&quot;");
  }

  function openAdd() {
    draft = null;
    selectedTitle = null;
    searchHits = [];
    const m = document.getElementById("modal-add");
    const q = document.getElementById("field-query");
    const nick = document.getElementById("field-nick");
    const intv = document.getElementById("field-interval");
    const prev = document.getElementById("field-preview");
    if (q) q.value = "";
    if (nick) nick.value = "";
    if (intv) intv.value = "7";
    if (prev) prev.innerHTML = '<p class="muted">Önce bitki ara; bilgi kartı burada görünür.</p>';
    const srClear = document.getElementById("search-results");
    if (srClear) {
      srClear.innerHTML = "";
      srClear.classList.add("hidden");
    }
    if (m) {
      m.classList.add("show");
      setTimeout(() => q && q.focus(), 120);
    }
  }

  function closeAdd() {
    const m = document.getElementById("modal-add");
    if (m) m.classList.remove("show");
  }

  function openDetail(id) {
    detailPlantId = id;
    const p = plants.find((x) => x.id === id);
    const m = document.getElementById("modal-detail");
    const body = document.getElementById("detail-content");
    if (!p || !m || !body) return;

    const st = waterStatus(p);
    const badgeClass = st.key === "late" ? "badge-late" : st.key === "ok" ? "badge-ok" : "badge-soon";
    const img = p.imageUrl
      ? `<p><img src="${escapeAttr(p.imageUrl)}" alt="" style="max-width:100%;border-radius:12px"/></p>`
      : "";
    const link =
      p.url ? `<p><a href="${escapeAttr(p.url)}" target="_blank" rel="noopener">Vikipedi’de aç</a></p>` : "";

    body.innerHTML =
      `<h3 style="margin:0 0 8px;font-size:1.2rem">${escapeHtml(p.nick || p.wikiTitle)}</h3>` +
      `<p class="badge ${badgeClass}" style="display:inline-flex;margin-bottom:12px">💧 ${escapeHtml(st.label)}</p>` +
      `<p style="margin:8px 0;font-size:.9rem;color:var(--muted)">Son sulaşma: <strong>${fmtDate(
        p.lastWateredAt
      )}</strong> · Aralık: <strong>${p.wateringIntervalDays}</strong> gün</p>` +
      img +
      `<div class="preview-box" style="max-height:none;margin-top:12px">${escapeHtml(p.excerpt || "Özet yok.")}</div>` +
      link +
      `<div style="margin-top:14px" class="field">` +
      `<label for="detail-interval-edit">Sulaşma aralığı (gün)</label>` +
      `<input type="number" id="detail-interval-edit" min="1" max="90" value="${p.wateringIntervalDays}" />` +
      `</div>` +
      `<div class="modal-actions">` +
      `<button type="button" class="btn btn-primary" id="btn-watered">Suladım</button>` +
      `<button type="button" class="btn btn-secondary" id="btn-save-interval">Aralığı kaydet</button>` +
      `<button type="button" class="btn btn-danger" id="btn-delete-plant">Sil</button>` +
      `</div>`;

    document.getElementById("btn-watered").addEventListener("click", () => {
      p.lastWateredAt = new Date().toISOString();
      savePlants(plants);
      toast("Sulaşma kaydedildi");
      renderList();
      openDetail(p.id);
    });

    document.getElementById("btn-save-interval").addEventListener("click", () => {
      const el = document.getElementById("detail-interval-edit");
      const v = Math.max(1, Math.min(90, Number(el.value) || 7));
      p.wateringIntervalDays = v;
      savePlants(plants);
      toast("Aralık güncellendi");
      renderList();
      openDetail(p.id);
    });

    document.getElementById("btn-delete-plant").addEventListener("click", () => {
      if (!confirm("Bu bitkiyi silmek istiyor musunuz?")) return;
      plants = plants.filter((x) => x.id !== p.id);
      savePlants(plants);
      m.classList.remove("show");
      toast("Silindi");
      renderList();
    });

    m.classList.add("show");
  }

  function closeDetail() {
    document.getElementById("modal-detail").classList.remove("show");
  }

  async function runSearch() {
    const qEl = document.getElementById("field-query");
    const prev = document.getElementById("field-preview");
    const sr = document.getElementById("search-results");
    const btn = document.getElementById("btn-fetch");
    const q = (qEl && qEl.value.trim()) || "";
    if (!q) {
      toast("Bitki adı yazın");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loader"></span> Aranıyor…';
    }
    draft = null;
    selectedTitle = null;
    searchHits = [];
    try {
      let hits = await wikiSearch("tr", q);
      selectedLang = "tr";
      if (!hits.length) {
        hits = await wikiSearch("en", q);
        selectedLang = "en";
      }
      searchHits = hits;
      if (!hits.length) {
        if (prev)
          prev.innerHTML =
            "<p>Vikipedi'de sonuç bulunamadı. Farklı bir anahtar kelime deneyin (örn. latin adı).</p>";
        if (sr) sr.classList.add("hidden");
        return;
      }
      if (sr) {
        sr.innerHTML = hits
          .map(
            (h, i) =>
              `<li data-idx="${i}" class="${i === 0 ? "active" : ""}" role="option">${escapeHtml(h.title)}</li>`
          )
          .join("");
        sr.classList.remove("hidden");
        sr.querySelectorAll("li").forEach((li) => {
          li.addEventListener("click", () => {
            sr.querySelectorAll("li").forEach((x) => x.classList.remove("active"));
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
      if (prev)
        prev.innerHTML = "<p>İnternetten veri alınamadı. Bağlantınızı kontrol edin.</p>";
      toast("Hata");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Vikipedi'den bilgi getir";
      }
    }
  }

  async function loadSummaryForSelected() {
    const prev = document.getElementById("field-preview");
    const nick = document.getElementById("field-nick");
    if (!selectedTitle) return;
    if (prev)
      prev.innerHTML = '<p><span class="loader"></span> Özet yükleniyor…</p>';
    try {
      const sum = await wikiSummary(selectedLang, selectedTitle);
      if (!sum || !sum.excerpt) {
        draft = null;
        if (prev) prev.innerHTML = "<p>Bu başlık için özet çıkarılamadı; listeden başka bir sonuç seçin.</p>";
        return;
      }
      draft = {
        lang: selectedLang,
        title: sum.title,
        excerpt: sum.excerpt,
        imageUrl: sum.imageUrl,
        url: sum.url
      };
      if (nick && !nick.value.trim()) nick.value = sum.title;
      const img = sum.imageUrl
        ? `<img src="${escapeAttr(sum.imageUrl)}" alt="" />`
        : "";
      if (prev) prev.innerHTML = img + "<p>" + escapeHtml(sum.excerpt) + "</p>";
    } catch (e) {
      console.error(e);
      draft = null;
      if (prev) prev.innerHTML = "<p>Özet alınamadı.</p>";
    }
  }

  function saveNewPlant() {
    if (!draft) {
      toast("Önce bilgi getirin");
      return;
    }
    const nickEl = document.getElementById("field-nick");
    const intvEl = document.getElementById("field-interval");
    const nick = (nickEl && nickEl.value.trim()) || draft.title;
    const interval = Math.max(1, Math.min(90, Number(intvEl && intvEl.value) || 7));

    /** @type {Plant} */
    const p = {
      id: uid(),
      nick,
      wikiTitle: draft.title,
      wikiLang: draft.lang,
      excerpt: draft.excerpt,
      imageUrl: draft.imageUrl,
      url: draft.url,
      wateringIntervalDays: interval,
      lastWateredAt: null,
      createdAt: new Date().toISOString()
    };
    plants = [p, ...plants];
    savePlants(plants);
    closeAdd();
    toast("Bitki eklendi");
    renderList();
  }

  function wire() {
    document.getElementById("btn-open-add").addEventListener("click", openAdd);
    const emp = document.getElementById("btn-open-add-empty");
    if (emp) emp.addEventListener("click", openAdd);
    document.getElementById("modal-add-close").addEventListener("click", closeAdd);
    document.getElementById("modal-detail-close").addEventListener("click", closeDetail);
    document.getElementById("btn-fetch").addEventListener("click", () => runSearch());

    document.getElementById("modal-add").addEventListener("click", (e) => {
      if (e.target.id === "modal-add") closeAdd();
    });
    document.getElementById("modal-detail").addEventListener("click", (e) => {
      if (e.target.id === "modal-detail") closeDetail();
    });

    document.getElementById("btn-save-plant").addEventListener("click", saveNewPlant);

    renderList();

    async function registerSw() {
      if (!("serviceWorker" in navigator)) return;
      if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1")
        return;
      try {
        const swUrl = new URL("sw.js", location.href).pathname;
        const reg = await navigator.serviceWorker.register(swUrl);
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          if (w)
            w.addEventListener("statechange", () => {
              if (w.state === "installed" && navigator.serviceWorker.controller) {
                w.postMessage({ type: "SKIP_WAITING" });
              }
            });
        });
      } catch (e) {
        console.warn("Bahçem SW:", e);
      }
    }

    registerSw();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
