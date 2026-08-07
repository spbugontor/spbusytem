import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, get, set, push, update, remove, onValue, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

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

// Prefix khusus untuk aplikasi LPG agar tidak bentrok dengan MyTIC
const DB_PREFIX = 'lpg_app';

export { db, ref, get, set, push, update, remove, onValue, query, orderByChild, equalTo, DB_PREFIX };
