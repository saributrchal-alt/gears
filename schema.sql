-- Run in the SAME Supabase project as watt.nathoeng.com.
-- Only creates gears_* objects; does not modify library or member records.
begin;
create table if not exists public.gears_categories (
 id text primary key, name text not null unique
);
insert into public.gears_categories values
 ('tools','เครื่องมือช่าง'),('garden','งานสวนและเกษตร'),('cleaning','อุปกรณ์ทำความสะอาด'),
 ('kitchen','เครื่องครัวและภาชนะ'),('events','งานบุญและกิจกรรม'),('electrical','เครื่องใช้ไฟฟ้า'),
 ('audio','เครื่องเสียงและสื่อ'),('other','ของใช้อื่น ๆ') on conflict do nothing;
create table if not exists public.gears_items (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 200),
 category_id text not null references public.gears_categories(id), description text not null default '',
 image_url text not null default '', unit text not null default 'ชิ้น', active boolean not null default true,
 created_at timestamptz not null default now()
);
create sequence if not exists public.gears_asset_seq;
create table if not exists public.gears_assets (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.gears_items(id),
 code text not null unique default ('NTG-'||lpad(nextval('public.gears_asset_seq')::text,8,'0')),
 location text not null default '', notes text not null default '',
 status text not null default 'available' check(status in ('available','reserved','on_loan','repair','retired')),
 created_at timestamptz not null default now()
);
create sequence if not exists public.gears_loan_seq;
create table if not exists public.gears_loans (
 id uuid primary key default gen_random_uuid(), number text not null unique default ('GEAR-'||lpad(nextval('public.gears_loan_seq')::text,8,'0')),
 member_id text not null, borrower_name text not null, phone text not null,
 purpose text not null, terms_version text not null,
 status text not null default 'pending' check(status in ('pending','approved','on_loan','return_pending','returned','rejected','cancelled')),
 requested_at timestamptz not null default now(), due_date date not null,
 handed_at timestamptz, returned_at timestamptz
);
create table if not exists public.gears_loan_items (
 id uuid primary key default gen_random_uuid(), loan_id uuid not null references public.gears_loans(id),
 asset_id uuid not null references public.gears_assets(id), item_name text not null, asset_code text not null,
 active boolean not null default true, return_condition text, returned_at timestamptz,
 unique(loan_id,asset_id)
);
create unique index if not exists gears_one_active_loan on public.gears_loan_items(asset_id) where active;
create index if not exists gears_assets_item on public.gears_assets(item_id,status);
create index if not exists gears_loans_member on public.gears_loans(member_id,requested_at desc);
create table if not exists public.gears_events (
 id bigint generated always as identity primary key, loan_id uuid references public.gears_loans(id),
 asset_id uuid references public.gears_assets(id), actor_id text not null, action text not null,
 note text not null default '', created_at timestamptz not null default now()
);
-- All access is through the server API; no browser access to member/loan data.
alter table public.gears_categories enable row level security;
alter table public.gears_items enable row level security;
alter table public.gears_assets enable row level security;
alter table public.gears_loans enable row level security;
alter table public.gears_loan_items enable row level security;
alter table public.gears_events enable row level security;
revoke all on public.gears_categories,public.gears_items,public.gears_assets,public.gears_loans,public.gears_loan_items,public.gears_events from anon,authenticated;
grant select,insert,update on public.gears_categories,public.gears_items,public.gears_assets,public.gears_loans,public.gears_loan_items,public.gears_events to service_role;
grant usage,select on sequence public.gears_asset_seq,public.gears_loan_seq,public.gears_events_id_seq to service_role;

create or replace function public.gears_require_actor(p_actor text,p_staff boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.members where id::text=p_actor and coalesce(membership_status,'active')='active' and (not p_staff or role='admin')) then
  raise exception 'ไม่มีสิทธิ์ทำรายการ';
 end if;
end $$;

create or replace function public.gears_reserve(p_actor text,p_lines jsonb,p_phone text,p_purpose text,p_due date,p_terms text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_loan public.gears_loans%rowtype; v_item public.gears_items%rowtype; v_line jsonb; v_asset public.gears_assets%rowtype; v_qty int; v_count int; v_name text;
begin
 perform public.gears_require_actor(p_actor);
 if p_terms is distinct from '2026-09-27' or p_due is null or p_due<(now() at time zone 'Asia/Bangkok')::date or p_due>(now() at time zone 'Asia/Bangkok')::date+365 then raise exception 'กรุณาตรวจสอบเงื่อนไขและกำหนดคืน'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 20 or length(trim(p_phone)) not between 8 and 30 or length(trim(p_purpose)) not between 1 and 1000 then raise exception 'ข้อมูลคำขอไม่ครบ'; end if;
 if (select count(*) from public.gears_loans where member_id=p_actor and status in ('pending','approved','on_loan','return_pending'))>=20 then raise exception 'มีรายการค้างอยู่ครบ 20 รายการ กรุณาติดต่อเจ้าหน้าที่'; end if;
 select coalesce(nullif(full_name,''),nullif(display_name,''),'สมาชิก') into v_name from public.members where id::text=p_actor;
 insert into public.gears_loans(member_id,borrower_name,phone,purpose,terms_version,due_date) values(p_actor,v_name,p_phone,p_purpose,p_terms,p_due) returning * into v_loan;
 -- Deterministic item locks serialize reservations and avoid overselling/deadlocks.
 for v_line in select value from jsonb_array_elements(p_lines) order by value->>'itemId' loop
  v_qty:=(v_line->>'quantity')::int;
  if v_qty is null or v_qty not between 1 and 50 then raise exception 'จำนวนไม่ถูกต้อง'; end if;
  select * into v_item from public.gears_items where id=(v_line->>'itemId')::uuid and active for update;
  if not found then raise exception 'ไม่พบอุปกรณ์'; end if;
  v_count:=0;
  for v_asset in select * from public.gears_assets where item_id=v_item.id and status='available' order by code limit v_qty for update loop
   insert into public.gears_loan_items(loan_id,asset_id,item_name,asset_code) values(v_loan.id,v_asset.id,v_item.name,v_asset.code);
   update public.gears_assets set status='reserved' where id=v_asset.id;
   v_count:=v_count+1;
  end loop;
  if v_count<>v_qty then raise exception 'อุปกรณ์ % มีจำนวนพร้อมให้ยืมไม่พอ กรุณาค้นหาใหม่',v_item.name; end if;
 end loop;
 insert into public.gears_events(loan_id,actor_id,action,note) values(v_loan.id,p_actor,'pending','ส่งคำขอยืม • รับและคืนที่วัดเท่านั้น');
 return to_jsonb(v_loan);
end $$;

create or replace function public.gears_transition(p_loan uuid,p_actor text,p_action text,p_note text default '',p_due date default null,p_conditions jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.gears_loans%rowtype; v_staff boolean; v_next text; v_line public.gears_loan_items%rowtype; v_condition text;
begin
 perform public.gears_require_actor(p_actor);
 select role='admin' into v_staff from public.members where id::text=p_actor;
 select * into v from public.gears_loans where id=p_loan for update;
 if not found or (not v_staff and v.member_id<>p_actor) then raise exception 'ไม่พบรายการ'; end if;
 if p_action in ('approve','reject','handover','accept_return') and not v_staff then raise exception 'เฉพาะเจ้าหน้าที่'; end if;
 if p_action='approve' and v.status='pending' then
  if p_due is null or p_due<(now() at time zone 'Asia/Bangkok')::date or p_due>(now() at time zone 'Asia/Bangkok')::date+365 then raise exception 'กรุณาระบุกำหนดคืนที่ถูกต้อง'; end if;
  v_next:='approved'; update public.gears_loans set due_date=p_due where id=v.id;
 elsif p_action='reject' and v.status='pending' then v_next:='rejected';
 elsif p_action='cancel' and v.status in ('pending','approved') then v_next:='cancelled';
 elsif p_action='handover' and v.status='approved' then
  v_next:='on_loan'; update public.gears_loans set handed_at=now() where id=v.id;
  update public.gears_assets set status='on_loan' where id in(select asset_id from public.gears_loan_items where loan_id=v.id);
 elsif p_action='request_return' and v.status='on_loan' then v_next:='return_pending';
 elsif p_action='accept_return' and v.status in ('on_loan','return_pending') then
  v_next:='returned';
  for v_line in select * from public.gears_loan_items where loan_id=v.id order by asset_id loop
   v_condition:=p_conditions->>v_line.asset_id::text;
   if v_condition is null or v_condition not in ('available','repair') then raise exception 'ต้องตรวจสภาพอุปกรณ์ทุกชิ้นก่อนรับคืน'; end if;
   update public.gears_assets set status=v_condition where id=v_line.asset_id;
   update public.gears_loan_items set active=false,returned_at=now(),return_condition=v_condition where id=v_line.id;
  end loop;
  update public.gears_loans set returned_at=now() where id=v.id;
 else raise exception 'สถานะเปลี่ยนไปแล้ว หรือไม่อนุญาตให้ทำรายการนี้ กรุณาอัปเดต';
 end if;
 if v_next in ('cancelled','rejected') then
  update public.gears_assets set status='available' where id in(select asset_id from public.gears_loan_items where loan_id=v.id);
  update public.gears_loan_items set active=false where loan_id=v.id;
 end if;
 update public.gears_loans set status=v_next where id=v.id returning * into v;
 insert into public.gears_events(loan_id,actor_id,action,note) values(v.id,p_actor,v_next,left(coalesce(p_note,''),1000));
 return to_jsonb(v);
end $$;

create or replace function public.gears_receive(p_item uuid,p_actor text,p_quantity int,p_location text,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
begin
 perform public.gears_require_actor(p_actor,true);
 if p_quantity is null or p_quantity not between 1 and 100 then raise exception 'รับเข้าได้ครั้งละ 1–100 ชิ้น'; end if;
 perform 1 from public.gears_items where id=p_item and active for update;
 if not found then raise exception 'ไม่พบอุปกรณ์'; end if;
 with added as (insert into public.gears_assets(item_id,location,notes) select p_item,left(p_location,200),left(p_note,1000) from generate_series(1,p_quantity) returning id)
 insert into public.gears_events(asset_id,actor_id,action,note) select id,p_actor,'receive',left(p_note,1000) from added;
 return p_quantity;
end $$;

create or replace function public.gears_asset_action(p_asset uuid,p_actor text,p_status text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare v public.gears_assets%rowtype;
begin
 perform public.gears_require_actor(p_actor,true);
 select * into v from public.gears_assets where id=p_asset for update;
 if not found or v.status not in ('available','repair','retired') or p_status not in ('available','repair','retired') then raise exception 'ต้องรับคืนหรือยกเลิกคำขอก่อนเปลี่ยนสถานะ'; end if;
 update public.gears_assets set status=p_status where id=p_asset;
 insert into public.gears_events(asset_id,actor_id,action,note) values(p_asset,p_actor,p_status,left(p_note,1000));
end $$;
revoke all on function public.gears_require_actor(text,boolean),public.gears_reserve(text,jsonb,text,text,date,text),public.gears_transition(uuid,text,text,text,date,jsonb),public.gears_receive(uuid,text,integer,text,text),public.gears_asset_action(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.gears_require_actor(text,boolean),public.gears_reserve(text,jsonb,text,text,date,text),public.gears_transition(uuid,text,text,text,date,jsonb),public.gears_receive(uuid,text,integer,text,text),public.gears_asset_action(uuid,text,text,text) to service_role;
commit;
