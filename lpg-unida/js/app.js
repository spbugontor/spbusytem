import * as dbApi from './db.js';

// Authentication Helpers
export function setUser(user) {
    localStorage.setItem('lpg_user', JSON.stringify(user));
}

export function getUser() {
    const u = localStorage.getItem('lpg_user');
    return u ? JSON.parse(u) : null;
}

export function logout() {
    localStorage.removeItem('lpg_user');
    window.location.href = 'index.html'; // Assuming index.html is the login
}

// Formatting Helpers
export function formatRp(num) {
    return 'Rp ' + Number(num).toLocaleString('id-ID');
}

export function formatDate(timestamp) {
    if (!timestamp) return '-';
    const d = new Date(timestamp);
    return d.toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// Global scope for HTML onclick access
window.getUser = getUser;
window.setUser = setUser;
window.logout = logout;
window.formatRp = formatRp;
window.formatDate = formatDate;
window.dbApi = dbApi; 

// API Call Bridge (Menerjemahkan rute Node.js lama ke pemanggilan Firebase)
export async function apiCall(endpoint, method = 'GET', data = null) {
    if (endpoint === '/settings' && method === 'GET') {
        return await dbApi.getSettings();
    }
    if (endpoint === '/admin/settings' && method === 'POST') {
        return await dbApi.saveSettings(data.lpg_price, data.lpg_stock);
    }
    if (endpoint === '/locations' && method === 'GET') {
        return await dbApi.getLocations();
    }
    if (endpoint === '/admin/locations' && method === 'POST') {
        return await dbApi.addLocation(data.name);
    }
    if (endpoint.startsWith('/admin/locations/') && method === 'DELETE') {
        const id = endpoint.split('/').pop();
        return await dbApi.deleteLocation(id);
    }
    if (endpoint === '/admin/users' && method === 'GET') {
        return await dbApi.getUsers();
    }
    if (endpoint === '/admin/users/create' && method === 'POST') {
        return await dbApi.registerUser(data.name, data.wa_number, data.pin, data.location_id, data.location_name);
    }
    if (endpoint.startsWith('/admin/users/') && method === 'PUT') {
        const id = endpoint.split('/').pop();
        return await dbApi.update(dbApi.ref(dbApi.db, `${dbApi.DB_PREFIX}/users/${id}`), data);
    }
    if (endpoint.startsWith('/admin/users/') && method === 'DELETE') {
        const id = endpoint.split('/').pop();
        return await dbApi.deleteUser(id);
    }
    if (endpoint.startsWith('/admin/user-details/')) {
        return { pinHistory: [] }; 
    }
    if (endpoint === '/login' && method === 'POST') {
        const u = await dbApi.getUserByPhone(data.wa_number);
        if(!u) throw new Error("Nomor WA tidak terdaftar");
        // Simplified login
        if(u.pin !== data.pin) throw new Error("PIN Salah");
        if(u.status !== 'approved' && u.role !== 'admin') throw new Error("Akun belum disetujui Admin.");
        return { user: u };
    }
    if (endpoint === '/register' && method === 'POST') {
        return await dbApi.registerUser(data.name, data.wa_number, data.pin, data.location_id, data.location_name);
    }
    if (endpoint === '/customer/change-pin' && method === 'POST') {
        if(data.user_id === 1 || data.user_id === "admin") { 
            await dbApi.updateAdminPin(data.new_pin);
        } else {
            await dbApi.update(dbApi.ref(dbApi.db, `${dbApi.DB_PREFIX}/users/${data.user_id}`), { pin: data.new_pin });
        }
        return { success: true };
    }
    if (endpoint === '/admin/orders' && method === 'GET') {
        return [];
    }
    if (endpoint === '/customer/orders' && method === 'POST') {
        return await dbApi.createOrder(data.user_id, data.user_name, data.location_name, data.qty_requested);
    }
    if (endpoint.startsWith('/customer/orders/') && method === 'GET') {
        const user_id = endpoint.split('/').pop();
        const orders = await dbApi.getOrdersByUser(user_id);
        const bonOrders = orders.filter(o => (o.payment_status==='bon' || o.payment_status==='belum bayar') && o.status !== 'Menunggu Persetujuan' && o.status !== 'Ditolak');
        const total_bon = bonOrders.reduce((sum, o) => sum + parseInt(o.total_price||0), 0);
        return { orders, total_bon: total_bon || 0 };
    }
    if (endpoint.startsWith('/admin/orders/') && method === 'POST') {
        const id = endpoint.split('/').pop();
        return await dbApi.processOrder(id, data.action, data.qty_requested, data.qty_approved);
    }
    if (endpoint.startsWith('/admin/orders/') && method === 'DELETE') {
        const id = endpoint.split('/').pop();
        return await dbApi.deleteOrder(id);
    }
    if (endpoint.startsWith('/admin/pay-bon/') && method === 'POST') {
        const id = endpoint.split('/').pop();
        return await dbApi.payBon(id);
    }
    throw new Error("Endpoint Firebase belum diatur: " + endpoint);
}
window.apiCall = apiCall;

if (window.initApp) {
    window.initApp();
}
