-- Fix crítico (auditoría mensajería): envíos duplicados — estado transitorio
-- para el claim atómico del recipient. En migración propia porque ADD VALUE debe
-- commitear antes de poder usarse en el RPC de claim (migración siguiente).
alter type public.recipient_status add value if not exists 'sending' after 'pending';
