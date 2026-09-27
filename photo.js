// Photos are resized and re-encoded on this device before any upload.
export const MAX_PHOTO_BYTES = 512000;
const TARGET_BYTES = 300000;
const blobData = blob => new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('อ่านรูปภาพไม่สำเร็จ'));r.readAsDataURL(blob);});
const jpeg = (canvas,quality) => new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('แปลงรูปภาพไม่สำเร็จ')),'image/jpeg',quality));
export async function compressPhoto(file) {
 if(!file||!file.size)throw Error('กรุณาเลือกรูปภาพ');
 if(file.size>30*1024*1024)throw Error('รูปต้นฉบับใหญ่เกิน 30 MB กรุณาเลือกรูปที่เล็กลง');
 if(!/^image\//.test(file.type)&&! /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name||''))throw Error('กรุณาเลือกไฟล์รูปภาพ');
 const url=URL.createObjectURL(file),img=new Image();
 try {
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('อุปกรณ์นี้อ่านรูปไม่ได้ กรุณาใช้ JPEG, PNG หรือ WebP'));img.src=url;});
  const ratio=Math.min(1,1280/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  let result;
  for(const quality of [.82,.72,.62,.5]){result=await jpeg(canvas,quality);if(result.size<=TARGET_BYTES)break;}
  if(result.size>TARGET_BYTES){const small=document.createElement('canvas');small.width=Math.round(canvas.width*.7);small.height=Math.round(canvas.height*.7);small.getContext('2d').drawImage(canvas,0,0,small.width,small.height);result=await jpeg(small,.65);}
  if(result.size>MAX_PHOTO_BYTES)throw Error('บีบอัดรูปยังไม่ได้ตามขนาดที่กำหนด กรุณาเลือกรูปอื่น');
  return {data:await blobData(result),bytes:result.size,originalBytes:file.size};
 }finally{URL.revokeObjectURL(url);}
}
export function mountPhoto({api}) {
 const fieldset=document.querySelector('#photo-editor'),urlInput=document.querySelector('[name=imageUrl]'),preview=document.querySelector('#photo-preview'),status=document.querySelector('#photo-status');
 const picker=document.querySelector('#photo-file'),capture=document.querySelector('#photo-capture');
 const submit=document.querySelector('#item-form button[type=submit]'),edit=document.querySelector('#edit-item');
 let pending=null,sequence=0,processing=false,saving=false,stream=null;
 function render(){const src=pending?.data||urlInput.value.trim();preview.replaceChildren();if(src&&(pending||/^https:\/\//i.test(src))){const img=document.createElement('img');img.src=src;img.alt='ตัวอย่างรูปอุปกรณ์';preview.append(img);}else preview.textContent='ยังไม่มีรูปอุปกรณ์';}
 function controls(){fieldset.disabled=processing||saving;submit.disabled=processing||saving;edit.disabled=processing||saving;}
 async function choose(file){if(!file||saving)return;const seq=++sequence;processing=true;controls();status.textContent='กำลังย่อและบีบอัดรูป…';try{const photo=await compressPhoto(file);if(seq!==sequence)return;pending=photo;render();status.textContent=`รูปพร้อมบันทึก · ${(photo.originalBytes/1024).toFixed(0)} KB → ${(photo.bytes/1024).toFixed(0)} KB · กดบันทึกข้อมูลอุปกรณ์เพื่อจัดเก็บ`;}catch(e){status.textContent=e.message;}finally{if(seq===sequence){processing=false;controls();}picker.value='';capture.value='';}}
 picker.onchange=()=>choose(picker.files[0]);capture.onchange=()=>choose(capture.files[0]);
 document.querySelector('#choose-photo').onclick=()=>picker.click();
 document.querySelector('#remove-photo').onclick=()=>{sequence++;pending=null;urlInput.value='';status.textContent='นำรูปออกแล้ว กดบันทึกข้อมูลอุปกรณ์เพื่อยืนยัน';render();};
 urlInput.addEventListener('input',()=>{sequence++;pending=null;status.textContent='';render();});
 const camera=document.createElement('dialog');camera.className='camera-dialog';
 camera.innerHTML='<div class="dialog-head"><h2>ถ่ายรูปอุปกรณ์</h2><button type="button" class="ghost camera-close" aria-label="ปิดกล้อง">✕</button></div><video autoplay playsinline muted></video><p role="status"></p><div class="actions"><button type="button" class="take-photo">ถ่ายรูปนี้</button><button type="button" class="secondary native-camera">ใช้กล้องของเครื่อง / เลือกรูป</button></div>';
 document.body.append(camera);const video=camera.querySelector('video'),cameraState=camera.querySelector('p'),take=camera.querySelector('.take-photo');
 const stop=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;};
 camera.addEventListener('close',stop);camera.querySelector('.camera-close').onclick=()=>camera.close();camera.querySelector('.native-camera').onclick=()=>{camera.close();capture.click();};
 document.querySelector('#open-camera').onclick=async()=>{
  if(!navigator.mediaDevices?.getUserMedia){capture.click();return;}
  camera.showModal();take.disabled=true;cameraState.textContent='กรุณาอนุญาตให้ใช้กล้อง…';
  try{const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1600},height:{ideal:1200}},audio:false});if(!camera.open){next.getTracks().forEach(t=>t.stop());return;}stream=next;video.srcObject=stream;await video.play();cameraState.textContent='จัดอุปกรณ์ให้อยู่ในกรอบ แล้วกดถ่ายรูป';take.disabled=false;}
  catch(e){stop();cameraState.textContent=e.name==='NotAllowedError'?'ยังไม่ได้รับอนุญาตใช้กล้อง กรุณาอนุญาตในเบราว์เซอร์ หรือใช้ปุ่มด้านล่าง':'เปิดกล้องไม่ได้ กรุณาใช้กล้องของเครื่องหรือเลือกรูปจากเครื่อง';}
 };
 take.onclick=async()=>{if(!video.videoWidth)return;take.disabled=true;try{const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);const blob=await jpeg(canvas,.95);camera.close();await choose(blob);}catch(e){cameraState.textContent=e.message;take.disabled=false;}};
 window.addEventListener('pagehide',stop);window.addEventListener('hashchange',()=>{if(camera.open)camera.close();});
 return {
  reset(){sequence++;pending=null;processing=false;status.textContent='';render();controls();},
  lock(value){saving=value;controls();},
  async upload(){if(processing)throw Error('กรุณารอบีบอัดรูปให้เสร็จก่อน');if(!pending)return urlInput.value.trim();status.textContent='กำลังบันทึกรูป…';const result=await api('photo',{method:'POST',body:{image:pending.data}});urlInput.value=result.url;pending=null;render();status.textContent='จัดเก็บรูปเรียบร้อย';return result.url;}
 };
}
