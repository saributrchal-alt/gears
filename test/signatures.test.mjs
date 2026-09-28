import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {decodeSignature,readSignature} from '../lib/signature-media.js';
test('invalid image and foreign URL rejected',async()=>{assert.throws(()=>decodeSignature('data:image/png;base64,AAAA'));await assert.rejects(()=>readSignature('https://example.com/x'));});
test('signed handover permissions, atomic rollback, immutable signer names',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table members(id text primary key,full_name text,display_name text,role text,membership_status text);insert into members values('a','Staff','','admin','active'),('b','Borrower','','member','active');`);
 await db.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
 const migration=await readFile(new URL('../migration-20260928-signatures.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
 const returns=await readFile(new URL('../migration-20260928-return-signatures.sql',import.meta.url),'utf8');await db.exec(returns);await db.exec(returns);
 const q=async(s,p=[])=>(await db.query(s,p)).rows;
 const item=(await q(`insert into gears_items(name,category_id) values('Tool','tools') returning id`))[0].id;
 await q(`select gears_receive($1,'a',1,'','')`,[item]);
 const loan=(await q(`select gears_reserve('b',$1::jsonb,'0812345678','Use',current_date+7,'2026-09-27') as loan`,[JSON.stringify([{itemId:item,quantity:1}])]))[0].loan;
 await q(`select gears_transition($1,'a','approve','',current_date+7)`,[loan.id]);
 const url=n=>'https://media.nathoeng.com/signatures.php?id='+n.repeat(32);
 const sign=(actor,u=url('a'),v=url('b'))=>q(`select gears_signed_handover($1,$2,$3,$4,'')`,[loan.id,actor,u,v]);
 await assert.rejects(()=>sign('b'),/ไม่มีสิทธิ์/);await assert.rejects(()=>sign('a','https://example.com/x'),/ลายเซ็น/);
 await q(`insert into gears_loan_signatures values($1,'x','x','a',$2,$3,now())`,[loan.id,url('c'),url('d')]);
 await assert.rejects(()=>sign('a'),/duplicate key/);assert.equal((await q('select status from gears_loans'))[0].status,'approved');
 await q('delete from gears_loan_signatures');await sign('a');assert.equal((await q('select status from gears_loans'))[0].status,'on_loan');
 await q(`update members set full_name='Changed'`);const row=(await q('select * from gears_loan_signatures'))[0];assert.equal(row.borrower_name,'Borrower');assert.equal(row.staff_name,'Staff');
 await assert.rejects(()=>sign('a'),/สถานะ/);
 const asset=(await q('select asset_id from gears_loan_items where loan_id=$1',[loan.id]))[0].asset_id;
 const accept=(actor,conditions)=>q(`select gears_signed_return($1,$2,$3,$4::jsonb,'')`,[loan.id,actor,url('c'),JSON.stringify(conditions)]);
 await assert.rejects(()=>accept('b',{[asset]:'available'}),/ไม่มีสิทธิ์/);
 await assert.rejects(()=>accept('a',{}),/ทุกชิ้น/);
 assert.equal((await q('select status from gears_loans'))[0].status,'on_loan');assert.equal((await q('select count(*)::int as n from gears_return_signatures'))[0].n,0);
 await accept('a',{[asset]:'available'});
 const returned=(await q('select * from gears_return_signatures'))[0];assert.equal(returned.staff_name,'Changed');assert.equal(returned.staff_id,'a');assert.ok(returned.signed_at);
 assert.equal((await q('select status from gears_loans'))[0].status,'returned');
 await assert.rejects(()=>accept('a',{[asset]:'available'}),/สถานะ/);
 const paperLoan=(await q(`select gears_reserve('b',$1::jsonb,'0812345678','Use',current_date+7,'2026-09-27') as loan`,[JSON.stringify([{itemId:item,quantity:1}])]))[0].loan;
 await q(`select gears_transition($1,'a','approve','',current_date+7)`,[paperLoan.id]);await q(`select gears_transition($1,'a','handover')`,[paperLoan.id]);
 await q(`select gears_signed_return($1,'a',$2,$3::jsonb,'')`,[paperLoan.id,url('d'),JSON.stringify({[asset]:'available'})]);
 assert.equal((await q('select count(*)::int as n from gears_loan_signatures where loan_id=$1',[paperLoan.id]))[0].n,0);
 assert.equal((await q('select count(*)::int as n from gears_return_signatures where loan_id=$1',[paperLoan.id]))[0].n,1);
 await db.exec('set role anon');await assert.rejects(()=>q('select * from gears_return_signatures'),/permission denied/);await assert.rejects(()=>q('select * from gears_loan_signatures'),/permission denied/);
 }finally{await db.close();}
});
test('non-owner cannot read signatures or reach private media',async()=>{
 const {default:handler}=await import('../api/gears.js');const old=globalThis.fetch;process.env.SUPABASE_URL='https://example.test';process.env.SUPABASE_SECRET_KEY='sb_secret_test';let calls=0;
 globalThis.fetch=async input=>{const u=new URL(input);let data;if(u.hostname==='media.nathoeng.com'){calls++;throw Error('must not read');}if(u.hostname==='watt.nathoeng.com')data={sub:'member'};else if(u.pathname.endsWith('/members'))data=[{id:'member',role:'member',membership_status:'active'}];else if(u.pathname.endsWith('/gears_loans')){assert.equal(u.searchParams.get('member_id'),'eq.member');data=[];}else throw Error('unexpected query');return {ok:true,json:async()=>data};};
 try{let status=200;await handler({query:{action:'signature-data',id:'11111111-1111-4111-8111-111111111111'},method:'GET',headers:{authorization:'Bearer test'}},{setHeader(){},status(s){status=s;return this},json(){}});assert.equal(status,404);assert.equal(calls,0);}finally{globalThis.fetch=old;}
});
