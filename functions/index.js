const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp }  = require("firebase-admin/app");
const { getFirestore }   = require("firebase-admin/firestore");
const { getMessaging }   = require("firebase-admin/messaging");

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

const APP_URL = "https://salimoglu.github.io/bahcem/";
const MAX_BODY_LEN = 280;

/** Sulama zamanı gelmiş bitkiler (gecikmiş veya bugün — yarın dahil değil) */
function plantNeedsWater(p) {
  const days = Math.max(1, Number(p.wateringIntervalDays) || 7);
  if (!p.lastWateredAt) return true;
  const base = new Date(p.lastWateredAt).getTime();
  return Date.now() >= base + days * 86400000;
}

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

function istanbulHour() {
  return Number(new Date().toLocaleString("en-US", {
    timeZone: "Europe/Istanbul",
    hour: "numeric",
    hour12: false
  }));
}

async function sendPush(token, { title, body, url, garden }) {
  await fcm.send({
    token,
    notification: { title, body },
    data: {
      title: String(title),
      body:  String(body),
      url:   String(url),
      garden: String(garden || "")
    },
    webpush: {
      notification: {
        title,
        body,
        icon: "https://salimoglu.github.io/bahcem/icons/icon-192.png",
        requireInteraction: true
      },
      data: { url, title, body, garden: String(garden || "") },
      fcmOptions: { link: url }
    }
  });
}

exports.sulamaKontrol = onSchedule(
  { schedule: "0 * * * *", timeZone: "Europe/Istanbul", region: "europe-west1" },
  async () => {
    const currentHour = istanbulHour();
    console.log(`Saat (İstanbul): ${currentHour}`);

    const tokensSnap = await db.collection("fcm_tokens").get();
    console.log(`Token sayısı: ${tokensSnap.size}`);

    for (const tokenDoc of tokensSnap.docs) {
      const { uid, token } = tokenDoc.data();
      if (!uid || !token) {
        console.log(`Token doc ${tokenDoc.id}: uid/token eksik, atlandı`);
        continue;
      }

      const gardensSnap = await db.collection("users").doc(uid).collection("gardens").get();
      const overdue = [];

      for (const gDoc of gardensSnap.docs) {
        const g = gDoc.data();
        const gName = g.name || gDoc.id;

        if (!g.notifOn) {
          console.log(`${uid}/${gName}: bildirim kapalı (notifOn=false), atlandı`);
          continue;
        }

        const gHour = g.notifHour ?? 8;
        if (gHour !== currentHour) {
          console.log(`${uid}/${gName}: saat ${gHour} ≠ ${currentHour}, atlandı`);
          continue;
        }

        const plantsSnap = await db.collection("users").doc(uid)
          .collection("gardens").doc(gDoc.id).collection("plants").get();

        let gardenDue = 0;
        for (const pDoc of plantsSnap.docs) {
          const p = pDoc.data();
          if (plantNeedsWater(p)) {
            gardenDue++;
            overdue.push({
              name: p.nameTr || "Bitki",
              gardenName: gName,
              gardenId: gDoc.id
            });
          }
        }
        console.log(`${uid}/${gName}: ${gardenDue}/${plantsSnap.size} bitki sulama bekliyor`);
      }

      if (!overdue.length) {
        console.log(`${uid}: bildirim gönderilmedi — bahçe saati/notifOn kontrol edin veya bitki henüz listede değil`);
        continue;
      }

      const byGarden = {};
      for (const p of overdue) {
        if (!byGarden[p.gardenName]) byGarden[p.gardenName] = [];
        byGarden[p.gardenName].push(p.name);
      }

      const title = "🌿 Bahçem — Sulama Zamanı";
      const body  = formatNotifBody(byGarden);

      const countByGarden = {};
      for (const p of overdue) {
        countByGarden[p.gardenId] = (countByGarden[p.gardenId] || 0) + 1;
      }
      const primaryGardenId = Object.entries(countByGarden)
        .sort((a, b) => b[1] - a[1])[0][0];
      const url = `${APP_URL}?garden=${primaryGardenId}`;

      try {
        await sendPush(token, { title, body, url, garden: primaryGardenId });
        console.log(`✓ ${uid}: ${body}`);
      } catch (err) {
        console.error(`✗ ${uid}: ${err.message}`);
        if (err.code === "messaging/registration-token-not-registered") {
          await tokenDoc.ref.delete();
        }
      }
    }
  }
);
