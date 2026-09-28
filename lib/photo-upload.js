const error=(message,status=400)=>Object.assign(new Error(message),{status});
export function decodePhoto(image){
 if(typeof image!=='string'||image.length>690000)throw error('รูปต้องมีขนาดไม่เกิน 500 KB');
 const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
 if(!match)throw error('กรุณาใช้รูป JPEG ที่ผ่านการบีบอัด');
 const bytes=Buffer.from(match[1],'base64');
 if(bytes.length<20||bytes.length>512000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw error('ข้อมูลรูปภาพไม่ถูกต้องหรือใหญ่เกิน 500 KB');
 return bytes;
}
export async function uploadPhoto(image){
 const bytes=decodePhoto(image);
 const endpoint=process.env.MEDIA_UPLOAD_URL;
 const key=process.env.MEDIA_UPLOAD_KEY;
 // Fixed destination prevents accidental credential forwarding to another host.
 if(endpoint!=='https://media.nathoeng.com/upload.php'||!key||key.length<32)
  throw error('กรุณาตั้งค่า MEDIA_UPLOAD_URL และ MEDIA_UPLOAD_KEY ใน Vercel แล้ว Redeploy',503);
 const form=new FormData();
 form.set('folder','gears');
 form.set('file',new Blob([bytes],{type:'image/jpeg'}),'photo.jpg');
 let response,data;
 try{
  response=await fetch(endpoint,{
   method:'POST',headers:{'X-Upload-Key':key},body:form,
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)
  });
  data=await response.json();
 }catch{
  throw error('เชื่อมต่อพื้นที่เก็บรูปไม่ได้ กรุณาลองใหม่ รูปที่เลือกยังอยู่ในแบบฟอร์ม',503);
 }
 if(!response.ok||data?.ok!==true){
  if(response.status===401)throw error('รหัสอัปโหลดไม่ตรงกัน กรุณาตรวจ MEDIA_UPLOAD_KEY กับ config.php แล้ว Redeploy',503);
  if(response.status===413)throw error('รูปมีขนาดเกินที่พื้นที่เก็บรูปกำหนด',413);
  throw error('บันทึกรูปไม่สำเร็จ กรุณาลองใหม่ รูปที่เลือกยังอยู่ในแบบฟอร์ม',503);
 }
 // Only accept public URLs in this app's media directory.
 if(typeof data.url!=='string'||!/^https:\/\/media\.nathoeng\.com\/uploads\/gears\/\d{4}\/\d{2}\/[a-f0-9]{32}\.webp$/.test(data.url)
   ||!Number.isInteger(data.bytes)||data.bytes<1||data.bytes>2*1024*1024)
  throw error('พื้นที่เก็บรูปตอบกลับไม่ถูกต้อง กรุณาลองใหม่',503);
 return {url:data.url,bytes:data.bytes};
}
