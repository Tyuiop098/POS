/* =========================================================
   app.js - shared helpers used by index / cashier / scanner
   ========================================================= */

const LS_KEYS = {
  FIREBASE_CONFIG: 'pos_firebase_config',
  STORE_CODE: 'pos_store_code',
  ROLE: 'pos_role' // 'cashier' | 'scanner'
};

function getFirebaseConfig(){
  const raw = localStorage.getItem(LS_KEYS.FIREBASE_CONFIG);
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(e){ return null; }
}

function getStoreCode(){
  return localStorage.getItem(LS_KEYS.STORE_CODE) || '';
}

function getRole(){
  return localStorage.getItem(LS_KEYS.ROLE) || '';
}

function isSetupComplete(){
  return !!getFirebaseConfig() && !!getStoreCode() && !!getRole();
}

/** Initialize firebase compat app once. Requires firebase-app-compat.js
 *  and firebase-database-compat.js to already be loaded via <script>. */
let _fbApp = null;
function initFirebase(){
  if(_fbApp) return _fbApp;
  const cfg = getFirebaseConfig();
  if(!cfg) throw new Error('ยังไม่ได้ตั้งค่า Firebase');
  _fbApp = firebase.initializeApp(cfg);
  return _fbApp;
}

function db(){
  initFirebase();
  return firebase.database();
}

function storeRef(path){
  const code = getStoreCode();
  return db().ref(`stores/${code}/${path}`);
}

function fmtMoney(n){
  const num = Number(n) || 0;
  return num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nowStamp(){
  return Date.now();
}

function goTo(page){
  window.location.href = page;
}

function requireSetupOrRedirect(){
  if(!isSetupComplete()){
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

function requireRoleOrRedirect(role){
  if(!requireSetupOrRedirect()) return false;
  if(getRole() !== role){
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

/* ---------------------------------------------------------
   Product lookup:
   1) check our own saved products in Firebase (stores/{code}/products/{barcode})
   2) fall back to Open Food Facts public API (free, no key) for the NAME only
   --------------------------------------------------------- */
async function lookupLocalProduct(barcode){
  const snap = await storeRef(`products/${barcode}`).get();
  return snap.exists() ? snap.val() : null;
}

async function lookupOpenFoodFacts(barcode){
  try{
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`);
    if(!res.ok) return null;
    const data = await res.json();
    if(data && data.status === 1 && data.product){
      const p = data.product;
      const name = p.product_name_th || p.product_name || p.generic_name || null;
      if(!name) return null;
      return { name, source: 'openfoodfacts' };
    }
    return null;
  }catch(e){
    return null;
  }
}

async function saveProduct(barcode, name, price){
  await storeRef(`products/${barcode}`).set({
    name, price: Number(price), updatedAt: nowStamp()
  });
}

/* ---------------------------------------------------------
   Cart helpers (shared realtime cart per store)
   --------------------------------------------------------- */
async function addToCart(barcode, name, price, qty){
  qty = qty || 1;
  const ref = storeRef(`cart/${barcode}`);
  const snap = await ref.get();
  if(snap.exists()){
    const cur = snap.val();
    await ref.update({ qty: (cur.qty || 0) + qty });
  } else {
    await ref.set({ barcode, name, price: Number(price), qty, addedAt: nowStamp() });
  }
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

/* ---------------------------------------------------------
   Pending scans: when the PHONE scans an item, it does NOT
   drop it straight into the cart. It pushes a "pending scan"
   which the CASHIER computer shows as a confirmation UI —
   the cashier presses "บันทึกรายการ" to actually add it.
   --------------------------------------------------------- */
async function pushPendingScan(barcode, name, price){
  const ref = storeRef('pendingScans').push();
  await ref.set({ barcode, name, price: Number(price), qty: 1, at: nowStamp() });
  return ref.key;
}

async function confirmPendingScan(key, item){
  await addToCart(item.barcode, item.name, item.price, item.qty || 1);
  await storeRef(`pendingScans/${key}`).remove();
}

async function rejectPendingScan(key){
  await storeRef(`pendingScans/${key}`).remove();
}

/* ---------------------------------------------------------
   Build a plain-text receipt (used for the on-screen preview
   and for the downloadable .txt file on the payment screen)
   --------------------------------------------------------- */
function buildReceiptText({ items, total, received, change, at }){
  const line = '----------------------------------------';
  const rows = items.map(i=>{
    const left = `${i.name} x${i.qty}`;
    const right = `฿${fmtMoney(i.price * i.qty)}`;
    return left + ' '.repeat(Math.max(1, 40 - left.length - right.length)) + right;
  }).join('\n');
  let out = `POS Mart — ใบเสร็จ\n${new Date(at || Date.now()).toLocaleString('th-TH')}\n${line}\n${rows}\n${line}\nรวมทั้งหมด: ฿${fmtMoney(total)}`;
  if(received != null){
    out += `\nรับเงินมา: ฿${fmtMoney(received)}\nเงินทอน: ฿${fmtMoney(change)}`;
  }
  return out + `\n${line}\nขอบคุณที่ใช้บริการ`;
}

function downloadTextFile(filename, text){
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
