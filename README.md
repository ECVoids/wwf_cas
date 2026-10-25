# WWF Juntos por la vida — aplicación de puntos

Aplicación web responsive construida con React, TypeScript, Vite y Supabase. Incluye un modo de demostración local para revisar el flujo sin configurar backend.

## Funcionalidades incluidas

- Acceso por nombre de usuario y creación automática de perfil.
- Perfil con puntos base y total calculado con multiplicador.
- Listado de actividades, contraseña de validación y estado de cumplimiento.
- Contraseñas aleatorias al crear actividades.
- Panel administrativo: crear, editar, activar/desactivar actividades, consultar/copiar códigos y asignar multiplicadores.
- Esquema PostgreSQL con restricción única por usuario/actividad y funciones RPC para centralizar validaciones.
- Diseño responsive para móvil y escritorio.

## 1. Ejecutar localmente en modo demo

Requiere Node.js 20 o superior.

```bash
npm install
npm run dev
```

Abre la URL local que indique Vite. Sin variables de Supabase, la aplicación se ejecuta en modo demo y guarda datos en el navegador actual. La demo no sincroniza usuarios entre dispositivos y no es adecuada para una feria real con premios.

## 2. Configurar Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor** y ejecuta `supabase/schema.sql`.
3. En **Project Settings → API**, copia la URL del proyecto y la clave pública `anon`.
4. Copia `.env.example` a `.env` y completa:

```env
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_PUBLICA_ANON
VITE_ADMIN_USERNAME=admin-feria
```

5. Reinicia el servidor de desarrollo. No pongas la `service_role` key en variables `VITE_` ni en el navegador.

## 3. ¿Dónde cambiar el usuario administrador?

En `src/App.tsx`, busca la constante al inicio del archivo:

```ts
const ADMIN_USERNAME = (import.meta.env.VITE_ADMIN_USERNAME || 'admin-feria').trim().toLowerCase();
```

Puedes cambiar el valor de respaldo `'admin-feria'` o definir `VITE_ADMIN_USERNAME` en `.env`. El mismo nombre debe coincidir con el literal `admin-feria` de `public.is_admin_name()` en `supabase/schema.sql`; cambia ese literal y vuelve a ejecutar la función `CREATE OR REPLACE` correspondiente si eliges otro nombre.

## 4. Seguridad: leer antes de desplegar

El requisito de entrar solo con un nombre de usuario impide verificar que quien escribe un nombre sea su propietario. El nombre de administrador también puede ser suplantado. El código SQL separa las contraseñas de las actividades del catálogo público y aplica restricciones de base de datos, pero las funciones RPC reciben el nombre como parámetro: eso **no constituye autenticación**. No uses esta versión para premios, datos personales o entornos donde los usuarios no deban poder suplantarse.

Para producción, el cambio mínimo recomendado es:

- Usar Supabase Auth para identificar a cada usuario (por ejemplo, enlace mágico o código de un solo uso) y asociar `profiles.id` con `auth.uid()`.
- Dar a los logísticos una cuenta autenticada con rol `admin`, controlada por políticas RLS y comprobada dentro de cada función RPC.
- Hacer que las funciones de cumplimiento obtengan el usuario desde `auth.uid()` y no desde un parámetro `p_username`.
- Limitar los intentos de validar códigos y registrar eventos administrativos.

Si la feria exige estrictamente no usar contraseñas para participantes, puedes conservar el nombre como identificador visible y añadir un PIN o código temporal de recuperación para reducir la suplantación. No existe un mecanismo fiable para distinguir a dos personas que introducen exactamente el mismo nombre si no hay ningún secreto o dispositivo autenticado.

## 5. Comportamiento del multiplicador

Se guardan los puntos originales en `completions.points_awarded`. El total mostrado se calcula como:

`total = suma de puntos base × multiplicador actual`

El multiplicador se aplica al total acumulado y cambiarlo a `×1` restaura la visualización al total base. Esta versión permite multiplicadores entre `×1` y `×10`.

## 6. Compilar

```bash
npm run build
```

La carpeta `dist/` resultante se puede desplegar en Vercel o en un hosting estático. Configura las variables de entorno también en el proveedor de despliegue.

## Actualización: multiplicadores acumulativos

Si ya tienes una base de datos Supabase creada, ejecuta una sola vez `supabase/migration_cumulative_multipliers.sql` en **Supabase → SQL Editor**. Esto registra cada factor aplicado y acumula el producto (por ejemplo, ×2 y luego ×1,5 = ×3). Los multiplicadores históricos que fueron reemplazados antes de esta actualización no se pueden reconstruir; el valor actual se conserva como un factor inicial.

Si vas a crear la base de datos desde cero, el archivo `supabase/schema.sql` ya incluye la estructura nueva.


## Eliminar actividades

Para actualizar una base de datos Supabase existente, ejecuta una sola vez `supabase/migration_delete_activity.sql` desde SQL Editor. En el panel administrativo aparecerá la opción **Eliminar**. Por seguridad, la función impide borrar actividades que ya tengan cumplimientos registrados, ya que estos registros conservan el historial y los puntos de los participantes; para esas actividades utiliza **Desactivar**.

## Imágenes opcionales en actividades

Para una base de datos Supabase ya existente, abre `supabase/migration_activity_images.sql` y ejecútalo una sola vez desde **Supabase → SQL Editor**. La migración agrega `image_data` y actualiza las funciones administrativas para guardar la imagen opcional.

En el formulario de crear/editar actividad puedes elegir una imagen de hasta 400 KB. Se guarda como data URL en la columna `activities.image_data`, por lo que no se necesita configurar Storage. Las imágenes se muestran en las tarjetas de actividades. Para quitar una imagen durante la edición, pulsa **Quitar imagen** y guarda los cambios.

Nota: como las imágenes se almacenan en la base de datos, mantén los archivos pequeños (máximo 400 KB por imagen).


## Eliminación lógica de actividades

Para actualizar una instalación existente, ejecuta `supabase/migration_delete_activity.sql` en Supabase SQL Editor. La acción Eliminar oculta la actividad a participantes y administradores, marca `is_deleted = true` y la desactiva, sin borrar sus cumplimientos, contraseñas ni puntos históricos. Los usuarios normales solo consultan actividades con `is_deleted = false`.


## Identidad visual WWF Juntos por la vida

La interfaz usa la paleta verde del manual de marca (#00BF63 y #122C12), blanco y negro, evitando el azul en los componentes de interfaz. Los logotipos WWF y CAS proporcionados se guardan en `public/wwf-logo.png` y `public/cas-logo.jpg` y se muestran en el acceso y la cabecera.

## Últimas modificaciones (Epik / WWF)

- El inicio de sesión comprueba si el nombre ya existe y muestra una confirmación para entrar a esa cuenta o cambiar el nombre y registrar otra.
- El campo de acceso usa el texto `Ingresa tu usuario de Epik`.
- El panel administrativo tiene decoración selvática lateral y pestañas con fondo verde tenue.
- Al crear o editar una actividad, el administrador debe definir la contraseña personalizada.

### Migración para contraseñas personalizadas

En Supabase, abre **SQL Editor → New query**, copia y ejecuta `supabase/migration_custom_activity_password.sql`. Esta migración agrega la versión de `admin_update_activity` que recibe el parámetro `p_password`. No elimina actividades ni cumplimientos existentes.

Al desplegar o reemplazar los archivos, conserva el archivo `.env`. Los nombres de usuario no constituyen una autenticación fuerte: como el acceso no tiene contraseña, cualquiera que conozca un nombre puede entrar a esa cuenta.
