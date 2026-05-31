const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp }  = require("firebase-admin/app");
const { getFirestore }   = require("firebase-admin/firestore");
const { getMessaging }   = require("firebase-admin/messaging");

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

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

      // Bahçe bazında grupla
      const byGarden = {};
      for (const p of overdue) {
        if (!byGarden[p.gardenName]) byGarden[p.gardenName] = [];
        byGarden[p.gardenName].push(p.name);
      }
      const gardens = Object.keys(byGarden);
      const title = "🌿 Bahçem — Sulama Zamanı";
      let body, url;

      if (gardens.length === 1) {
        const gName = gardens[0];
        const names = byGarden[gName];
        const preview = names.slice(0,2).join(", ") + (names.length > 2 ? ` +${names.length-2}` : "");
        body = `${gName}: ${preview} sulama bekliyor 💧`;
        url  = `https://salimoglu.github.io/bahcem/?garden=${overdue[0].gardenId}`;
      } else {
        body = gardens.map(g => `${g}: ${byGarden[g].length} bitki`).join(" • ") + " 💧";
        url  = "https://salimoglu.github.io/bahcem/";
      }

      try {
        await fcm.send({
          token,
          webpush: {
            notification: { title, body,
              icon: "https://salimoglu.github.io/bahcem/icons/icon-192.png",
              requireInteraction: true,
              tag: "bahcem-water"
            },
            data: { url },
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
