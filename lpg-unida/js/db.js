import { db, ref, get, set, push, update, remove, onValue, query, orderByChild, equalTo, DB_PREFIX } from './firebase-config.js';

// Helper to get formatted ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// SETTINGS (Global Harga & Stok)
export async function getSettings() {
    const snap = await get(ref(db, `${DB_PREFIX}/settings`));
    if(snap.exists()) return snap.val();
    return { lpg_price: 18000, lpg_stock: 0 };
}

export async function saveSettings(price, stock) {
    await set(ref(db, `${DB_PREFIX}/settings`), { lpg_price: price, lpg_stock: stock });
}

export function listenSettings(callback) {
    onValue(ref(db, `${DB_PREFIX}/settings`), (snap) => {
        callback(snap.val() || { lpg_price: 18000, lpg_stock: 0 });
    });
}

// LOCATIONS
export async function getLocations() {
    const snap = await get(ref(db, `${DB_PREFIX}/locations`));
    if(!snap.exists()) return [];
    return Object.keys(snap.val()).map(k => ({ id: k, ...snap.val()[k] }));
}

export async function addLocation(name) {
    const newRef = push(ref(db, `${DB_PREFIX}/locations`));
    await set(newRef, { name });
}

export async function deleteLocation(id) {
    await remove(ref(db, `${DB_PREFIX}/locations/${id}`));
}

// USERS
export async function getUsers() {
    const snap = await get(ref(db, `${DB_PREFIX}/users`));
    if(!snap.exists()) return [];
    return Object.keys(snap.val()).map(k => ({ id: k, ...snap.val()[k] }));
}

export async function getUserByPhone(wa_number) {
    const q = query(ref(db, `${DB_PREFIX}/users`), orderByChild('wa_number'), equalTo(wa_number));
    const snap = await get(q);
    if(snap.exists()) {
        const val = snap.val();
        const key = Object.keys(val)[0];
        return { id: key, ...val[key] };
    }
    return null;
}

export async function registerUser(name, wa_number, pin, location_id, location_name) {
    const exists = await getUserByPhone(wa_number);
    if(exists) throw new Error("Nomor WA sudah terdaftar!");
    
    const newRef = push(ref(db, `${DB_PREFIX}/users`));
    await set(newRef, {
        name, wa_number, pin, location_id, location_name, role: 'customer', status: 'pending', created_at: Date.now()
    });
    return { id: newRef.key, name, wa_number, role: 'customer' };
}

export async function approveUser(id) {
    await update(ref(db, `${DB_PREFIX}/users/${id}`), { status: 'approved' });
}

export async function deleteUser(id) {
    await remove(ref(db, `${DB_PREFIX}/users/${id}`));
}

export async function updateAdminPin(newPin) {
    // Simulating admin user at a specific node
    await set(ref(db, `${DB_PREFIX}/admin_pin`), newPin);
}

export async function getAdminPin() {
    const snap = await get(ref(db, `${DB_PREFIX}/admin_pin`));
    return snap.exists() ? snap.val() : '123456';
}

// ORDERS
export function listenOrders(callback) {
    onValue(ref(db, `${DB_PREFIX}/orders`), async (snap) => {
        if(!snap.exists()) { callback([]); return; }
        
        // Populate with user details if needed, or assume they are saved with order
        const orders = [];
        const val = snap.val();
        for(let k in val) {
            orders.push({ id: k, ...val[k] });
        }
        // sort descending
        orders.sort((a,b) => b.created_at - a.created_at);
        callback(orders);
    });
}

export async function getOrdersByUser(user_id) {
    const q = query(ref(db, `${DB_PREFIX}/orders`), orderByChild('user_id'), equalTo(user_id));
    const snap = await get(q);
    if(!snap.exists()) return [];
    
    const orders = [];
    const val = snap.val();
    for(let k in val) {
        orders.push({ id: k, ...val[k] });
    }
    orders.sort((a,b) => b.created_at - a.created_at);
    return orders;
}

export async function createOrder(user_id, user_name, location_name, qty_requested) {
    const s = await getSettings();
    const price = parseInt(s.lpg_price || 0);
    const stock = parseInt(s.lpg_stock || 0);
    
    // Potong stok di awal
    await saveSettings(price, stock - qty_requested);
    
    const newRef = push(ref(db, `${DB_PREFIX}/orders`));
    await set(newRef, {
        user_id,
        user_name,
        location_name,
        qty_requested,
        qty_approved: null,
        price_per_item: price,
        total_price: 0,
        status: 'Menunggu Persetujuan',
        payment_status: 'belum bayar',
        created_at: Date.now()
    });
}

export async function processOrder(order_id, action, qty_requested, qty_approved) {
    // action: ditolak, lunas, bon
    let status = 'Disetujui';
    let payment = action;
    let total = 0;
    
    const s = await getSettings();
    const currentStock = parseInt(s.lpg_stock || 0);

    if (action === 'ditolak') {
        status = 'Ditolak';
        qty_approved = 0;
    } else {
        total = qty_approved * parseInt(s.lpg_price || 0);
    }
    
    // Refund stok jika qty_approved < qty_requested
    const diff = qty_requested - qty_approved;
    if (diff > 0) {
        await saveSettings(s.lpg_price, currentStock + diff);
    }
    
    const updateData = {
        status,
        payment_status: payment,
        qty_approved,
        total_price: total
    };
    if (action === 'lunas') {
        updateData.paid_at = Date.now();
    }
    
    await update(ref(db, `${DB_PREFIX}/orders/${order_id}`), updateData);
}

export async function deleteOrder(order_id) {
    const snap = await get(ref(db, `${DB_PREFIX}/orders/${order_id}`));
    if(snap.exists()) {
        const order = snap.val();
        if(order.status === 'Menunggu Persetujuan') {
            const s = await getSettings();
            await saveSettings(s.lpg_price, parseInt(s.lpg_stock || 0) + parseInt(order.qty_requested));
        }
    }
    await remove(ref(db, `${DB_PREFIX}/orders/${order_id}`));
}

// Rekapan
export async function payBon(order_id) {
    await update(ref(db, `${DB_PREFIX}/orders/${order_id}`), {
        payment_status: 'lunas',
        paid_at: Date.now()
    });
}
