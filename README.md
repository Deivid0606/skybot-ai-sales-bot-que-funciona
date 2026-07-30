# Bot Sky Sales AI

Quiero que desarrolles una aplicación web SaaS completa llamada BOT SKY, enfocada en automatizar ventas por WhatsApp mediante inteligencia artificial.

La plataforma debe ser moderna, rápida, responsive y funcionar correctamente en computadoras y dispositivos móviles. Debe utilizar una arquitectura segura, escalable y multiusuario.

1. Objetivo principal

BOT SKY debe permitir que diferentes vendedores conecten sus cuentas de WhatsApp Business Cloud API, carguen sus productos, entrenen su propio asistente de inteligencia artificial, atiendan conversaciones, cierren ventas y administren pedidos.

La IA debe responder automáticamente siguiendo exclusivamente:

El entrenamiento configurado por cada vendedor.

El catálogo de productos de cada vendedor.

Las reglas generales del sistema.

Los horarios, cobertura, métodos de pago y datos bancarios configurados.

El contexto completo de la conversación.

El producto o anuncio desde el cual llegó el cliente.

Cada vendedor debe ver únicamente su propia información. El administrador debe poder visualizar y administrar todo el sistema.

2. Tecnologías sugeridas

Usar preferentemente:

React.

TypeScript.

Tailwind CSS.

Supabase.

PostgreSQL.

Supabase Auth.

Supabase Storage.

Supabase Realtime.

Row Level Security.

Edge Functions o backend seguro.

WhatsApp Business Cloud API.

Gemini API para inteligencia artificial.

Webhooks de Meta.

Google Sheets o Google Apps Script.

Sistema de almacenamiento para imágenes, videos, audios y comprobantes.

No exponer tokens, claves privadas ni credenciales en el frontend.

3. Roles y permisos

Administrador

El administrador puede:

Ver todos los usuarios.

Ver todas las conversaciones.

Ver todos los pedidos.

Ver todas las ventas.

Ver las métricas generales.

Crear, editar y eliminar planes.

Aprobar o rechazar registros.

Bloquear o desbloquear usuarios.

Cargar datos bancarios.

Configurar mensajes de aprobación, rechazo, bloqueo y renovación.

Consultar el consumo de conversaciones de cada usuario.

Ver en tiempo real cuántos mensajes recibe cada usuario.

Ver cuántas ventas cierra cada usuario.

Consultar el historial de compras de planes.

Modificar manualmente el saldo de conversaciones.

Acceder a los registros y errores del sistema.

Vendedor

El vendedor solamente puede:

Ver sus propios chats.

Ver sus propios productos.

Ver sus propios pedidos.

Ver sus propias ventas y métricas.

Configurar su bot.

Entrenar su propia IA.

Configurar su cuenta de WhatsApp.

Crear etiquetas.

Contratar planes.

Consultar su saldo de conversaciones.

Administrar sus archivos, productos y respuestas automáticas.

Implementar aislamiento total de datos mediante user_id, workspace_id o tenant_id, junto con políticas RLS.

4. Registro y aprobación

Cuando una persona se registra:

Su cuenta debe quedar con estado pending.

Debe mostrarse una pantalla de “Pendiente de aprobación”.

El administrador debe recibir una notificación.

El administrador puede aprobar o rechazar al usuario.

El administrador puede escribir un mensaje personalizado.

Al aprobarse, el vendedor podrá ingresar a su panel.

Si el usuario no tiene conversaciones disponibles, debe quedar bloqueado hasta contratar o recargar un plan.

Estados sugeridos:

pending

approved

rejected

blocked

active

suspended

5. Dashboard

Crear una pestaña llamada Dashboard.

Debe mostrar:

Mensajes recibidos.

Mensajes enviados.

Conversaciones consumidas.

Conversaciones disponibles.

Ventas cerradas.

Pedidos creados.

Tasa de conversión.

Tiempo promedio de respuesta.

Clientes atendidos.

Conversaciones atendidas por IA.

Conversaciones atendidas manualmente.

Facturación estimada.

Ventas por día, semana y mes.

Rendimiento por producto.

Rendimiento por anuncio.

Rendimiento por identificador de anuncio.

Cantidad de mensajes por anuncio.

Cantidad de ventas generadas por anuncio.

Valor vendido por anuncio.

Gráficos y filtros por rango de fecha.

El administrador debe poder filtrar estas métricas por vendedor.

6. Inbox o bandeja de conversaciones

Crear una pestaña llamada Inbox.

Debe incluir:

Lista de conversaciones en tiempo real.

Nombre del cliente.

Número de teléfono.

Último mensaje.

Hora del último mensaje.

Estado de lectura.

Etiquetas.

Producto relacionado.

Identificador del anuncio.

Vista previa de la imagen o video del anuncio.

Indicador de IA activa o pausada.

Indicador de conversación manual.

Indicador de venta cerrada.

Dentro del chat deben existir los siguientes controles:

Campo para responder manualmente.

Botón para enviar imágenes.

Botón para enviar videos.

Botón para enviar audios.

Botón para enviar documentos.

Botón para subir archivos desde la computadora.

Botón para enviar productos del catálogo.

Botón para enviar el copy, imágenes, videos o audios de un producto.

Botón para pausar la IA solamente en ese chat.

Botón para reactivar la IA.

Botón para solicitar que la IA genere una respuesta.

Botón para cerrar la venta.

Botón para agregar o quitar etiquetas.

Botón para eliminar el chat.

Botón para vaciar el historial.

Opción para seleccionar múltiples chats.

Acción masiva para eliminar chats.

Acción masiva para etiquetar conversaciones.

Filtros de búsqueda:

Por etiqueta.

Por nombre.

Por número de teléfono.

Por frase o texto.

Por producto.

Por ID del anuncio.

Por estado.

Por venta cerrada.

Por IA activa o pausada.

Por fecha.

Los mensajes deben actualizarse en tiempo real sin recargar la página.

7. Chat de prueba de IA

Crear una pestaña llamada Chat IA.

Debe permitir:

Probar conversaciones sin enviar mensajes reales.

Seleccionar un producto.

Simular un cliente.

Probar palabras clave.

Ver qué reglas de entrenamiento utilizó la IA.

Consultar qué producto detectó.

Ver el contexto enviado al modelo.

Reiniciar la conversación.

Comparar respuestas.

Mostrar errores de configuración.

Indicar si faltan datos del producto, entrenamiento o API Key.

8. Entrenamiento de la IA

Crear una pestaña llamada Entrenamiento.

Cada vendedor debe poder crear una cantidad ilimitada de entrenamientos.

Tipos de entrenamiento:

Reglas generales.

Forma de hablar.

Preguntas frecuentes.

Horarios de atención.

Cobertura.

Ciudades disponibles.

Precios de envío.

Datos bancarios.

Métodos de pago.

Políticas de cambios.

Políticas de devolución.

Información de productos.

Objeciones de clientes.

Técnicas de cierre.

Condiciones para pago anticipado.

Instrucciones especiales.

Mensajes que la IA no debe enviar.

Casos en los que debe transferir a un humano.

Cada entrenamiento debe tener:

Título.

Categoría.

Contenido.

Prioridad.

Estado activo o inactivo.

Fecha de creación.

Fecha de actualización.

Alcance general o por producto.

Horario opcional.

Palabras clave opcionales.

La IA debe priorizar las instrucciones específicas sobre las generales y nunca mezclar datos entre vendedores.

9. Productos

Crear una pestaña llamada Productos.

Cada producto debe permitir:

Nombre.

SKU.

Descripción.

Copy de venta.

Precio.

Precio promocional.

Stock.

Estado activo o inactivo.

Hasta 5 imágenes.

Hasta 5 videos.

Uno o varios audios.

Documentos adjuntos.

Palabras clave.

Variantes.

Información de entrega.

Instrucciones específicas para la IA.

Mensaje de seguimiento.

Tiempo para enviar el seguimiento.

Activar o desactivar seguimiento.

Evitar repetir la plantilla.

Evitar responder dos veces la misma información.

Asociar anuncios o identificadores de anuncios.

Cuando el cliente escriba una palabra clave, la IA debe detectar el producto correspondiente y responder utilizando su copy, archivos e instrucciones.

Debe existir una opción llamada No repetir plantilla, para evitar que la IA envíe nuevamente la misma respuesta cuando el cliente repita una palabra clave.

10. Seguimientos automáticos

Cada producto puede tener reglas de seguimiento.

Ejemplo:

Enviar un mensaje después de una hora sin respuesta.

Enviar únicamente si el último mensaje fue del vendedor o de la IA.

No enviar si el cliente ya compró.

No enviar si la conversación está cerrada.

No repetir el seguimiento.

Configurar minutos, horas o días.

Configurar varios seguimientos escalonados.

Pausar seguimientos por chat.

Registrar cuándo se ejecutó cada seguimiento.

11. Notificaciones

Crear una pestaña llamada Notificaciones.

Debe mostrar:

Ventas cerradas.

Pedidos nuevos.

Nuevos usuarios pendientes.

Planes próximos a agotarse.

Usuarios sin saldo.

Errores de WhatsApp.

Errores de webhook.

Errores de IA.

Pagos pendientes de aprobación.

Comprobantes recibidos.

Las notificaciones deben ser en tiempo real y permitir marcar como leídas.

12. Pedidos

Cuando una venta se cierre en el chat, se debe crear automáticamente un pedido.

Crear una pestaña llamada Pedidos, mostrando cada pedido en tarjetas o filas organizadas.

Cada pedido debe incluir:

Número de pedido único.

Nombre del cliente.

Número de teléfono.

Ciudad.

Departamento.

Calle.

Barrio.

Referencia.

Producto.

SKU.

Cantidad.

Precio.

Total.

Forma de pago.

Estado del pago.

Comprobante.

Observaciones.

Vendedor.

Fecha.

Hora.

Chat de origen.

Anuncio de origen.

Identificador del anuncio.

Estados y etiquetas sugeridos:

Nuevo.

Confirmado.

Cargado.

En preparación.

Enviado.

Entregado.

Cancelado.

Ecommerce.

Drop.

Pago anticipado.

Pendiente de pago.

Acciones:

Abrir el chat del cliente.

Ver vista previa de la conversación.

Ver comprobante.

Descargar comprobante.

Editar pedido.

Cambiar estado.

Copiar datos.

Enviar pedido a otra plataforma.

Consultar historial del cliente.

Filtrar y buscar pedidos.

13. Integración con plataforma externa

Agregar un botón en cada pedido para enviar los datos a:

https://www.el-ecommercedcanpgroup.com/

El sistema debe abrir la plataforma externa con los campos precargados mediante parámetros seguros o una integración API.

Campos sugeridos:

origen=seller-skyline

nombre

telefono

ciudad

departamento

calle

barrio

producto

cantidad

total

pago

observacion

Crear una función que genere una URL utilizando URLSearchParams.

Ejemplo conceptual:

const params = new URLSearchParams({
  origen: "seller-skyline",
  nombre: order.customer_name,
  telefono: order.phone,
  ciudad: order.city,
  departamento: order.departamento,
  calle: order.street,
  barrio: order.district,
  producto: order.product_title,
  cantidad: String(order.quantity),
  total: String(order.total),
  pago: order.payment_method,
});

window.open(
  `https://www.el-ecommercedcanpgroup.com/?${params.toString()}`,
  "_blank",
);


Antes de implementar esta integración, validar cuáles son los nombres exactos de los parámetros aceptados por la plataforma externa.

14. Etiquetas

Crear una pestaña llamada Etiquetas.

Cada vendedor puede:

Crear etiquetas.

Elegir nombre.

Elegir color.

Editar.

Eliminar.

Aplicar a chats.

Aplicar a pedidos.

Filtrar conversaciones.

Ejecutar acciones masivas.

Ejemplos:

Interesado.

Seguimiento.

Pago anticipado.

Venta cerrada.

No responde.

Mayorista.

Cliente recurrente.

Cancelado.

15. Planes y conversaciones

Crear una pestaña llamada Planes.

El administrador podrá:

Crear planes.

Editar planes.

Eliminar planes.

Definir nombre.

Definir precio.

Definir cantidad de conversaciones.

Definir duración.

Definir beneficios.

Activar o desactivar planes.

Cargar datos bancarios.

Configurar el mensaje de pago.

Aprobar recargas manualmente.

El vendedor podrá:

Ver los planes disponibles.

Seleccionar un plan.

Seleccionar cuántas conversaciones desea recargar.

Consultar el precio.

Ver los datos bancarios.

Subir un comprobante.

Enviar la solicitud de aprobación.

Consultar el estado del pago.

Ver su historial de compras.

Regla de consumo:

Un mensaje recibido equivale a una conversación consumida, según la definición comercial indicada.

Registrar cada consumo en una tabla de movimientos.

Evitar doble descuento por reintentos del webhook.

Utilizar identificadores únicos de mensajes para asegurar idempotencia.

Al llegar a cero, bloquear las respuestas automáticas y manuales según la configuración.

Mostrar un mensaje para contratar o recargar un plan.

Notificar al vendedor antes de quedarse sin saldo.

Notificar al administrador cuando un usuario se quede sin saldo.

El administrador debe ver:

Usuarios activos.

Plan activo.

Cantidad adquirida.

Cantidad consumida.

Cantidad disponible.

Fecha de compra.

Fecha de vencimiento.

Historial de recargas.

Comprobantes.

Estado de aprobación.

16. Configuraciones

Crear una pestaña llamada Configuraciones.

Debe contener:

WhatsApp Business Cloud API

ID del número de teléfono.

ID de la cuenta de WhatsApp Business.

ID de la aplicación de Meta.

Token permanente.

URL del webhook.

Token de verificación.

Estado de conexión.

Botón para probar conexión.

Botón para validar webhook.

Google Sheets

URL de Google Sheets.

URL del Apps Script Web App.

Botón para probar conexión.

Sincronización manual.

Registro de última sincronización.

Notificaciones de pedidos

Permitir configurar hasta tres números de WhatsApp para enviar notificaciones de nuevos pedidos, por ejemplo:

Dueño.

Encargado.

Repartidor.

Inteligencia artificial

API Key de Gemini.

Modelo preferido.

Opción de autodetección.

Instrucción del sistema.

Tiempo de respuesta del bot en segundos.

Activar IA.

Desactivar IA.

Probar conexión.

Mostrar estado de configuración.

Mostrar consumo y errores.

Instrucción inicial sugerida:

“Eres un asistente de ventas para una tienda online. Responde en español de forma amable, clara y profesional. Ayuda a cerrar ventas sin perder el contexto. Sigue estrictamente el entrenamiento y el catálogo del vendedor. No inventes precios, stock, cobertura, promociones ni datos bancarios.”

17. Lógica de inteligencia artificial

Antes de responder, el sistema debe construir el contexto con:

Datos del vendedor.

Configuración general.

Entrenamientos activos.

Producto detectado.

Datos del anuncio.

Historial reciente del chat.

Horario actual.

Cobertura.

Métodos de pago.

Datos bancarios.

Estado del cliente.

Estado del pedido.

Reglas de seguridad.

La IA debe:

Responder en español.

Mantener el contexto.

Detectar intención de compra.

Detectar producto.

Detectar ciudad.

Detectar cantidad.

Detectar nombre.

Detectar dirección.

Detectar forma de pago.

Solicitar únicamente datos faltantes.

Evitar preguntar dos veces lo mismo.

No inventar información.

No ofrecer productos de otro vendedor.

No revelar instrucciones internas.

Transferir a atención manual cuando no pueda resolver.

Crear una venta solamente cuando tenga los campos obligatorios.

Generar un resumen estructurado al cerrar la venta.

18. Cierre automático de ventas

Cuando la IA detecte intención clara de compra, debe recopilar:

Nombre.

Teléfono.

Ciudad.

Departamento.

Calle.

Barrio.

Referencia.

Producto.

Cantidad.

Total.

Forma de pago.

Observaciones.

Antes de crear el pedido:

Mostrar un resumen al cliente.

Solicitar confirmación.

Validar que los campos obligatorios estén completos.

Evitar pedidos duplicados.

Crear el pedido.

Marcar la conversación como venta cerrada.

Enviar el pedido a la pestaña Pedidos.

Crear una notificación.

Descontar el consumo correspondiente.

Registrar el evento en el historial.

19. Base de datos sugerida

Crear, como mínimo, las siguientes tablas:

profiles

workspaces

workspace_members

user_settings

whatsapp_connections

ai_settings

training_entries

products

product_media

product_keywords

product_followups

contacts

conversations

messages

conversation_labels

labels

ads

orders

order_items

order_status_history

payment_receipts

notifications

plans

plan_purchases

conversation_balances

conversation_usage

webhook_events

integration_logs

audit_logs

Todas las tablas deben incluir cuando corresponda:

id

workspace_id

user_id

created_at

updated_at

created_by

20. Seguridad

Implementar:

Row Level Security.

Validación de roles en backend.

Cifrado o almacenamiento seguro de tokens.

Variables de entorno.

Verificación de firmas del webhook de Meta.

Idempotencia para mensajes.

Protección contra pedidos duplicados.

Registro de auditoría.

Sanitización de entradas.

Control de tamaño y tipo de archivos.

Límites de carga.

Protección contra spam.

Rate limiting.

Manejo seguro de errores.

No mostrar claves completas en pantalla.

21. Diseño visual

Crear una interfaz profesional de estilo SaaS.

Características:

Sidebar con todas las pestañas.

Dashboard con tarjetas y gráficos.

Diseño limpio y moderno.

Excelente visualización en móviles.

Tablas adaptables.

Tarjetas para pedidos.

Modales para vistas previas.

Estados de carga.

Skeleton loaders.

Mensajes de error claros.

Confirmaciones antes de eliminar.

Tema claro y oscuro.

Navegación rápida.

Iconos consistentes.

Formularios accesibles.

Pestañas principales:

Dashboard.

Inbox.

Chat IA.

Entrenamiento.

Notificaciones.

Pedidos.

Productos.

Etiquetas.

Planes.

Configuraciones.

Pestañas exclusivas del administrador:

Usuarios pendientes.

Usuarios activos.

Métricas en tiempo real.

Administración de planes.

Pagos y recargas.

Registros del sistema.

Configuración global.

22. Requisitos de desarrollo

No crear solamente una maqueta visual.

La aplicación debe incluir:

Base de datos funcional.

Autenticación.

Roles.

RLS.

CRUD completo.

Webhooks.

Procesamiento de mensajes.

Integración con IA.

Almacenamiento de archivos.

Actualizaciones en tiempo real.

Gestión de planes.

Control de consumo.

Creación automática de pedidos.

Integración externa.

Validaciones.

Manejo de errores.

Datos de demostración.

Documentación de instalación.

Desarrollar el proyecto por fases:

Fase 1

Autenticación.

Roles.

Registro pendiente.

Panel base.

Base de datos.

Seguridad RLS.

Fase 2

Productos.

Entrenamiento.

Configuraciones.

Etiquetas.

Fase 3

Integración de WhatsApp.

Webhook.

Inbox en tiempo real.

Envío de archivos.

Pausar y reactivar IA.

Fase 4

Integración con Gemini.

Detección de productos.

Seguimientos.

Chat de prueba.

Fase 5

Cierre de ventas.

Pedidos.

Comprobantes.

Integración con plataforma externa.

Fase 6

Planes.

Recargas.

Control de conversaciones.

Bloqueo por falta de saldo.

Fase 7

Dashboard.

Métricas por anuncio.

Auditoría.

Optimización.

Pruebas finales.

Genera primero:

La arquitectura completa.

El esquema de base de datos.

Las políticas RLS.

El mapa de pantallas.

El flujo de mensajes de WhatsApp.

El flujo de cierre de ventas.

El sistema de consumo de conversaciones.

La estructura de carpetas.

Las variables de entorno.

El plan de implementación.

Después, comienza a generar el código funcional módulo por módulo. No omitas funcionalidades, no uses datos simulados como implementación final y no reemplaces integraciones reales con botones decorativos.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/98ba0d38-38e8-4996-b806-e9d9b5bda379).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
