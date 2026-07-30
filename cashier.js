/* =========================================================
   cashier.js - logic for cashier.html (computer screen)
   ========================================================= */
if(requireRoleOrRedirect('cashier')){
  document.getElementById('storeCodeLabel').textContent = 'ร้าน: ' + getStoreCode();
  document.getElementById('codeBig').textContent = getStoreCode();

  document.getElementById('resetBtn').addEventListener('click', ()=>{
    if(confirm('ล้างการตั้งค่าของเครื่องนี้และเริ่มใหม่?')){
      localStorage.clear();
      goTo('index.html');
    }
  });

  /* ---------------- tabs ---------------- */
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p=>p.style.display='none');
      document.getElementById('tab-' + btn.dataset.tab).style.display='block';
      if(btn.dataset.tab === 'sales') loadSales();
      if(btn.dataset.tab === 'pos') document.getElementById('manualBarcode').focus();
    });
  });

  // keep the barcode field focused & ready so a scanner plugged into
  // this computer (keyboard-wedge) can just scan — types the code + Enter,
  // and the item is added straight away, no confirm click needed.
  document.getElementById('manualBarcode').focus();

  /* ---------------- cart (realtime) ---------------- */
  let cartData = {};

  storeRef('cart').on('value', (snap)=>{
    cartData = snap.val() || {};
    renderCart();
  });

  function renderCart(){
    const body = document.getElementById('cartBody');
    const items = Object.values(cartData);
    if(items.length === 0){
      body.innerHTML = `<div class="empty-cart"><div class="big">🛒</div>ยังไม่มีสินค้าในตะกร้า<br><span style="font-size:12px;">สแกนจากมือถือ หรือพิมพ์บาร์โค้ดด้านขวา</span></div>`;
    } else {
      body.innerHTML = items.map(it => `
        <div class="cart-row">
          <div>
            <div class="name">${escapeHtml(it.name)}</div>
            <div class="barcode">${escapeHtml(it.barcode)}</div>
          </div>
          <div class="num">฿${fmtMoney(it.price)}</div>
          <div class="qty-ctrl">
            <button data-act="dec" data-code="${it.barcode}">–</button>
            <span>${it.qty}</span>
            <button data-act="inc" data-code="${it.barcode}">+</button>
          </div>
          <div class="row-total">฿${fmtMoney(it.price * it.qty)}</div>
          <div><button class="del-btn" data-act="del" data-code="${it.barcode}">✕</button></div>
        </div>
      `).join('');
    }

    const count = items.length;
    const qty = items.reduce((s,i)=>s+i.qty,0);
    const total = items.reduce((s,i)=>s+i.price*i.qty,0);
    document.getElementById('sumCount').textContent = count;
    document.getElementById('sumQty').textContent = qty;
    document.getElementById('ledTotal').textContent = fmtMoney(total);
  }

  document.getElementById('cartBody').addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-act]');
    if(!btn) return;
    const code = btn.dataset.code;
    const act = btn.dataset.act;
    const ref = storeRef(`cart/${code}`);
    const cur = cartData[code];
    if(!cur) return;
    if(act === 'inc'){ await ref.update({ qty: cur.qty + 1 }); }
    else if(act === 'dec'){
      if(cur.qty <= 1){ await ref.remove(); } else { await ref.update({ qty: cur.qty - 1 }); }
    } else if(act === 'del'){ await ref.remove(); }
  });

  document.getElementById('clearCartBtn').addEventListener('click', async ()=>{
    if(Object.keys(cartData).length === 0) return;
    if(confirm('ล้างตะกร้าทั้งหมด?')) await storeRef('cart').remove();
  });

  /* ---------------- manual add by typing barcode ---------------- */
  document.getElementById('manualAddBtn').addEventListener('click', handleManualAdd);
  document.getElementById('manualBarcode').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') handleManualAdd();
  });

  async function handleManualAdd(){
    const input = document.getElementById('manualBarcode');
    const code = input.value.trim();
    if(!code) return;
    const product = await lookupLocalProduct(code);
    if(product){
      await addToCart(code, product.name, product.price, 1);
      input.value = '';
      input.focus();
      return;
    }
    input.value = '';
    const ext = await lookupExternalProduct(code);
    openProductModal({ barcode: code, name: (ext && ext.name) || '', price: (ext && ext.price != null) ? ext.price : '' }, async (barcode, name, price)=>{
      await saveProduct(barcode, name, price);
      await addToCart(barcode, name, price, 1);
    });
  }

  /* ---------------- payment screen ---------------- */
  const paymentModal = document.getElementById('paymentModal');
  const payItemsEl = document.getElementById('payItems');
  const payTotalEl = document.getElementById('payTotal');
  const payReceivedEl = document.getElementById('payReceived');
  const payChangeEl = document.getElementById('payChange');
  const payErrEl = document.getElementById('payErr');
  const payReceiptWrap = document.getElementById('payReceiptWrap');
  const payReceiptBody = document.getElementById('payReceiptBody');

  let paySale = null;      // filled once payment is confirmed (items/total snapshot)
  let payReceiptShown = false; // F3 press #1 (preview) vs press #2 (download)
  let paySpaceArmed = false;   // Space press #1 (show change) vs press #2 (confirm payment)

  function openPaymentScreen(){
    const items = Object.values(cartData);
    if(items.length === 0){ alert('ยังไม่มีสินค้าในตะกร้า'); return; }
    const total = items.reduce((s,i)=>s+i.price*i.qty,0);

    paySale = null;
    payReceiptShown = false;
    paySpaceArmed = false;
    payReceiptWrap.style.display = 'none';
    payErrEl.style.display = 'none';
    payReceivedEl.value = '';
    payChangeEl.textContent = '฿0.00';

    payItemsEl.innerHTML = items.map(i=>`
      <div class="pay-item-row">
        <div>
          <div class="nm">${escapeHtml(i.name)}</div>
          <div class="meta">฿${fmtMoney(i.price)} x ${i.qty}</div>
        </div>
        <div class="amt">฿${fmtMoney(i.price * i.qty)}</div>
      </div>
    `).join('');
    payTotalEl.textContent = fmtMoney(total);

    paymentModal.style.display = 'flex';
    payReceivedEl.focus();
  }

  function closePaymentScreen(){
    paymentModal.style.display = 'none';
    paySale = null;
    payReceiptShown = false;
    paySpaceArmed = false;
  }

  function currentCartTotal(){
    return Object.values(cartData).reduce((s,i)=>s+i.price*i.qty,0);
  }

  function updateChangeDisplay(){
    const total = paySale ? paySale.total : currentCartTotal();
    const received = parseFloat(payReceivedEl.value);
    if(isNaN(received)){ payChangeEl.textContent = '฿0.00'; return; }
    const change = received - total;
    payChangeEl.textContent = (change < 0 ? '-' : '') + '฿' + fmtMoney(Math.abs(change));
  }
  payReceivedEl.addEventListener('input', ()=>{
    paySpaceArmed = false; // amount changed — need to re-check the change before it can be confirmed again
    updateChangeDisplay();
  });

  async function confirmPayment(){
    const items = Object.values(cartData);
    if(items.length === 0){ alert('ยังไม่มีสินค้าในตะกร้า'); return; }
    const total = items.reduce((s,i)=>s+i.price*i.qty,0);
    const received = parseFloat(payReceivedEl.value);
    if(isNaN(received) || received < total){
      payErrEl.textContent = 'กรุณาใส่จำนวนเงินที่ลูกค้าให้มา (ต้องไม่น้อยกว่ายอดรวม) — กด F2';
      payErrEl.style.display = 'block';
      return;
    }
    payErrEl.style.display = 'none';
    const at = nowStamp();
    const change = received - total;
    await storeRef('sales').push({ items, total, received, change, at });
    await storeRef('cart').remove();
    paySale = { items, total, received, change, at };
  }

  document.getElementById('checkoutBtn').addEventListener('click', openPaymentScreen);
  document.getElementById('payCloseBtn').addEventListener('click', closePaymentScreen);
  document.getElementById('payConfirmBtn').addEventListener('click', confirmPayment);
  payReceivedEl.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') confirmPayment(); });

  function showReceiptPreview(){
    if(!paySale){
      payErrEl.textContent = 'กรุณายืนยันการชำระเงินก่อน (กด Space เพื่อยืนยัน)';
      payErrEl.style.display = 'block';
      return;
    }
    payReceiptBody.textContent = buildReceiptText(paySale);
    payReceiptWrap.style.display = 'block';
    payReceiptShown = true;
  }

  function downloadReceipt(){
    if(!paySale) return;
    downloadTextFile(`receipt-${paySale.at}.txt`, buildReceiptText(paySale));
  }
  document.getElementById('payDownloadBtn').addEventListener('click', downloadReceipt);

  /* ---------------- keyboard shortcuts ----------------
     F1  = open the payment screen (from the POS tab)
     F2  = focus "amount received"
     F3  = 1st press: preview the slip · 2nd press: download it
     F12 = exit the payment screen
     Space = 1st press: show the change due · 2nd press: confirm payment
  --------------------------------------------------- */
  document.addEventListener('keydown', (e)=>{
    const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';

    if(paymentModal.style.display !== 'flex'){
      if(e.key === 'F1'){ e.preventDefault(); openPaymentScreen(); }
      return;
    }

    if(e.key === 'F2'){
      e.preventDefault();
      payReceivedEl.focus();
      payReceivedEl.select();
    } else if(e.key === 'F3'){
      e.preventDefault();
      if(!payReceiptShown) showReceiptPreview();
      else downloadReceipt();
    } else if(e.key === 'F12'){
      e.preventDefault();
      closePaymentScreen();
    } else if(isSpace){
      e.preventDefault();
      if(paySale) return; // already confirmed, nothing more Space needs to do
      if(!paySpaceArmed){
        // 1st press: validate the amount and show the change due
        const received = parseFloat(payReceivedEl.value);
        if(isNaN(received)){
          payErrEl.textContent = 'กรุณาใส่จำนวนเงินที่ลูกค้าให้มาก่อน (กด F2)';
          payErrEl.style.display = 'block';
          return;
        }
        payErrEl.style.display = 'none';
        updateChangeDisplay();
        paySpaceArmed = true;
      } else {
        // 2nd press: actually confirm & finalize the payment
        confirmPayment();
      }
    }
  });

  /* ---------------- products tab ---------------- */
  let productsData = {};
  storeRef('products').on('value', (snap)=>{
    productsData = snap.val() || {};
    renderProducts();
  });

  document.getElementById('productSearch').addEventListener('input', renderProducts);

  function renderProducts(){
    const q = document.getElementById('productSearch').value.trim().toLowerCase();
    const body = document.getElementById('productsBody');
    const entries = Object.entries(productsData).filter(([code,p])=>
      !q || code.toLowerCase().includes(q) || (p.name||'').toLowerCase().includes(q)
    );
    if(entries.length === 0){
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-soft);padding:30px;">ยังไม่มีสินค้าที่บันทึกไว้</td></tr>`;
      return;
    }
    body.innerHTML = entries.map(([code,p])=>`
      <tr>
        <td class="num">${escapeHtml(code)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td class="price-tag">฿${fmtMoney(p.price)}</td>
        <td style="font-size:12px;color:var(--ink-soft);">${p.updatedAt ? new Date(p.updatedAt).toLocaleString('th-TH') : '-'}</td>
        <td>
          <button class="icon-btn edit" data-code="${code}" data-act="edit">✎</button>
          <button class="icon-btn del" data-code="${code}" data-act="del">🗑</button>
        </td>
      </tr>
    `).join('');
  }

  document.getElementById('productsBody').addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-act]');
    if(!btn) return;
    const code = btn.dataset.code;
    if(btn.dataset.act === 'del'){
      if(confirm(`ลบสินค้าบาร์โค้ด ${code}?`)) await storeRef(`products/${code}`).remove();
    } else if(btn.dataset.act === 'edit'){
      const p = productsData[code];
      openProductModal({ barcode: code, name: p.name, price: p.price }, async (barcode, name, price)=>{
        await saveProduct(barcode, name, price);
      }, true);
    }
  });

  document.getElementById('addProductBtn').addEventListener('click', ()=>{
    openProductModal({ barcode:'', name:'', price:'' }, async (barcode, name, price)=>{
      await saveProduct(barcode, name, price);
    });
  });

  function openProductModal(initial, onSave, lockBarcode){
    const modal = document.getElementById('productModal');
    document.getElementById('pmTitle').textContent = lockBarcode ? 'แก้ไขสินค้า' : 'เพิ่ม / บันทึกสินค้า';
    const barcodeEl = document.getElementById('pmBarcode');
    const nameEl = document.getElementById('pmName');
    const priceEl = document.getElementById('pmPrice');
    const errEl = document.getElementById('pmErr');
    barcodeEl.value = initial.barcode || '';
    nameEl.value = initial.name || '';
    priceEl.value = initial.price || '';
    barcodeEl.disabled = !!lockBarcode;
    errEl.style.display = 'none';
    modal.style.display = 'flex';

    const saveHandler = async ()=>{
      const barcode = barcodeEl.value.trim();
      const name = nameEl.value.trim();
      const price = parseFloat(priceEl.value);
      if(!barcode || !name || isNaN(price) || price < 0){
        errEl.textContent = 'กรุณากรอกบาร์โค้ด ชื่อสินค้า และราคาให้ถูกต้อง';
        errEl.style.display = 'block';
        return;
      }
      await onSave(barcode, name, price);
      cleanup();
    };
    const cancelHandler = ()=> cleanup();
    function cleanup(){
      modal.style.display = 'none';
      document.getElementById('pmSave').removeEventListener('click', saveHandler);
      document.getElementById('pmCancel').removeEventListener('click', cancelHandler);
      document.getElementById('manualBarcode').focus();
    }
    document.getElementById('pmSave').addEventListener('click', saveHandler);
    document.getElementById('pmCancel').addEventListener('click', cancelHandler);
  }

  /* ---------------- sales tab ---------------- */
  async function loadSales(){
    const snap = await storeRef('sales').limitToLast(50).once('value');
    const val = snap.val() || {};
    const list = Object.values(val).sort((a,b)=>b.at-a.at);
    const el = document.getElementById('salesList');
    if(list.length === 0){
      el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--ink-soft);">ยังไม่มีประวัติการขาย</div>`;
      return;
    }
    el.innerHTML = list.map(s=>`
      <div class="sale-item">
        <div>
          <div>${s.items.length} รายการ (${s.items.reduce((a,i)=>a+i.qty,0)} ชิ้น)</div>
          <div class="meta">${new Date(s.at).toLocaleString('th-TH')}</div>
        </div>
        <div class="amt">฿${fmtMoney(s.total)}</div>
      </div>
    `).join('');
  }
}
