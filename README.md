# Layer — Gestión de impresión 3D

MVP web para organizar encargos de impresión 3D. La interfaz es estática; puede ejecutarse en local o publicarse desde GitHub Pages.

## Incluye

- Dashboard con proyectos, entregas, pagos e actividad reciente.
- Registro rápido de proyectos, seguimiento de estado y duplicación.
- Plan sugerido de impresión que pondera prioridad, fecha límite y trabajos cortos.
- Registro de impresiones exitosas, fallidas o canceladas, con descuento de inventario.
- Materiales, pagos por proyecto, costos y cálculos de saldo y rentabilidad.
- Reportes básicos y adjuntos de fotos, STL, 3MF, OBJ y documentos.
- Diseño adaptable a móvil y respaldo descargable en JSON.

## Conectar con Supabase

1. En Supabase, abre **SQL Editor**, pega el contenido de [`supabase-setup.sql`](./supabase-setup.sql) y ejecútalo. Crea la tabla privada `workspace_state`, activa sus políticas RLS y prepara el bucket privado `project-files`.
2. En **Project Settings → API** copia la **Project URL** y la clave pública **Publishable key** (o la antigua clave **anon**). En [`supabase-config.js`](./supabase-config.js) reemplaza `YOUR_PROJECT_ID` y `YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`.
3. **Nunca uses ni publiques la `service_role` / secret key en el navegador.** La clave publishable/anon sí está diseñada para la aplicación web; las políticas RLS son las que restringen el acceso.
4. En Supabase, en **Authentication → URL Configuration**, añade el URL publicado de la aplicación a **Site URL / Redirect URLs**. Para probar en local, también añade `http://localhost:8000`.
5. Publica los cambios de GitHub. Abre el sitio, elige **Crear cuenta**, registra tu correo y contraseña e inicia sesión. Si la confirmación por correo está activada, confirma el mensaje antes de entrar.
6. Como la aplicación está pensada para una sola persona, después de crear tu cuenta puedes desactivar los nuevos registros en **Authentication → Settings**. No compartas tu contraseña.

Para probar desde esta carpeta sin abrir el archivo directamente, ejecuta `python -m http.server 8000` y visita `http://localhost:8000`.

### Persistencia y migración

Al iniciar sesión por primera vez, la aplicación carga la copia local de este navegador (si existe) y la sube a la nube. Después, los cambios se guardan en Supabase y se sincronizan cuando inicias sesión desde otra computadora. Los archivos adjuntos se guardan en el bucket privado. Descarga respaldos periódicamente desde **Reportes** o **Configuración**; el JSON de respaldo contiene los registros y referencias de archivos, pero no descarga los archivos binarios del bucket.

Este MVP guarda el estado completo de la cuenta como un documento JSONB en una fila privada de PostgreSQL, en lugar de separar aún cada entidad en tablas relacionales. Es simple para un único usuario y facilita la migración inicial; para uso concurrente o varios usuarios convendrá normalizar los datos y agregar control de conflictos.

Si `supabase-config.js` no contiene credenciales, la aplicación sigue disponible en modo local y muestra un aviso de que no sincroniza.
