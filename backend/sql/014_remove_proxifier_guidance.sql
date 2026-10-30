-- JPN client direction update: remove the legacy Proxifier compatibility guidance.
-- Run after migrations 001 through 013 in Supabase SQL Editor.

delete from public.jpn_compatibility_entries
where lower(name) = 'proxifier';

update public.jpn_compatibility_entries
set name = 'Discord app',
    details = 'Listed as working through the current JPN client setup.',
    notes = 'Keep the JPN connection client running. Availability can still depend on your network and Discord service status.',
    link = 'https://discord.com/download',
    updated_at = now()
where lower(name) in ('discord app (without proxifier)', 'discord app');

update public.jpn_compatibility_entries
set name = 'Steam app',
    details = 'Listed as working through the current JPN client setup.',
    notes = 'Keep the JPN connection client running. Store, downloads, sign-in, and individual games can behave differently depending on network rules.',
    link = 'https://store.steampowered.com/about/',
    updated_at = now()
where lower(name) in ('steam app (without proxifier)', 'steam app');

update public.jpn_compatibility_entries
set name = 'Google Chrome on Windows ARM64',
    status = 'untested',
    category = 'Browser',
    details = 'Full Chrome traffic routing on Windows ARM64 has not yet been verified with the current JPN client.',
    notes = 'A standalone JPN VPN client with full-device tunnel support is a separate development project.',
    link = null,
    updated_at = now()
where lower(name) like 'google chrome on windows arm64%';

update public.jpn_compatibility_entries
set name = 'Minecraft Java Edition',
    status = 'untested',
    category = 'Game',
    details = 'Minecraft Java Edition has not yet been verified with the current JPN client without separate application-routing software.',
    notes = 'A full-device JPN VPN client is needed for the intended simple experience. Server compatibility may also vary.',
    link = null,
    updated_at = now()
where lower(name) like 'minecraft java edition%';

update public.jpn_compatibility_entries
set notes = 'Roblox is not currently supported by JPN.',
    updated_at = now()
where lower(name) = 'roblox';
