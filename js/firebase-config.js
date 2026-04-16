// ============================================================
//  Season Tix — Firebase Configuration
//  Replace ALL placeholder values with your project's config.
//  Find it in: Firebase Console → Project Settings → Your apps
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC3dP1U3vjwixn-lFfEpMNn0pMqxQXFmEI",
  authDomain: "season-tickets-29f1b.firebaseapp.com",
  projectId: "season-tickets-29f1b",
  storageBucket: "season-tickets-29f1b.firebasestorage.app",
  messagingSenderId: "478872203449",
  appId: "1:478872203449:web:367a428f87598d545c6b68"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
