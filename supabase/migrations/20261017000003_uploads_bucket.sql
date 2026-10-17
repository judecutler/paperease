-- photos and PDFs caregivers send by SMS. Private: the app serves them through /api/files with the secret key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);
