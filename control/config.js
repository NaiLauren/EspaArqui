// Credenciales del proyecto de Supabase.
//
// Estos dos valores son públicos por diseño: la clave "publishable" (antes
// llamada anon) sólo sirve para identificar al proyecto, y lo que cada usuario
// puede ver o tocar lo deciden las políticas RLS de la base, no esta clave.
// Por eso el archivo va al repositorio sin problema.
//
// La que NO va nunca acá es la clave de servicio (service_role): esa saltea
// RLS y daría acceso total a cualquiera que mire el código fuente de la
// página.
//
// Los valores salen de Supabase > Project Settings > API.

export const SUPABASE_URL = "https://mrmqwaotfhbfxqmnqmly.supabase.co";
export const SUPABASE_KEY = "sb_publishable_AVh-dbbnAIVzeBnHW64uFA_qVNubyqR";
