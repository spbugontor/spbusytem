import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, onValue, set, push, remove, update, get, child } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// KONFIGURASI FIREBASE (project yang sama dengan MyTIC)
const firebaseConfig = {
  apiKey: "AIzaSyBBcb3lbQJQ30BZZoBV4j5l1mTwPfsVh2o",
  authDomain: "spbu-system.firebaseapp.com",
  databaseURL: "https://spbu-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "spbu-system",
  storageBucket: "spbu-system.firebasestorage.app",
  messagingSenderId: "397973887906",
  appId: "1:397973887906:web:7e7a2f502db9efa3df70fb"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, onValue, set, push, remove, update, get, child };
