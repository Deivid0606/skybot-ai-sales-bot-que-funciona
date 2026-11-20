-- Archivos de productos: aceptar cualquier imagen, video o audio (mp3, m4a, ogg/opus, wav,
-- amr, flac…) hasta 50 MB. Antes solo JPG/PNG/WEBP/GIF y MP4: todo audio se rechazaba.
update storage.buckets
set allowed_mime_types = array['image/*','video/*','audio/*'],
    file_size_limit = 52428800
where id = 'product-media';
