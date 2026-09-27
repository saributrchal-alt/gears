import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/gears.js';
const response=data=>({ok:true,status:200,json:async()=>data});
async function invoke(action,body={},method='POST'){
 const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
 await handler({method,query:{action},headers:{authorization:'Bearer test'},body},res);return res;
}
test('API never permits member staff actions and requires explicit consent',async()=>{
 const old=globalThis.fetch;
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test';
 let writes=0;
 globalThis.fetch=async(url,options)=>{if(url.includes('gears-verify'))return response({sub:'member'});if(url.includes('/members?'))return response([{id:'member',role:'member',membership_status:'active'}]);writes++;return response([]);};
 try{
  assert.equal((await invoke('transition',{operation:'accept_return',loanId:'11111111-1111-1111-1111-111111111111'})).code,403);
  assert.equal((await invoke('item',{name:'test'})).code,403);
  assert.equal((await invoke('reserve',{lines:[{itemId:'11111111-1111-1111-1111-111111111111',quantity:1}],accepted:false})).code,400);
  assert.equal(writes,0);
 }finally{globalThis.fetch=old;}
});
