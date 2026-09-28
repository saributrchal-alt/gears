const endpoint='https://media.nathoeng.com/signatures.php';
const fail=message=>Object.assign(new Error(message),{status:503});
export function decodeSignature(value){
 if(typeof value!=='string'||value.length>280000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw Object.assign(new Error('ข้อมูลลายเซ็นไม่ถูกต้อง'),{status:400});
 const bytes=Buffer.from(value.split(',')[1],'base64');
 if(bytes.length<40||bytes.length>200000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==900||bytes.readUInt32BE(20)!==300)throw Object.assign(new Error('ขนาดภาพลายเซ็นไม่ถูกต้อง'),{status:400});
 return bytes;
}
export async function signatureMedia(operation,fields={}){
 const key=process.env.MEDIA_UPLOAD_KEY;
 if(!key||key.length<32)throw fail('ยังไม่ได้ตั้งค่าพื้นที่เก็บลายเซ็น');
 const form=new FormData();form.set('operation',operation);
 for(const [k,v] of Object.entries(fields))form.set(k,v);
 try{
  const response=await fetch(endpoint,{method:'POST',body:form,headers:{'X-Upload-Key':key},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok||!data.ok)throw Error();return data;
 }catch{throw fail('ยังเชื่อมพื้นที่เก็บลายเซ็นไม่ได้ กรุณาติดตั้ง signatures.php หรือลองใหม่');}
}
export async function uploadSignature(bytes){
 const data=await signatureMedia('upload',{file:new Blob([bytes],{type:'image/png'})});
 if(!/^https:\/\/media\.nathoeng\.com\/signatures\.php\?id=[a-f0-9]{32}$/.test(data.url||''))throw fail('ที่อยู่ลายเซ็นไม่ถูกต้อง');
 return data.url;
}
export async function readSignature(url){
 const match=/^https:\/\/media\.nathoeng\.com\/signatures\.php\?id=([a-f0-9]{32})$/.exec(url||'');
 if(!match)throw fail('ที่อยู่ลายเซ็นไม่ถูกต้อง');
 const data=await signatureMedia('read',{id:match[1]});decodeSignature(data.image);return data.image;
}
