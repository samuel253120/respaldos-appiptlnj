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
