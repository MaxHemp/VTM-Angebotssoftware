-- HINWEIS: Vorlage. Die fertig befüllte Fassung (mit echtem Resend-Key)
-- erzeugt die App unter Einstellungen → E-Mail-Einladungen → SQL erzeugen.
-- __RESEND_API_KEY__ vor dem Ausführen ersetzen.

-- ADAM · E-Mail-Einladungen: einmaliges Setup (Supabase SQL Editor)
create extension if not exists pg_net;

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  otp text not null,
  invited_by text,
  app_url text,
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;
drop policy if exists "invite insert" on public.invites;
create policy "invite insert" on public.invites
  for insert to anon with check (true);
-- kein select für anon: Einmalpasswörter sind über die API nicht auslesbar

create table if not exists public.mail_secrets (k text primary key, v text not null);
alter table public.mail_secrets enable row level security;
-- keine Policies: der Key ist über die API nicht erreichbar
insert into public.mail_secrets (k,v) values
  ('resend_key','__RESEND_API_KEY__'),
  ('mail_from','ADAM · VTM Angebotsdesk <adam@versicherungstech-magazin.de>'),
  ('allowed_domains','versicherungstech-magazin.de')
on conflict (k) do update set v = excluded.v;

create or replace function public.send_invite_mail() returns trigger
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  rkey text; sender text; domains text; dom text; ok boolean := false; html text;
begin
  select v into rkey    from public.mail_secrets where k = 'resend_key';
  select v into sender  from public.mail_secrets where k = 'mail_from';
  select v into domains from public.mail_secrets where k = 'allowed_domains';
  foreach dom in array string_to_array(coalesce(domains, ''), ',') loop
    if lower(new.email) like '%@' || lower(trim(dom)) then ok := true; end if;
  end loop;
  if not ok or rkey is null then return new; end if;

  html :=
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#121e39">'
    || '<div style="background:#121e39;padding:22px 28px;color:#ffffff">'
    ||   '<div style="font-size:17px;font-weight:bold">VersicherungsTech Magazin</div>'
    ||   '<div style="font-size:11px;letter-spacing:2px;color:#dce8ff">ADAM &middot; ANGEBOTSDESK</div>'
    || '</div>'
    || '<div style="height:3px;background:#123fa6"></div>'
    || '<div style="padding:26px 28px;background:#ffffff;border:1px solid #dce1e9;border-top:none">'
    ||   '<p style="margin:0 0 12px">Hallo ' || coalesce(new.name, '') || ',</p>'
    ||   '<p style="margin:0 0 16px;line-height:1.6">' || coalesce(new.invited_by, 'das VTM-Team')
    ||     ' hat Dich zur Zusammenarbeit in <b>ADAM</b> eingeladen &ndash; dem Angebotsdesk des VersicherungsTech Magazins f&uuml;r Angebote, Vertr&auml;ge und Rechnungen.</p>'
    ||   '<table style="width:100%;background:#f2f6ff;border-left:3px solid #123fa6;font-size:14px" cellpadding="8" cellspacing="0">'
    ||     '<tr><td style="color:#3f4958;width:140px">Benutzername</td><td><b>' || new.email || '</b></td></tr>'
    ||     '<tr><td style="color:#3f4958">Einmalpasswort</td><td><b style="font-family:Consolas,monospace">' || new.otp || '</b></td></tr>'
    ||   '</table>'
    ||   '<p style="margin:20px 0"><a href="' || new.app_url || '" style="background:#123fa6;color:#ffffff;text-decoration:none;padding:11px 22px;font-weight:bold;border-radius:5px;display:inline-block">Jetzt bei ADAM anmelden</a></p>'
    ||   '<p style="margin:0;font-size:12.5px;color:#3f4958;line-height:1.6">Beim ersten Login legst Du direkt Dein pers&ouml;nliches Passwort fest &ndash; das Einmalpasswort wird damit ung&uuml;ltig. Bei Fragen wende Dich an ' || coalesce(new.invited_by, 'die Administration') || '.</p>'
    || '</div></div>';

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || rkey, 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'from', sender,
      'to', jsonb_build_array(new.email),
      'subject', 'Deine Einladung zu ADAM – dem VTM Angebotsdesk',
      'html', html)
  );
  return new;
end
$fn$;

drop trigger if exists trg_invite_mail on public.invites;
create trigger trg_invite_mail
  after insert on public.invites
  for each row execute function public.send_invite_mail();
