begin;
create table if not exists public.gears_loan_signatures (
 loan_id uuid primary key references public.gears_loans(id),
 borrower_name text not null, staff_name text not null, staff_id text not null,
 borrower_url text not null, staff_url text not null,
 signed_at timestamptz not null default now()
);
alter table public.gears_loan_signatures enable row level security;
revoke all on public.gears_loan_signatures from public,anon,authenticated;
grant select,insert on public.gears_loan_signatures to service_role;
create or replace function public.gears_signed_handover(p_loan uuid,p_actor text,p_borrower_url text,p_staff_url text,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.gears_loans%rowtype; v_name text; result jsonb;
begin
 perform public.gears_require_actor(p_actor,true);
 select * into v from public.gears_loans where id=p_loan for update;
 if not found or v.status<>'approved' then raise exception 'สถานะเปลี่ยนไปแล้ว กรุณาอัปเดตรายการ'; end if;
 if p_borrower_url is null or p_staff_url is null or p_borrower_url !~ '^https://media[.]nathoeng[.]com/signatures[.]php[?]id=[a-f0-9]{32}$' or p_staff_url !~ '^https://media[.]nathoeng[.]com/signatures[.]php[?]id=[a-f0-9]{32}$' or p_borrower_url=p_staff_url then raise exception 'ลายเซ็นไม่ครบหรือที่อยู่ไม่ถูกต้อง'; end if;
 select coalesce(nullif(full_name,''),nullif(display_name,''),'เจ้าหน้าที่') into v_name from public.members where id::text=p_actor;
 result:=public.gears_transition(p_loan,p_actor,'handover',p_note,null,'{}'::jsonb);
 insert into public.gears_loan_signatures(loan_id,borrower_name,staff_name,staff_id,borrower_url,staff_url)
 values(p_loan,v.borrower_name,v_name,p_actor,p_borrower_url,p_staff_url);
 return result;
end $$;
revoke all on function public.gears_signed_handover(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.gears_signed_handover(uuid,text,text,text,text) to service_role;
commit;
