# Documentos de referencia

## `credencial-pastor.html`

El **diseño oficial aprobado** de la credencial pastoral. No se rediseña, no se
reinterpreta y no se modifica: es el original contra el que se compara lo que
imprime el sistema.

De él se trasladaron al sistema la hoja de estilos, la estructura del anverso y
del reverso, el generador de códigos QR, el ajuste automático de texto, la
lógica de impresión plegable y el cálculo del dígito verificador.

Lo único que **no** se trasladó son las tres imágenes que lleva incrustadas en
base64 —el logo, el sello y la firma del Pastor Presidente— porque en el sistema
se cargan desde Configuración y se guardan como archivos, no dentro de la base.

## `especificacion-credenciales.txt`

La especificación de implementación del módulo, tal como se recibió.

Dos puntos están escritos pensando en otro sistema y se tradujeron a lo que este
tiene, con el mismo efecto:

| Dice la especificación | En este sistema |
|---|---|
| Guardar en R2 | El volumen de datos, que ya entra en el respaldo |
| «documento sincronizado» | La base SQLite: nunca se guardan imágenes en base64 dentro de ella |
| `churchId` | `iglesia_id` y el alcance por iglesia que ya usan los 32 módulos |

## Variables del servidor que pide el módulo de credenciales

| Variable | Para qué | Si falta |
|---|---|---|
| `CREDENCIAL_SECRETO` | Firmar el código de autenticidad que va dentro del código QR | El sistema arranca igual, avisa en el registro y usa una clave de reserva que está **escrita en el código y es pública**: cualquiera podría fabricar el código de una credencial falsa |

Para generar una:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Se pone una sola vez, al publicar.** Si se cambia después, los códigos de las
credenciales ya impresas dejan de validar.

### La página pública de verificación

Al escanear el código QR de una credencial se abre `…/v/<número de serie>?c=<código>`
**sin pedir sesión**: es la única dirección del sistema que muestra datos de una
persona a quien no ha entrado. Conviene saber tres cosas de ella:

- Sin el código correcto no muestra **nada**, y responde exactamente lo mismo
  ante un número inventado que ante un número real con el código cambiado. Así,
  probar números no sirve para averiguar qué credenciales existen.
- Del RUT muestra solo los tres últimos dígitos y el verificador, para que quien
  verifica los compare con la tarjeta que tiene en la mano.
- Tiene un tope de intentos errados por minuto desde una misma conexión, que se
  ajusta en **Configuración → Recursos de la credencial**. Solo cuentan los que
  fallan: quien escanea credenciales de verdad puede verificar todas las que
  quiera.

Para que funcione hace falta que el sistema esté publicado en internet con un
dominio: la dirección que va dentro del QR se arma con el dominio por el que se
entró a emitir la credencial.

## Volver atrás si algo sale mal

La credencial pastoral entró entre las versiones **1.73.0 y 1.78.0**. Volver
atrás tiene un punto sin retorno y conviene tenerlo claro antes de publicar.

### Antes de publicar la 1.73.0: bájese el respaldo

**Configuración → Respaldo → Bajar el respaldo completo.** No es una formalidad:
al arrancar por primera vez con la 1.73.0, el sistema **borra todas las
credenciales que hubiera cargadas** y deja el correlativo en cero. Es lo que se
pidió (punto 13.1 de la especificación), se hace una sola vez y **no se
deshace**. Queda constancia en el Registro de Cambios.

Guarde ese respaldo en otra parte —no en el mismo servidor— y anote los conteos
que muestra `node pruebas/conteos.js`, para poder compararlos después.

### Volver a una versión anterior

1. **Publique la versión anterior** del programa (en el proveedor: volver al
   despliegue previo, o publicar el commit anterior).
2. **Restaure el respaldo** que bajó antes de la 1.73.0.

Las columnas y las tablas que agregó la credencial —`credenciales`,
`credencial_contador`, las opciones nuevas de configuración— **no estorban a una
versión anterior**: sobran, y una versión que no las conoce sencillamente no las
mira. Así que si lo único que se quiere es volver el programa atrás sin perder
lo cargado desde entonces, basta con el paso 1.

### Lo único que no vuelve

Las credenciales que había antes de la 1.73.0. Si se restaura el respaldo, están
ahí; si no se bajó el respaldo, se perdieron. Por eso el respaldo va primero.

### Volver atrás dentro de la credencial

Entre la 1.73.0 y la 1.78.0 no hay nada que deshacer: cada versión agrega, y
ninguna borra datos de la anterior. Publicar la 1.75.0 estando en la 1.78.0
deja de mostrar la página de verificación y los permisos nuevos, pero las
credenciales emitidas siguen ahí con su número y sus datos.

**Ojo con `CREDENCIAL_SECRETO`:** si se cambia esa clave, los códigos de todas
las credenciales ya impresas dejan de validar y aparecen como no válidas. No es
parte de volver atrás; es algo que no se toca nunca después de publicar.
