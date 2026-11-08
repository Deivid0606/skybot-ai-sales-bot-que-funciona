-- Pestañas «Zonas de cobertura» y «Datos bancarios»: cada vendedor carga lo suyo.
-- Cuando una tienda tiene filas en workspace_coverage, esa tabla es la fuente
-- oficial de ciudades y modalidades del bot (reemplaza la lista escrita en el
-- entrenamiento). Sin filas, el bot sigue leyendo el entrenamiento como antes.

CREATE TABLE IF NOT EXISTS public.workspace_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  city text NOT NULL,
  department text NOT NULL,
  method text NOT NULL DEFAULT 'sin_envio' CHECK (method IN ('contraentrega','encomienda','sin_envio')),
  shipping_fee numeric CHECK (shipping_fee IS NULL OR shipping_fee >= 0),
  address_required boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, city, department)
);
CREATE INDEX IF NOT EXISTS workspace_coverage_ws_idx ON public.workspace_coverage(workspace_id);

CREATE TABLE IF NOT EXISTS public.workspace_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bank text NOT NULL,
  holder text NOT NULL,
  account_number text,
  alias text,
  document text,
  note text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_bank_accounts_ws_idx ON public.workspace_bank_accounts(workspace_id);

ALTER TABLE public.workspace_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Cada vendedor ve y edita SOLO lo de su tienda; el admin puede leer (soporte).
DROP POLICY IF EXISTS workspace_coverage_member_all ON public.workspace_coverage;
CREATE POLICY workspace_coverage_member_all ON public.workspace_coverage
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS workspace_coverage_admin_read ON public.workspace_coverage;
CREATE POLICY workspace_coverage_admin_read ON public.workspace_coverage
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS workspace_bank_accounts_member_all ON public.workspace_bank_accounts;
CREATE POLICY workspace_bank_accounts_member_all ON public.workspace_bank_accounts
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS workspace_bank_accounts_admin_read ON public.workspace_bank_accounts;
CREATE POLICY workspace_bank_accounts_admin_read ON public.workspace_bank_accounts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_coverage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_bank_accounts TO authenticated;
GRANT ALL ON public.workspace_coverage TO service_role;
GRANT ALL ON public.workspace_bank_accounts TO service_role;
