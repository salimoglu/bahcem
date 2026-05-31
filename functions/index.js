const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp }  = require("firebase-admin/app");
const { getFirestore }   = require("firebase-admin/firestore");
const { getMessaging }   = require("firebase-admin/messaging");

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

// Her gün sabah 08:00 (Türkiye = UTC+3 → UTC 05:00)
exports.sulamaKontrol = onSchedule(
  { schedule: "0 5 * * *", timeZone: "Europe/Istanbul", region: "europe-west1" },
  async () => {
    const usersSnap = await db.collection("users").get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // FCM token'ı al
      const tokenDoc = await db.collection("users").doc(uid).collection("settings").doc("fcm").get();
      const token = tokenDoc.exists ? tokenDoc.data().token : null;
      if (!token) continue;

      // Tüm bahçeleri tara
      const gardensSnap = await db.collection("users").doc(uid).collection("gardens").get();
      const overdueAll = [];

      for (const gardenDoc of gardensSnap.docs) {
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
              name: p.nameTr || p.nick || "Bitki",
              late: Math.abs(diffDays),
              gardenName: gardenDoc.data().name || "Bahçe"
            });
          }
        }
      }

      if (overdueAll.length === 0) continue;

      // Bildirim mesajı oluştur
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
          notification: {
            title: "🌿 Bahçem — Sulama Zamanı",
            body
          },
          webpush: {
            notification: {
              icon: "https://salimoglu.github.io/bahcem/icons/icon-192.png",
              badge: "https://salimoglu.github.io/bahcem/icons/icon-192.png",
              requireInteraction: true,
              tag: "bahcem-water"
            },
            fcmOptions: {
              link: "https://salimoglu.github.io/bahcem/"
            }
          }
        });
        console.log(`✓ Bildirim gönderildi: ${uid} → ${count} bitki`);
      } catch (err) {
        console.warn(`✗ ${uid}: ${err.message}`);
        // Geçersiz token → sil
        if (err.code === "messaging/registration-token-not-registered") {
          await db.collection("users").doc(uid).collection("settings").doc("fcm").delete();
        }
      }
    }
  }
);
// deploy trigger Sun May 31 14:29:39 UTC 2026
