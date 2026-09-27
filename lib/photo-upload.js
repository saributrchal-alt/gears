import {randomUUID} from 'node:crypto';
const BUCKET='gears-photos';
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
 const bytes=decodePhoto(image),origin=new URL(process.env.SUPABASE_URL).origin,key=process.env.SUPABASE_SECRET_KEY;
 const headers={apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`})};
 const bucketUrl=`${origin}/storage/v1/bucket/${BUCKET}`;
 const current=await fetch(bucketUrl,{headers,cache:'no-store'});
 if(!current.ok){
  // Provision once using server credentials. Browsers never receive storage write permissions.
  let missing=current.status===404;
  if(!missing){const data=await current.json().catch(()=>null);missing=String(data?.statusCode)==='404';}
  if(!missing)throw error('ยังเชื่อมพื้นที่เก็บรูปไม่ได้ กรุณาลองใหม่',503);
  const created=await fetch(`${origin}/storage/v1/bucket`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:BUCKET,name:BUCKET,public:true,file_size_limit:512000,allowed_mime_types:['image/jpeg']})});
  if(!created.ok){const retry=await fetch(bucketUrl,{headers,cache:'no-store'});if(!retry.ok)throw error('สร้างพื้นที่เก็บรูปไม่ได้ กรุณาตรวจสิทธิ์ Supabase',503);}
 }
 const name=`${randomUUID()}.jpg`;
 const response=await fetch(`${origin}/storage/v1/object/${BUCKET}/${name}`,{method:'POST',headers:{...headers,'Content-Type':'image/jpeg','Cache-Control':'max-age=31536000'},body:bytes});
 if(!response.ok)throw error('บันทึกรูปไม่สำเร็จ กรุณาลองใหม่ รูปที่เลือกยังอยู่ในแบบฟอร์ม',503);
 return {url:`${origin}/storage/v1/object/public/${BUCKET}/${name}`,bytes:bytes.length};
}
