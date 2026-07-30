/* =========================================================
   scanner.js - logic for scanner.html (phone screen)
   ========================================================= */
if(requireRoleOrRedirect('scanner')){
  document.getElementById('storeCodeLabel').textContent = 'ร้าน: ' + getStoreCode();
  document.getElementById('resetBtn').addEventListener('click', ()=>{
    if(confirm('ล้างการตั้งค่าของเครื่องนี้และเริ่มใหม่?')){
      localStorage.clear();
      goTo('index.html');
    }
  });

  let recent = []; // {name, qty/price, at}
  let lastCode = null;
  let lastCodeAt = 0;
  const RESCAN_COOLDOWN_MS = 2500; // avoid double-adding same barcode while it's still in view

  function showToast(msg, type){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'scan-toast show ' + (type || '');
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(()=> t.classList.remove('show'), 2600);
  }

  function pushRecent(name, price, qtyText){
    recent.unshift({ name, price, qtyText, at: Date.now() });
    recent = recent.slice(0, 15);
    renderRecent();
  }

  function renderRecent(){
    const el = document.getElementById('recentLog');
    if(recent.length === 0){ el.innerHTML = ''; return; }
    el.innerHTML = '<h2 style="font-size:14px;margin:10px 4px;">รายการล่าสุด</h2>' + recent.map(r=>`
      <div class="item">
        <span>${escapeHtml(r.name)}</span>
        <span class="num">฿${fmtMoney(r.price)} ${r.qtyText || ''}</span>
      </div>
    `).join('');
  }

  async function handleDecodedCode(code){
    const now = Date.now();
    if(code === lastCode && (now - lastCodeAt) < RESCAN_COOLDOWN_MS) return;
    lastCode = code; lastCodeAt = now;

    // vibrate for tactile feedback if supported
    if(navigator.vibrate) navigator.vibrate(80);

    try{
      const local = await lookupLocalProduct(code);
      if(local && local.price != null){
        await addToCart(code, local.name, local.price, 1);
        pushRecent(local.name, local.price, 'x1');
        showToast(`✓ เพิ่มแล้ว: ${local.name} — ฿${fmtMoney(local.price)}`, 'ok');
        return;
      }

      // not found locally -> search public product databases for NAME and (if lucky) a suggested PRICE
      showToast('กำลังค้นหาชื่อและราคาสินค้า...', '');
      const ext = await lookupExternalProduct(code);
      openUnknownModal(code, ext ? ext.name : '', ext ? ext.price : null, !!ext);

    }catch(e){
      showToast('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', 'err');
    }
  }

  function openUnknownModal(barcode, prefilledName, prefilledPrice, found){
    const modal = document.getElementById('unknownModal');
    document.getElementById('umTitle').textContent = found ? 'พบข้อมูลสินค้า — ตรวจสอบก่อนบันทึก' : 'ไม่พบสินค้านี้ในระบบ';
    document.getElementById('umHint').textContent = found
      ? (prefilledPrice != null
          ? 'ดึงชื่อและราคาแนะนำจากฐานข้อมูลสาธารณะแล้ว กรุณาตรวจสอบก่อนบันทึก'
          : 'ดึงชื่อสินค้าจากฐานข้อมูลสาธารณะแล้ว กรุณาใส่ราคาเพื่อบันทึก')
      : 'กรอกชื่อสินค้าและราคาเพื่อบันทึกไว้ใช้ครั้งต่อไป';
    document.getElementById('umBarcode').value = barcode;
    document.getElementById('umName').value = prefilledName || '';
    document.getElementById('umPrice').value = (prefilledPrice != null) ? prefilledPrice : '';
    document.getElementById('umErr').style.display = 'none';
    modal.style.display = 'flex';
    document.getElementById('umPrice').focus();

    const saveHandler = async ()=>{
      const name = document.getElementById('umName').value.trim();
      const price = parseFloat(document.getElementById('umPrice').value);
      if(!name || isNaN(price) || price < 0){
        const err = document.getElementById('umErr');
        err.textContent = 'กรอกชื่อสินค้าและราคาให้ถูกต้อง';
        err.style.display = 'block';
        return;
      }
      await saveProduct(barcode, name, price);
      await addToCart(barcode, name, price, 1);
      pushRecent(name, price, 'x1 (ใหม่)');
      showToast(`✓ บันทึกและเพิ่มแล้ว: ${name}`, 'ok');
      cleanup();
    };
    const cancelHandler = ()=>{
      lastCode = null; // allow immediate rescan if they cancel
      cleanup();
    };
    function cleanup(){
      modal.style.display = 'none';
      document.getElementById('umSave').removeEventListener('click', saveHandler);
      document.getElementById('umCancel').removeEventListener('click', cancelHandler);
    }
    document.getElementById('umSave').addEventListener('click', saveHandler);
    document.getElementById('umCancel').addEventListener('click', cancelHandler);
  }

  /* ---------------- manual entry ---------------- */
  document.getElementById('manualBtn').addEventListener('click', ()=>{
    const el = document.getElementById('manualInput');
    const code = el.value.trim();
    if(!code) return;
    el.value = '';
    lastCode = null; // manual entries shouldn't be blocked by cooldown
    handleDecodedCode(code);
  });
  document.getElementById('manualInput').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') document.getElementById('manualBtn').click();
  });

  /* ---------------- camera (html5-qrcode) ---------------- */
  let html5QrCode = null;
  let camRunning = false;

  async function startCamera(){
    try{
      html5QrCode = new Html5Qrcode('reader');
      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 260, height: 160 } },
        (decodedText)=> handleDecodedCode(decodedText.trim()),
        ()=>{ /* ignore per-frame decode errors */ }
      );
      camRunning = true;
      document.getElementById('toggleCamBtn').textContent = '⏸ หยุดกล้องชั่วคราว';
    }catch(e){
      showToast('เปิดกล้องไม่สำเร็จ — ตรวจสอบสิทธิ์การเข้าถึงกล้อง', 'err');
    }
  }

  async function stopCamera(){
    if(html5QrCode && camRunning){
      await html5QrCode.stop();
      camRunning = false;
      document.getElementById('toggleCamBtn').textContent = '▶ เปิดกล้องอีกครั้ง';
    }
  }

  document.getElementById('toggleCamBtn').addEventListener('click', ()=>{
    if(camRunning) stopCamera(); else startCamera();
  });

  startCamera();
}
