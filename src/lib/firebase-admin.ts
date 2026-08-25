// Shared Firebase Admin access to the main app's Firestore project.
//
// Setup: Firebase console → Project settings → Service accounts → "Generate
// new private key", then put the JSON (as one line) in the dashboard env as
// FIREBASE_SERVICE_ACCOUNT. Callers must handle the null (not configured)
// case gracefully.

import type { Firestore } from "firebase-admin/firestore";

let initFailed = false;

export async function getAdminDb(): Promise<Firestore | null> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || initFailed) return null;
  try {
    const { initializeApp, getApps, cert } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app =
      getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(raw)) });
    return getFirestore(app);
  } catch (err) {
    // Bad JSON / bad key: report once, then behave like "not configured".
    initFailed = true;
    console.error("Firebase Admin init failed:", err);
    return null;
  }
}
