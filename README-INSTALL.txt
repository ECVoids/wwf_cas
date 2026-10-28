# WWF Juntos por la vida — Canje de premios

## Archivos
- `src/App.tsx`: versión de la interfaz con la pestaña de administrador **Canje de premios**.
- `supabase/migration_point_redemptions.sql`: crea el historial de canjes y las funciones RPC necesarias.

## Instalación

1. Haz una copia de seguridad de tu proyecto actual.
2. Reemplaza `src/App.tsx` por el `App.tsx` incluido.
3. En Supabase, abre **SQL Editor**, pega y ejecuta TODO `migration_point_redemptions.sql` una sola vez.
4. Confirma que `public.is_admin_name(...)` reconoce el usuario administrador configurado para la app (por ejemplo, `cas-admin`).
5. Ejecuta localmente `npm run build`.
6. Si compila correctamente, confirma los cambios en Git y haz `git push` para activar el despliegue de Vercel.

## Qué hace
- Añade la pestaña de administrador **Canje de premios**.
- Permite buscar un participante, ver puntos base, multiplicador, puntos ya canjeados y saldo disponible.
- Permite ingresar el nombre del premio y la cantidad de puntos a descontar.
- Valida en PostgreSQL que el descuento sea positivo y no supere el saldo disponible.
- Registra cada canje en `point_redemptions`, incluyendo usuario, cantidad, premio, administrador y fecha.
- El descuento es atómico por participante: la función bloquea el perfil para evitar canjes simultáneos que gasten el mismo saldo.
- El saldo del participante muestra los puntos acumulados después de restar los puntos canjeados.

Importante: la app actual identifica al administrador por nombre de usuario y no verifica la identidad. Esta migración conserva ese modelo existente; no convierte el acceso en autenticación segura.
