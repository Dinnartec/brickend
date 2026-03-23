-- Reference table for identification document types (Colombia + international)

create table if not exists public.identification_types (
  slug        text primary key,
  name        text not null,
  description text not null default '',
  format      text not null default '',   -- human-readable mask, e.g. '999.999.999-9'
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create trigger identification_types_updated_at
  before update on public.identification_types
  for each row execute function update_updated_at();

alter table public.identification_types enable row level security;

-- Everyone (authenticated) can read active types
create policy "authenticated can read active identification types"
  on public.identification_types for select
  using (auth.role() = 'authenticated' and is_active = true and deleted_at is null);

-- Service role has full access
create policy "service role full access"
  on public.identification_types for all
  using (auth.role() = 'service_role');

-- Seed: Colombian + common international identification types
insert into public.identification_types (slug, name, description, format) values
  ('NIT',       'NIT',                        'Número de Identificación Tributaria — personas jurídicas y naturales con actividad económica', '999.999.999-9'),
  ('CC',        'Cédula de Ciudadanía',        'Documento de identidad para ciudadanos colombianos mayores de edad',                          '1.234.567.890'),
  ('TI',        'Tarjeta de Identidad',        'Documento de identidad para menores de edad colombianos (10–17 años)',                         '1234567890'),
  ('RC',        'Registro Civil',              'Documento de identidad para menores de edad colombianos (0–9 años)',                           '1234567890'),
  ('CE',        'Cédula de Extranjería',       'Documento de identidad para extranjeros residentes en Colombia',                              '1234567890'),
  ('TE',        'Tarjeta de Extranjería',      'Documento de identidad para extranjeros menores de edad residentes en Colombia',               '1234567890'),
  ('PASAPORTE', 'Pasaporte',                   'Documento de viaje internacional',                                                            'AB123456'),
  ('PEP',       'PEP',                         'Permiso Especial de Permanencia — ciudadanos venezolanos',                                    'PEP1234567890'),
  ('PPT',       'PPT',                         'Permiso por Protección Temporal — ciudadanos venezolanos',                                    'PPT1234567890'),
  ('RUT',       'RUT',                         'Registro Único Tributario — equivalente al NIT para personas naturales sin actividad económica', '999.999.999-9')
on conflict (slug) do nothing;
