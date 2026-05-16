
const GARDEN_EMOJIS = [
  // Ev & Mekan
  "🏡","🏘️","🏠","🏚️","🏗️","🏕️","⛺","🛖","🏰","🏯",
  // Bahçe & Doğa
  "🌿","🌱","🪴","🌲","🌳","🌴","🌵","🌾","🍀","🍃","🍂","🍁",
  // Çiçek
  "🌸","🌺","🌻","🌹","🌷","💐","🌼","🪷",
  // Tarla & Bağ & Bostan
  "🌾","🫘","🌽","🥬","🥦","🥕","🧅","🧄","🫛","🫚",
  "🍇","🍓","🫐","🍒","🍑","🍎","🍊","🍋","🥝","🍅",
  "🚜","⛏️","🪣","🌊","💧","☀️","🌤️","🌈","🪨","🪵",
  // Hayvan & Böcek
  "🐝","🦋","🐛","🐞","🌏","🌍"
];

async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  try {
    await navigator.serviceWorker.register("sw.js");
    // İzin zaten varsa token'ı yenile
    if (Notification.permission === "granted") {
      await saveFcmToken();
    }
  } catch(e) { console.warn("SW:", e); }
}

async function requestNotifPermission() {
  if (!("Notification" in window)) {
    toast("Bu tarayıcı bildirimleri desteklemiyor"); return;
  }
  if (Notification.permission === "denied") {
    toast("Bildirimler engellendi — tarayıcı ayarlarından izin verin"); return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return;
  await saveFcmToken();
  toast("✅ Bildirimler açık! Sulama zamanı gelince haber vereceğiz.");
  updateNotifStatus();
}

async function saveFcmToken() {
  if (!currentUser) return;
  try {
    const messaging = firebase.messaging();
    const swReg = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: swReg });
    if (token) {
      await db.collection("users").doc(currentUser.uid)
        .collection("settings").doc("fcm")
        .set({ token, updatedAt: new Date().toISOString() });
    }
  } catch(e) { console.warn("FCM token alınamadı:", e.message); }
}

function updateNotifStatus() {
  const st  = document.getElementById("notif-status-text");
  const btn = document.getElementById("btn-notif-toggle");
  if (!st || !btn) return;
  if (!("Notification" in window)) {
    st.textContent = "❌ Bu tarayıcı bildirimleri desteklemiyor";
    btn.style.display = "none"; return;
  }
  if (Notification.permission === "granted") {
    st.textContent = "✅ Bildirimler açık — Her sabah 08:00'de kontrol edilir";
    btn.style.display = "none";
  } else if (Notification.permission === "denied") {
    st.textContent = "🚫 Engellendi — Tarayıcı ayarlarından izin verin";
    btn.style.display = "none";
  } else {
    st.textContent = "🔔 Bildirimler kapalı";
    btn.style.display = "inline-flex";
    btn.onclick = async () => { await requestNotifPermission(); };
  }
}
