-- Private bucket for progress photos. Access only through signed URLs issued by the API.
insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;
