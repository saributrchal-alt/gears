const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
function pad(title,name,operationLabel){
 const wrap=node('section');wrap.className='signature-pad';wrap.append(node('h3',title),node('p',name));
 const canvas=node('canvas');canvas.width=900;canvas.height=300;canvas.setAttribute('aria-label',title+' ของ '+name);wrap.append(canvas);
 const ctx=canvas.getContext('2d');let active=null,points=0,distance=0,last,consent;
 function clear(){if(consent)consent.checked=false;ctx.fillStyle='#fff';ctx.fillRect(0,0,900,300);ctx.strokeStyle='#152d26';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';points=0;distance=0;}
 clear();const xy=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*900/r.width,(e.clientY-r.top)*300/r.height];};
 canvas.onpointerdown=e=>{if(active!==null)return;e.preventDefault();consent.checked=false;active=e.pointerId;canvas.setPointerCapture(active);last=xy(e);ctx.beginPath();ctx.moveTo(...last);};
 canvas.onpointermove=e=>{if(e.pointerId!==active)return;e.preventDefault();const p=xy(e);distance+=Math.hypot(p[0]-last[0],p[1]-last[1]);ctx.lineTo(...p);ctx.stroke();last=p;points++;};
 const finish=()=>{active=null;};canvas.onpointerup=finish;canvas.onpointercancel=finish;canvas.onlostpointercapture=finish;
 const reset=node('button','ล้าง / เซ็นใหม่');reset.type='button';reset.className='secondary';reset.onclick=clear;wrap.append(reset);
 const label=node('label');label.className='check';consent=node('input');consent.type='checkbox';label.append(consent,document.createTextNode(title+' ยืนยันลายเซ็นและรายการ'+operationLabel+'นี้'));wrap.append(label);
 return {wrap,value(){if(points<5||distance<80)throw Error('กรุณาลง'+title+'ให้ครบ');if(!consent.checked)throw Error('กรุณายืนยัน'+title);return canvas.toDataURL('image/png');}};
}
export function mountSignatures(form,loan,staffName,api,operation='handover'){
 const returning=operation==='accept_return';const operationLabel=returning?'ตรวจรับคืน':'ส่งมอบ';
 const section=node('section');section.className='handover-signing';
 const toggle=node('button','ลงลายเซ็นบนหน้าจอ (ตัวเลือกเสริม)');toggle.type='button';toggle.className='secondary';
 const body=node('div');body.hidden=true;const status=node('p');status.setAttribute('role','status');section.append(toggle,status,body);form.append(section);
 let enabled=false,borrower,staff;
 toggle.onclick=async()=>{
  if(enabled){enabled=false;body.hidden=true;toggle.textContent='ลงลายเซ็นบนหน้าจอ (ตัวเลือกเสริม)';return;}
  toggle.disabled=true;status.textContent='กำลังตรวจสอบ…';
  try{await api('signature-ready',{params:{operation}});if(!staff){body.append(node('p',`${loan.number} · ${loan.borrower_name}`));const list=node('ul');for(const item of loan.gears_loan_items||[])list.append(node('li',`${item.item_name} · ${item.asset_code}`));body.append(list,node('p',`ตรวจรายการให้ครบก่อนลงนาม ลายเซ็นนี้ใช้ยืนยันการ${operationLabel}รายการนี้เท่านั้น`));
   if(!returning){borrower=pad('ลายเซ็นผู้ยืม',loan.borrower_name,operationLabel);body.append(borrower.wrap);}staff=pad(returning?'ลายเซ็นเจ้าหน้าที่ผู้ตรวจรับคืน':'ลายเซ็นเจ้าหน้าที่ผู้ส่งมอบ',staffName,operationLabel);body.append(staff.wrap);}
   enabled=true;body.hidden=false;toggle.textContent='ใช้การเซ็นบนกระดาษแทน';status.textContent='';
  }catch(e){status.textContent=e.message;}finally{toggle.disabled=false;}
 };
 return {value(){return enabled?{borrower:borrower?.value(),staff:staff.value(),accepted:true}:undefined;}};
}
