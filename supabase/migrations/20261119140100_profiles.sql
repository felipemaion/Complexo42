-- Perfil e contato (issue #10, ADR 0003 e ADR 0008 §1). Lista fechada de campos em
-- docs/MODELO_DADOS.md; os grants e as políticas RLS ficam em `..._profiles_rls.sql`.
--
-- 1. `profiles` (1 por pessoa, `id` = `auth.users.id`) e `profile_contacts` (1:1, separada
--    para que listagens de perfis nunca tragam contato por engano).
-- 2. Dado pessoal só cifrado: as colunas `*_enc` guardam o valor que o servidor cifra em
--    `src/server/crypto/` (`v<n>.<iv>.<ct>`, AAD `tabela.coluna.id`). O banco não vê o texto:
--    os CHECKs abaixo só garantem o formato e um teto de tamanho. As regras do texto (nome de
--    2 a 80 caracteres, WhatsApp em E.164, até 5 URLs https) ficam no schema Zod de
--    `src/modules/profiles/domain/`, que o servidor aplica antes de cifrar.
-- 3. Triggers: a UF vem do município; `consent_at`, `created_at` e `updated_at` são do
--    servidor; ao gravar o município, a pessoa entra na unidade do seu estado
--    (`app.tg_join_state_unit`, da #46).
-- 4. `unit_members` e `role_assignments` passam a apontar para `profiles(id)` (mesmo id).

-- Valor cifrado no formato do ADR 0003 §3: versão, IV de 12 bytes (16 caracteres
-- base64url) e ciphertext com a tag de 16 bytes (22 ou mais caracteres base64url).
create or replace function app.is_encrypted_value(value text, max_length integer)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select value ~ '^v[1-9][0-9]{0,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'
    and char_length(value) <= max_length;
$$;

comment on function app.is_encrypted_value(text, integer) is
  'Formato v<n>.<iv>.<ct> do ADR 0003 §3 com teto de tamanho. Não decifra nada.';

-- ---------------------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Nome cifrado. 80 caracteres de até 4 bytes + tag cabem em ~470 caracteres base64url.
  display_name_enc text not null
    constraint profiles_display_name_enc_format
    check (app.is_encrypted_value(display_name_enc, 512)),
  municipality_code integer not null references public.municipalities (code),
  -- Derivada do município pelo trigger; o valor enviado é ignorado.
  state_code char(2) not null,
  -- Distrito da capital [?] (docs/MODELO_DADOS.md): texto curto, sem espaços nas pontas.
  district text
    constraint profiles_district_format
    check (char_length(district) between 2 and 60 and district = btrim(district)),
  -- Situação da conta na plataforma (`suspended` = suspensa pela coordenação).
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended')),
  -- Liberação pela lista de autorizados (ADR 0008 §1). Quem define é o servidor (#26), nunca
  -- o titular. Só perfis `active` aparecem para outras pessoas.
  access_status text not null default 'pending'
    check (access_status in ('pending', 'active', 'waitlisted', 'blocked')),
  consent_version text not null check (consent_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  -- Gravado pelo trigger quando `consent_version` muda.
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Perfil (id = auth.users.id). Nome só cifrado; papéis ficam em role_assignments (ADR 0002).';

create index profiles_municipality_code_idx on public.profiles (municipality_code);
create index profiles_state_code_idx on public.profiles (state_code);

alter table public.profiles enable row level security;

-- Antes de gravar: UF a partir do município e datas controladas pelo servidor.
create or replace function app.tg_profiles_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select m.state_code into new.state_code
  from public.municipalities as m
  where m.code = new.municipality_code;

  if new.state_code is null then
    raise exception 'município desconhecido'
      using errcode = 'foreign_key_violation';
  end if;

  if tg_op = 'INSERT' then
    new.consent_at := now();
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.consent_at := case
      when new.consent_version is distinct from old.consent_version then now()
      else old.consent_at
    end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function app.tg_profiles_before_write();

-- Ao gravar o município, entra na unidade do estado (ADR 0005 §2). A função compara a UF
-- nova com a antiga, então só age quando ela muda. O trigger é por `municipality_code`
-- porque a UF muda no BEFORE, e `UPDATE OF` só olha as colunas do SET.
create trigger profiles_join_state_unit
  after insert or update of municipality_code on public.profiles
  for each row execute function app.tg_join_state_unit();

-- ---------------------------------------------------------------------------------------
-- profile_contacts (1:1): WhatsApp e redes, com RLS mais restrita
-- ---------------------------------------------------------------------------------------
create table public.profile_contacts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  -- E.164 tem no máximo 16 caracteres: ~70 caracteres cifrado.
  whatsapp_enc text not null
    constraint profile_contacts_whatsapp_enc_format
    check (app.is_encrypted_value(whatsapp_enc, 128)),
  -- HMAC-SHA256 em hex de "wa:" + E.164 (ADR 0003 §3). Único: um WhatsApp, um cadastro.
  whatsapp_hmac text not null
    constraint profile_contacts_whatsapp_hmac_format
    check (whatsapp_hmac ~ '^[0-9a-f]{64}$'),
  -- JSON com até 5 URLs https (o Zod limita cada uma a 256 caracteres): ~1,8 mil cifrado.
  social_links_enc text
    constraint profile_contacts_social_links_enc_format
    check (app.is_encrypted_value(social_links_enc, 4096)),
  updated_at timestamptz not null default now(),
  constraint profile_contacts_whatsapp_hmac_key unique (whatsapp_hmac)
);

comment on table public.profile_contacts is
  'Contato (1:1 com profiles), só cifrado. Ver contato de outra pessoa é auditado pelo servidor.';

alter table public.profile_contacts enable row level security;

create or replace function app.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profile_contacts_set_updated_at
  before insert or update on public.profile_contacts
  for each row execute function app.tg_set_updated_at();

revoke execute on function
  app.tg_profiles_before_write(),
  app.tg_set_updated_at()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Vínculos e papéis passam a apontar para profiles (mesmo id de auth.users)
-- ---------------------------------------------------------------------------------------
-- Ninguém tem vínculo ou papel sem perfil. Apagar a conta (auth.users) apaga o perfil e, em
-- cascata, vínculos e papéis, como antes.
alter table public.unit_members
  drop constraint unit_members_profile_id_fkey,
  add constraint unit_members_profile_id_fkey
    foreign key (profile_id) references public.profiles (id) on delete cascade;

alter table public.role_assignments
  drop constraint role_assignments_profile_id_fkey,
  add constraint role_assignments_profile_id_fkey
    foreign key (profile_id) references public.profiles (id) on delete cascade,
  drop constraint role_assignments_granted_by_fkey,
  add constraint role_assignments_granted_by_fkey
    foreign key (granted_by) references public.profiles (id) on delete set null;

comment on column public.unit_members.profile_id is 'profiles.id (= auth.users.id).';
