const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp }  = require("firebase-admin/app");
const { getFirestore }   = require("firebase-admin/firestore");
const { getMessaging }   = require("firebase-admin/messaging");

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

// Her saat başı çalışır
exports.sulamaKontrol = onSchedule(
  { schedule: "0 * * * *", timeZone: "Europe/Istanbul", region: "europe-west1" },
  async () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
    const currentHour = now.getHours();


    const usersSnap = await db.collection("users").get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // FCM token
      const tokenDoc = await db.collection("users").doc(uid)
        .collection("settings").doc("fcm").get();
      const token = tokenDoc.exists ? tokenDoc.data().token : null;
      if (!token) continue;

      // Tüm bahçeleri tara - sadece bildirimi açık ve bu saatte olanları
      const gardensSnap = await db.collection("users").doc(uid).collection("gardens").get();
      const overdueAll = [];

      for (const gardenDoc of gardensSnap.docs) {
        const g = gardenDoc.data();

        // Bahçede bildirim kapalıysa atla
        if (!g.notifOn) continue;

        // Bu bahçenin bildirimi bu saat ve dakikada mı?
        const gardenHour = g.notifHour ?? 8;
        if (gardenHour !== currentHour) continue;

        const plantsSnap = await db
          .collection("users").doc(uid)
          .collection("gardens").doc(gardenDoc.id)
          .collection("plants").get();

        for (const plantDoc of plantsSnap.docs) {
          const p = plantDoc.data();
          const days = Math.max(1, Number(p.wateringIntervalDays) || 7);
          const base = p.lastWateredAt
            ? new Date(p.lastWateredAt).getTime()
            : new Date(p.createdAt || Date.now()).getTime();
          const next = base + days * 86400000;
          const diffDays = Math.round((next - Date.now()) / 86400000);

          if (diffDays <= 0) {
            overdueAll.push({
              name: p.nameTr || "Bitki",
              late: Math.abs(diffDays),
              gardenName: g.name || "Bahçe"
            });
          }
        }
      }

      if (overdueAll.length === 0) continue;

      const count = overdueAll.length;
      let body;
      if (count === 1) {
        const p = overdueAll[0];
        body = p.late === 0
          ? `${p.name} bugün sulanmalı 💧`
          : `${p.name} ${p.late} gündür sulanmadı 💧`;
      } else {
        const names = overdueAll.slice(0, 2).map(p => p.name).join(", ");
        const more  = count > 2 ? ` +${count - 2}` : "";
        body = `${names}${more} sulama bekliyor 💧`;
      }

      try {
        await fcm.send({
          token,
          notification: { title: "🌿 Bahçem — Sulama Zamanı", body },
          webpush: {
            notification: {
              icon: "https://salimoglu.github.io/bahcem/icons/icon-192.png",
              badge: "https://salimoglu.github.io/bahcem/icons/icon-192.png",
              requireInteraction: true,
              tag: "bahcem-water"
            },
            fcmOptions: { link: "https://salimoglu.github.io/bahcem/" }
          }
        });
        console.log(`✓ ${uid} → saat ${currentHour}:00, ${count} bitki`);
      } catch (err) {
        console.warn(`✗ ${uid}: ${err.message}`);
        if (err.code === "messaging/registration-token-not-registered") {
          await db.collection("users").doc(uid).collection("settings").doc("fcm").delete();
        }
      }
    }
  }
);
