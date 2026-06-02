const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp }  = require("firebase-admin/app");
const { getFirestore }   = require("firebase-admin/firestore");
const { getMessaging }   = require("firebase-admin/messaging");

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

const APP_URL = "https://salimoglu.github.io/bahcem/";
const MAX_BODY_LEN = 280;

/** Bahçe → bitki adları listesinden bildirim metni üretir */
function formatNotifBody(byGarden) {
  const parts = [];
  let len = 0;
  const gardenNames = Object.keys(byGarden);

  for (let i = 0; i < gardenNames.length; i++) {
    const gName = gardenNames[i];
    const names = byGarden[gName];
    let segment;

    if (names.length === 1) {
      segment = `${gName}: ${names[0]}`;
    } else if (names.length <= 4) {
      segment = `${gName}: ${names.join(", ")}`;
    } else {
      segment = `${gName} (${names.length} bitki): ${names.slice(0, 3).join(", ")} +${names.length - 3}`;
    }

    const sep = parts.length ? " · " : "";
    if (len + sep.length + segment.length > MAX_BODY_LEN) {
      const left = gardenNames.length - i;
      if (left > 0) parts.push(`+${left} bahçe daha`);
      break;
    }
    parts.push(segment);
    len += sep.length + segment.length;
  }

  return parts.join(" · ") + " 💧";
}

exports.sulamaKontrol = onSchedule(
  { schedule: "0 * * * *", timeZone: "Europe/Istanbul", region: "europe-west1" },
  async () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
    const currentHour = now.getHours();
    console.log(`Saat: ${currentHour}`);

    const tokensSnap = await db.collection("fcm_tokens").get();
    console.log(`Token sayısı: ${tokensSnap.size}`);

    for (const tokenDoc of tokensSnap.docs) {
      const { uid, token } = tokenDoc.data();
      if (!uid || !token) continue;

      const gardensSnap = await db.collection("users").doc(uid).collection("gardens").get();
      const overdue = [];
      let targetGardenId = null;

      for (const gDoc of gardensSnap.docs) {
        const g = gDoc.data();
        if (!g.notifOn) continue;
        if ((g.notifHour ?? 8) !== currentHour) continue;
        targetGardenId = gDoc.id;

        const plantsSnap = await db.collection("users").doc(uid)
          .collection("gardens").doc(gDoc.id).collection("plants").get();

        for (const pDoc of plantsSnap.docs) {
          const p = pDoc.data();
          const days = Math.max(1, Number(p.wateringIntervalDays) || 7);
          const base = p.lastWateredAt ? new Date(p.lastWateredAt).getTime() : new Date(p.createdAt || Date.now()).getTime();
          if (Date.now() >= base + days * 86400000) {
            overdue.push({ name: p.nameTr || "Bitki", gardenName: g.name || "Bahçe", gardenId: gDoc.id });
          }
        }
      }

      if (!overdue.length) { console.log(`${uid}: sulanmamış bitki yok`); continue; }

      const byGarden = {};
      for (const p of overdue) {
        if (!byGarden[p.gardenName]) byGarden[p.gardenName] = [];
        byGarden[p.gardenName].push(p.name);
      }

      const title = "🌿 Bahçem — Sulama Zamanı";
      const body  = formatNotifBody(byGarden);

      // En çok sulanması gereken bitki olan bahçeye yönlendir
      const countByGarden = {};
      for (const p of overdue) {
        countByGarden[p.gardenId] = (countByGarden[p.gardenId] || 0) + 1;
      }
      const primaryGardenId = Object.entries(countByGarden)
        .sort((a, b) => b[1] - a[1])[0][0];
      const url = `${APP_URL}?garden=${primaryGardenId}`;

      try {
        await fcm.send({
          token,
          notification: { title, body },
          data: { title, body, url, garden: primaryGardenId },
          android: {
            notification: {
              title, body,
              icon: "ic_notification",
              clickAction: "FLUTTER_NOTIFICATION_CLICK"
            }
          },
          webpush: {
            notification: { title, body,
              icon: "https://salimoglu.github.io/bahcem/icons/icon-192.png",
              requireInteraction: true
            },
            data: { url, title, body, garden: primaryGardenId },
            fcmOptions: { link: url }
          }
        });
        console.log(`✓ ${uid}: ${body}`);
      } catch (err) {
        console.error(`✗ ${uid}: ${err.message}`);
        if (err.code === "messaging/registration-token-not-registered") await tokenDoc.ref.delete();
      }
    }
  }
);
