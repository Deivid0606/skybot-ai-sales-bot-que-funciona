-- BOT SKY: push para saldo bajo/ag otado, solicitudes de recarga/registro y recargas acreditadas.
-- Compatible con migracion 20261022090000_botsky_push_notifications.sql.
-- Ejecutar en SQL Editor de la base de datos correcta; revisar previamente.
BEGIN;

-- Extendemos solamente el tipo de evento, sin alterar la cola ni el cron existentes.
ALTER TABLE public.botsky_push_outbox DROP CONSTRAINT IF EXISTS botsky_push_outbox_event_type_check;
ALTER TABLE public.botsky_push_outbox ADD CONSTRAINT botsky_push_outbox_event_type_check
  CHECK (event_type IN ('sale','news','balance_low','balance_empty','topup_request','topup_credited','signup_request'));

CREATE OR REPLACE FUNCTION public.botsky_push_balance_alerts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- En el momento de bajar de >20 a <=20, una vez por ciclo de consumo.
  IF OLD.available > 20 AND NEW.available <= 20 AND NEW.available > 0 THEN
    INSERT INTO public.botsky_push_outbox(user_id,event_type,title,body,click_url,event_key)
    VALUES (NEW.user_id, 'balance_low', '⚠️ ¡Tu saldo está por agotarse!',
      'Te quedan ' || NEW.available || ' conversaciones. Recargá para que tu bot no se detenga.',
      '/planes', 'balance_low:' || NEW.id::text || ':' || NEW.consumed::text)
    ON CONFLICT DO NOTHING;
  END IF;

  IF OLD.available > 0 AND NEW.available <= 0 THEN
    INSERT INTO public.botsky_push_outbox(user_id,event_type,title,body,click_url,event_key)
    VALUES (NEW.user_id, 'balance_empty', '🚨 ¡Sin conversaciones disponibles!',
      'Tu saldo llegó a cero. Recargá para que tu bot siga respondiendo.',
      '/planes', 'balance_empty:' || NEW.id::text || ':' || NEW.consumed::text)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Se notifica cuando efectivamente sube el saldo, no solamente al aprobar una solicitud.
  IF NEW.available > OLD.available AND NEW.purchased > OLD.purchased THEN
    INSERT INTO public.botsky_push_outbox(user_id,event_type,title,body,click_url,event_key)
    VALUES (NEW.user_id, 'topup_credited', '✅ ¡Tu saldo fue recargado!',
      'Se acreditaron ' || (NEW.purchased - OLD.purchased)::text ||
      ' conversaciones. Nuevo saldo: ' || NEW.available::text || '.',
      '/planes', 'topup_credited:' || NEW.id::text || ':' || NEW.purchased::text)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS botsky_push_balance_alerts_trigger ON public.conversation_balances;
CREATE TRIGGER botsky_push_balance_alerts_trigger
AFTER UPDATE OF available, purchased, consumed ON public.conversation_balances
FOR EACH ROW EXECUTE FUNCTION public.botsky_push_balance_alerts();

CREATE OR REPLACE FUNCTION public.botsky_push_purchase_alerts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE admin_user record;
BEGIN
  IF NEW.status = 'pendiente' THEN
    FOR admin_user IN SELECT DISTINCT ur.user_id FROM public.user_roles ur
                      JOIN public.profiles p ON p.id = ur.user_id
                      WHERE ur.role = 'admin' AND p.status IN ('approved','active') LOOP
      INSERT INTO public.botsky_push_outbox(user_id,event_type,title,body,click_url,event_key)
      VALUES (admin_user.user_id, 'topup_request', '💳 Nueva solicitud de recarga',
        'La tienda solicitó ' || NEW.conversations::text || ' conversaciones. Revisá la solicitud.',
        '/admin/pagos', 'topup_request:' || NEW.id::text)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS botsky_push_purchase_alerts_trigger ON public.plan_purchases;
CREATE TRIGGER botsky_push_purchase_alerts_trigger
AFTER INSERT ON public.plan_purchases
FOR EACH ROW EXECUTE FUNCTION public.botsky_push_purchase_alerts();

CREATE OR REPLACE FUNCTION public.botsky_push_signup_alerts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE admin_user record;
BEGIN
  IF NEW.status = 'pending' THEN
    FOR admin_user IN SELECT DISTINCT ur.user_id FROM public.user_roles ur
                      JOIN public.profiles p ON p.id = ur.user_id
                      WHERE ur.role = 'admin' AND p.status IN ('approved','active') LOOP
      INSERT INTO public.botsky_push_outbox(user_id,event_type,title,body,click_url,event_key)
      VALUES (admin_user.user_id, 'signup_request', '👤 Nuevo usuario solicita acceso',
        COALESCE(NULLIF(NEW.company,''),NULLIF(NEW.full_name,''),'Un usuario') || ' solicita acceso a BOT SKY.',
        '/admin/usuarios', 'signup_request:' || NEW.id::text)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS botsky_push_signup_alerts_trigger ON public.profiles;
CREATE TRIGGER botsky_push_signup_alerts_trigger
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.botsky_push_signup_alerts();

REVOKE ALL ON FUNCTION public.botsky_push_balance_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.botsky_push_purchase_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.botsky_push_signup_alerts() FROM PUBLIC, anon, authenticated;
COMMIT;
