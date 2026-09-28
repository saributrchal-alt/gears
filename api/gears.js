import {uploadPhoto} from '../lib/photo-upload.js';
const enc = encodeURIComponent;
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
async function db(path, method = 'GET', body) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const response = await fetch(`${new URL(process.env.SUPABASE_URL).origin}/rest/v1/${path}`, {
    method, cache: 'no-store', headers: {apikey:key, ...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}), 'Content-Type':'application/json', Prefer:'return=representation'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    if (value?.code === 'P0001') throw fail(value.message);
    if (value?.code === '23505') throw fail('รายการซ้ำหรืออุปกรณ์ถูกจองแล้ว กรุณาอัปเดต',409);
    console.error('Gears database:', response.status, value?.code);
    throw fail('ยังอ่านหรือบันทึกทะเบียนไม่ได้ กรุณาตรวจการตั้งค่าและรัน schema.sql',503);
  }
  return value;
}
async function all(path) {
  const rows=[];
  for(let offset=0;;offset+=1000){const batch=await db(`${path}&limit=1000&offset=${offset}`);rows.push(...batch);if(batch.length<1000)return rows;}
}
async function actor(req) {
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token||token.length>4000)throw fail('กรุณาเข้าสู่ระบบสมาชิกวัด',401);
  const response=await fetch('https://watt.nathoeng.com/api/line-login?route=gears-verify',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  if(response.status===401)throw fail('ข้อมูลเข้าสู่ระบบหมดอายุ กรุณาอัปเดตแล้วลองอีกครั้ง',401);
  if(!response.ok)throw fail('ยังเชื่อมสมาชิกไม่ได้ กรุณาตรวจว่าเว็บวัดใช้โค้ดเชื่อมคลังอุปกรณ์แล้ว',503);
  const claim=await response.json();
  if(!claim.sub)throw fail('กรุณาเข้าสู่ระบบสมาชิกวัด',401);
  const members=await db(`members?id=eq.${enc(claim.sub)}&select=id,full_name,display_name,role,membership_status&limit=1`);
  const member=members[0];
  if(!member||(member.membership_status&&member.membership_status!=='active'))throw fail('สมาชิกไม่มีสิทธิ์ใช้งาน',403);
  return {...member,staff:member.role==='admin'};
}
const loanFields='*,gears_loan_items(id,asset_id,item_name,asset_code,returned_at,return_condition)';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const action=text(req.query?.action,30), b=req.body||{};
  try {
    if(!['GET','POST'].includes(req.method))throw fail('Method not allowed',405);
    if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)throw fail('คลังอุปกรณ์อยู่ระหว่างตั้งค่า ยังไม่ได้เชื่อมทะเบียน',503);
    if(action==='categories'&&req.method==='GET')return res.json({categories:await db('gears_categories?select=*&order=name.asc')});
    if(action==='catalog'&&req.method==='GET') {
      const q=text(req.query.q,80).replace(/[^\p{L}\p{N}\s-]/gu,' ').trim();
      const page=Math.max(0,Math.min(10000,parseInt(req.query.page,10)||0));
      let path=`gears_items?active=eq.true&select=*,gears_categories(name)&order=name.asc,id.asc&limit=25&offset=${page*24}`;
      if(q)path+=`&or=(name.ilike.${enc('%'+q+'%')},description.ilike.${enc('%'+q+'%')})`;
      if(req.query.category)path+=`&category_id=eq.${enc(text(req.query.category,60))}`;
      const items=await db(path),shown=items.slice(0,24);
      const assets=shown.length?await all(`gears_assets?item_id=in.(${shown.map(i=>i.id).join(',')})&status=neq.retired&select=item_id,status&order=id.asc`):[];
      return res.json({items:shown.map(item=>({...item,available:assets.filter(a=>a.item_id===item.id&&a.status==='available').length,total:assets.filter(a=>a.item_id===item.id).length})),hasMore:items.length>24,page});
    }
    if(action==='detail'&&req.method==='GET') {
      if(!uuid(req.query.id))throw fail('รหัสอุปกรณ์ไม่ถูกต้อง');
      const items=await db(`gears_items?id=eq.${enc(req.query.id)}&active=eq.true&select=*,gears_categories(name)&limit=1`);
      if(!items[0])throw fail('ไม่พบอุปกรณ์',404);
      const assets=await all(`gears_assets?item_id=eq.${enc(req.query.id)}&status=neq.retired&select=code,status&order=code.asc`);
      return res.json({item:items[0],assets});
    }
    const user=await actor(req);
    if(action==='me'&&req.method==='GET')return res.json({member:{id:user.id,name:user.full_name||user.display_name||'สมาชิก',staff:user.staff}});
    if(action==='loans'&&req.method==='GET') {
      if(req.query.scope==='all'&&!user.staff)throw fail('เฉพาะเจ้าหน้าที่',403);
      const page=Math.max(0,parseInt(req.query.page,10)||0);
      const rows=await db(`gears_loans?select=${loanFields}${req.query.scope==='all'?'':`&member_id=eq.${enc(user.id)}`}&order=requested_at.desc,id.desc&limit=51&offset=${page*50}`);
      return res.json({loans:rows.slice(0,50),hasMore:rows.length>50});
    }
    if(['loan','history'].includes(action)&&req.method==='GET') {
      if(!uuid(req.query.id))throw fail('รหัสรายการไม่ถูกต้อง');
      const rows=await db(`gears_loans?id=eq.${enc(req.query.id)}${user.staff?'':`&member_id=eq.${enc(user.id)}`}&select=${loanFields}&limit=1`);
      if(!rows[0])throw fail('ไม่พบรายการ',404);
      const events=await db(`gears_events?loan_id=eq.${enc(req.query.id)}&select=action,note,created_at,actor_id&order=created_at.asc,id.asc`);
      const handover=events.find(event=>event.action==='on_loan');
      let handoverName='';
      if(handover?.actor_id){
        const staff=await db(`members?id=eq.${enc(handover.actor_id)}&select=full_name,display_name&limit=1`);
        handoverName=staff[0]?.full_name||staff[0]?.display_name||'';
      }else if(!rows[0].handed_at&&user.staff){
        handoverName=user.full_name||user.display_name||'';
      }
      return res.json({loan:{...rows[0],handover_name:handoverName},events:events.map(({actor_id,...event})=>event)});
    }
    if(action==='reserve'&&req.method==='POST') {
      if(b.accepted!==true||b.termsVersion!=='2026-09-27'||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>20||b.lines.some(x=>!uuid(x.itemId)||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>50))throw fail('ตรวจรายการ จำนวน และยอมรับเงื่อนไขก่อนส่ง');
      if(!/^[+\d\s()-]{8,30}$/.test(text(b.phone,31))||!text(b.purpose,1000)||!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate))throw fail('กรอกเบอร์โทร วัตถุประสงค์ และกำหนดคืน');
      return res.json({loan:await db('rpc/gears_reserve','POST',{p_actor:String(user.id),p_lines:b.lines,p_phone:text(b.phone,30),p_purpose:text(b.purpose,1000),p_due:b.dueDate,p_terms:b.termsVersion})});
    }
    if(action==='transition'&&req.method==='POST') {
      const allowed=user.staff?['approve','reject','cancel','handover','request_return','accept_return']:['cancel','request_return'];
      if(!allowed.includes(b.operation))throw fail('ไม่มีสิทธิ์ทำรายการนี้',403);
      if(!uuid(b.loanId))throw fail('รหัสรายการไม่ถูกต้อง');
      if(b.operation==='approve'&&!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate||''))throw fail('ระบุกำหนดคืน');
      return res.json({loan:await db('rpc/gears_transition','POST',{p_loan:b.loanId,p_actor:String(user.id),p_action:b.operation,p_note:text(b.note,1000),p_due:b.operation==='approve'?b.dueDate:null,p_conditions:b.conditions&&typeof b.conditions==='object'?b.conditions:{}})});
    }
    if(!user.staff)throw fail('เฉพาะเจ้าหน้าที่วัด',403);
    if(action==='inventory'&&req.method==='GET')return res.json({items:await all('gears_items?select=*,gears_categories(name)&order=name.asc,id.asc'),assets:await all('gears_assets?select=*&order=code.asc')});
    if(req.method!=='POST')throw fail('ไม่พบคำสั่ง',404);
    if(action==='photo') return res.json(await uploadPhoto(b.image));
    if(action==='category') {
      if(!text(b.name,100))throw fail('กรอกชื่อหมวดหมู่');
      const {randomUUID}=await import('node:crypto');
      return res.json({category:(await db('gears_categories','POST',{id:randomUUID(),name:text(b.name,100)}))[0]});
    }
    if(action==='item') {
      if(!text(b.name)||!text(b.categoryId,60))throw fail('กรอกชื่อและหมวดหมู่');
      const image=text(b.imageUrl,1500);
      if(image&&!/^https:\/\//i.test(image))throw fail('ลิงก์รูปต้องขึ้นต้นด้วย https://');
      if(b.id&&!uuid(b.id))throw fail('รหัสไม่ถูกต้อง');
      const payload={name:text(b.name),category_id:text(b.categoryId,60),description:text(b.description,4000),image_url:image,unit:text(b.unit,30)||'ชิ้น',active:b.active!==false};
      const rows=await db(b.id?`gears_items?id=eq.${enc(b.id)}`:'gears_items',b.id?'PATCH':'POST',payload);
      if(!rows.length)throw fail('ไม่พบอุปกรณ์',404);
      return res.json({item:rows[0]});
    }
    if(action==='receive') {
      if(!uuid(b.itemId)||!Number.isInteger(b.quantity)||b.quantity<1||b.quantity>100)throw fail('เลือกอุปกรณ์และจำนวน 1–100');
      return res.json({count:await db('rpc/gears_receive','POST',{p_item:b.itemId,p_actor:String(user.id),p_quantity:b.quantity,p_location:text(b.location),p_note:text(b.note,1000)})});
    }
    if(action==='asset') {
      if(!uuid(b.assetId)||!['available','repair','retired'].includes(b.status))throw fail('ข้อมูลไม่ถูกต้อง');
      await db('rpc/gears_asset_action','POST',{p_asset:b.assetId,p_actor:String(user.id),p_status:b.status,p_note:text(b.note,1000)});
      return res.json({ok:true});
    }
    throw fail('ไม่พบคำสั่ง',404);
  } catch(error) {if(!error.status)console.error('Gears service unavailable:',error.name);return res.status(error.status||503).json({error:error.status?error.message:'บริการไม่พร้อมชั่วคราว กรุณาลองใหม่'});}
}
