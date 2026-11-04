# Layer — Gestión de impresión 3D

MVP web para organizar encargos de impresión 3D. No requiere instalación: abre `index.html` en un navegador moderno.

## Incluye

- Dashboard con proyectos, entregas, pagos e actividad reciente.
- Registro rápido de proyectos, seguimiento de estado y duplicación.
- Plan sugerido de impresión que pondera prioridad, fecha límite y trabajos cortos.
- Registro de impresiones exitosas, fallidas o canceladas, con descuento de inventario.
- Materiales, pagos por proyecto, costos y cálculos de saldo y rentabilidad.
- Reportes básicos y adjuntos de fotos, STL, 3MF, OBJ y documentos.
- Diseño adaptable a móvil y respaldo descargable en JSON.

## Datos y almacenamiento

Esta primera entrega es un MVP local: proyectos y movimientos se guardan en `localStorage`, y los archivos adjuntos en `IndexedDB` del navegador. Los datos no se sincronizan entre dispositivos ni se envían a un servidor. Descarga periódicamente un respaldo desde **Reportes** o **Configuración**.

El backend multiusuario y la persistencia en una base de datos relacional quedan como siguiente etapa; esta versión no conecta todavía a una base de datos. Para empezar con datos limpios, usa **Configuración → Restaurar datos de ejemplo**.
