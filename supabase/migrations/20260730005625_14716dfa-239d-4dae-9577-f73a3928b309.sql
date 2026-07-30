CREATE TABLE public.app_messages (
  key text PRIMARY KEY,
  title text,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_messages TO anon;
GRANT SELECT ON public.app_messages TO authenticated;
GRANT ALL ON public.app_messages TO service_role;
ALTER TABLE public.app_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_messages_read" ON public.app_messages FOR SELECT USING (true);
CREATE POLICY "app_messages_admin_write" ON public.app_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER app_messages_updated_at BEFORE UPDATE ON public.app_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.app_messages (key, title, body) VALUES
 ('pending','Pendiente de aprobación','Tu cuenta fue creada correctamente. Un administrador debe aprobarla antes de que puedas ingresar al panel.'),
 ('rejected','Registro rechazado','El administrador rechazó tu solicitud de acceso. Escribinos si creés que fue un error.'),
 ('blocked','Cuenta bloqueada','Tu acceso fue bloqueado temporalmente. Contactá al administrador para reactivarlo.'),
 ('no_balance','Sin conversaciones disponibles','Se terminaron tus conversaciones. Recargá un plan para que la IA siga respondiendo automáticamente.');