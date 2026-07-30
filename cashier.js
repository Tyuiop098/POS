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
    });
  });

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
    } else {
      openProductModal({ barcode: code, name:'', price:'' }, async (barcode, name, price)=>{
        await saveProduct(barcode, name, price);
        await addToCart(barcode, name, price, 1);
      });
      input.value = '';
    }
  }

  /* ---------------- checkout ---------------- */
  let lastReceipt = null; // { items, total, at } of most recently completed sale

  async function performCheckout(){
    const items = Object.values(cartData);
    if(items.length === 0){ alert('ยังไม่มีสินค้าในตะกร้า'); return; }
    const total = items.reduce((s,i)=>s+i.price*i.qty,0);
    const sale = { items, total, at: nowStamp() };
    await storeRef('sales').push(sale);
    await storeRef('cart').remove();

    lastReceipt = sale;
    hidePaymentView();
    showReceiptModal(sale);
  }

  function showReceiptModal(sale){
    const receiptBody = document.getElementById('receiptBody');
    receiptBody.innerHTML = sale.items.map(i=>
      `<div style="display:flex;justify-content:space-between;">
        <span>${escapeHtml(i.name)} x${i.qty}</span><span>฿${fmtMoney(i.price*i.qty)}</span>
      </div>`
    ).join('') + `<hr style="border:none;border-top:1px dashed #ccc;margin:8px 0;">
      <div style="display:flex;justify-content:space-between;font-weight:700;">
        <span>รวมทั้งหมด</span><span>฿${fmtMoney(sale.total)}</span>
      </div>`;
    document.getElementById('receiptModal').style.display = 'flex';
  }

  document.getElementById('checkoutBtn').addEventListener('click', performCheckout);
  document.getElementById('receiptClose').addEventListener('click', ()=>{
    document.getElementById('receiptModal').style.display = 'none';
  });

  function buildReceiptText(sale){
    const lines = [];
    lines.push('POS Mart — ใบเสร็จรับเงิน');
    lines.push('ร้าน: ' + getStoreCode());
    lines.push('วันที่: ' + new Date(sale.at).toLocaleString('th-TH'));
    lines.push('----------------------------------------');
    sale.items.forEach(i=>{
      lines.push(`${i.name}`);
      lines.push(`  ${fmtMoney(i.price)} x ${i.qty} = ฿${fmtMoney(i.price*i.qty)}`);
    });
    lines.push('----------------------------------------');
    lines.push(`รวมทั้งหมด: ฿${fmtMoney(sale.total)}`);
    lines.push('ขอบคุณที่ใช้บริการ');
    return lines.join('\n');
  }

  function downloadReceipt(sale){
    if(!sale){ alert('ยังไม่มีใบเสร็จให้โหลด — ต้องชำระเงินก่อนอย่างน้อย 1 ครั้ง'); return; }
    const text = buildReceiptText(sale);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${sale.at}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.getElementById('receiptDownloadBtn').addEventListener('click', ()=> downloadReceipt(lastReceipt));

  /* ---------------- payment view (F9 full screen) ---------------- */
  function showPaymentView(){
    const items = Object.values(cartData);
    if(items.length === 0){ alert('ยังไม่มีสินค้าในตะกร้า'); return; }
    const total = items.reduce((s,i)=>s+i.price*i.qty,0);
    document.getElementById('paymentItems').innerHTML = items.map(i=>`
      <div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid var(--line);font-size:14px;">
        <span>${escapeHtml(i.name)} <span style="color:var(--ink-soft);">x${i.qty}</span></span>
        <span class="num">฿${fmtMoney(i.price*i.qty)}</span>
      </div>
    `).join('');
    document.getElementById('paymentLedTotal').textContent = fmtMoney(total);
    document.getElementById('paymentView').style.display = 'flex';
  }

  function hidePaymentView(){
    document.getElementById('paymentView').style.display = 'none';
  }

  function isPaymentViewOpen(){
    return document.getElementById('paymentView').style.display === 'flex';
  }

  document.getElementById('paymentCancelBtn').addEventListener('click', hidePaymentView);
  document.getElementById('paymentConfirmBtn').addEventListener('click', performCheckout);

  /* ---------------- keyboard shortcuts: F9 / Space / F1 / Esc ---------------- */
  document.addEventListener('keydown', (e)=>{
    const tag = document.activeElement ? document.activeElement.tagName : '';
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if(e.key === 'F9'){
      e.preventDefault();
      if(!isPaymentViewOpen()) showPaymentView();
      return;
    }
    if(e.key === 'F1'){
      e.preventDefault();
      downloadReceipt(lastReceipt);
      return;
    }
    if(e.code === 'Space' || e.key === ' '){
      if(isTyping) return; // let space type normally in text fields
      if(isPaymentViewOpen()){
        e.preventDefault();
        performCheckout();
      }
      return;
    }
    if(e.key === 'Escape' && isPaymentViewOpen()){
      hidePaymentView();
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
