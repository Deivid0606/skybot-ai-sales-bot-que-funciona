-- Comprobantes y documentos de WhatsApp: aceptar cualquier tipo de archivo
-- (Word, Excel, HEIC, AAC, sin tipo…). El depósito sigue privado y con 25 MB.
UPDATE storage.buckets SET allowed_mime_types = NULL WHERE id = 'chat-media';
