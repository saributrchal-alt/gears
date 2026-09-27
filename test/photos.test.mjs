import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodePhoto,uploadPhoto} from '../lib/photo-upload.js';
import handler from '../api/gears.js';
const bytes=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(30),Buffer.from([255,217])]);
const sample='data:image/jpeg;base64,'+bytes.toString('base64');
test('photo validation rejects wrong format, oversized and invalid JPEG',()=>{
 assert.equal(decodePhoto(sample).length,35);
 for(const value of ['data:image/svg+xml;base64,PHN2Zz4=',sample.replace('jpeg','png'),'data:image/jpeg;base64,'+Buffer.alloc(50).toString('base64'), 'x'.repeat(700000)])assert.throws(()=>decodePhoto(value));
});
test('storage creates public image-only bucket once and uploads compressed bytes',async()=>{
 const old=globalThis.fetch;const calls=[];
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test';
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return calls.length===1?{ok:false,status:404}:{ok:true,status:200};};
 try{const result=await uploadPhoto(sample);assert.match(result.url,/\/public\/gears-photos\/[a-f0-9-]+\.jpg$/);assert.equal(calls.length,3);const config=JSON.parse(calls[1].options.body);assert.equal(config.file_size_limit,512000);assert.deepEqual(config.allowed_mime_types,['image/jpeg']);assert.equal(calls[2].options.body.length,35);}finally{globalThis.fetch=old;}
});
test('non-admin cannot upload photos or create storage buckets',async()=>{
 const old=globalThis.fetch;let storageCalls=0;
 globalThis.fetch=async url=>{if(url.includes('gears-verify'))return {ok:true,status:200,json:async()=>({sub:'member'})};if(url.includes('/members?'))return {ok:true,status:200,json:async()=>[{id:'member',role:'member',membership_status:'active'}]};storageCalls++;throw Error('Unexpected storage request');};
 const res={code:200,setHeader(){},status(c){this.code=c;return this;},json(d){this.data=d;return this;}};
 try{await handler({query:{action:'photo'},method:'POST',headers:{authorization:'Bearer token'},body:{image:sample}},res);assert.equal(res.code,403);assert.equal(storageCalls,0);}finally{globalThis.fetch=old;}
});
