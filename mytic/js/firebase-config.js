import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, onValue, set, push, remove, update, get, child } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// KONFIGURASI FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyD5igspuFUZzbCb8nUTUE2EKG8m2eopJgc",
  authDomain: "mytic-38cc8.firebaseapp.com",
  databaseURL: "https://mytic-38cc8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mytic-38cc8",
  storageBucket: "mytic-38cc8.firebasestorage.app",
  messagingSenderId: "771809724207",
  appId: "1:771809724207:web:9fc8d944cd9215167703da"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export { app, db, auth, ref, onValue, set, push, remove, update, get, child, signInWithEmailAndPassword, signOut, onAuthStateChanged, browserLocalPersistence, setPersistence };
