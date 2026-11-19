# Respaldo y restauración local

Estos comandos respaldan la base independiente de PGlite. No usan ABIES ni un servidor PostgreSQL externo. Incluyen el catálogo, personas, calendario, movimientos, procedimientos, restricciones y secuencias. No incluyen `.env`, la clave de Google Books ni los archivos de la aplicación.

## Crear una copia

1. Detener la aplicación con **Ctrl+C** en su terminal. No hace falta cerrar VSCode.
2. Ejecutar:

```powershell
npm.cmd run db:backup
```

El comando comprueba el acceso exclusivo, crea una copia comprimida, la abre en memoria y compara el contenido de todas las tablas de la biblioteca. Solo después guarda el archivo y muestra su ruta dentro de `.local/respaldos/`. Cada archivo tiene un nombre distinto: no reemplaza respaldos anteriores.

Después se puede volver a ejecutar `npm.cmd start`. Copiar el archivo `.biblioteca` a otra unidad o almacenamiento elegido por el grupo permite conservarlo aunque falle este equipo. El archivo contiene los datos de las personas y no está cifrado; no se incorpora al repositorio.

## Comprobar un archivo

Sustituir la ruta de ejemplo por la que mostró el comando anterior, manteniendo las comillas:

```powershell
npm.cmd run db:verificar -- "C:\ruta\biblioteca-fecha.biblioteca"
```

Se comprueba su suma SHA-256, la versión de PGlite, la apertura del respaldo en memoria y el contenido de las tablas. Esto no modifica la base activa y puede ejecutarse mientras la aplicación está abierta. La suma detecta archivos cortados o alterados; no acredita quién los creó. Usar archivos producidos por esta instalación o por una copia confiable del mismo proyecto.

## Restaurar por separado

```powershell
npm.cmd run db:restaurar -- "C:\ruta\biblioteca-fecha.biblioteca"
```

Se crea una base en una carpeta nueva dentro de `.local/restauraciones/`. Después se cierra y se vuelve a abrir para comprobar que los datos persistieron. El comando muestra la ruta resultante. No sobrescribe la base activa y no acepta como destino una carpeta existente.

Para usar esa restauración como base principal:

1. Detener la aplicación y cualquier comando que use la base.
2. En el explorador de archivos, conservar la carpeta `.local/biblioteca` cambiándole el nombre por uno libre, por ejemplo `biblioteca-anterior-2026-11-19`. No combinar carpetas.
3. Mover la carpeta restaurada que indicó el comando a `.local/` y nombrarla `biblioteca`.
4. Iniciar con `npm.cmd start` y revisar el catálogo y movimientos. Mantener la carpeta anterior hasta comprobar el resultado.

La activación es manual para que el comando de prueba no reemplace los datos con los que están trabajando. El proyecto no realiza automáticamente esos cambios de carpetas.

## Alcance

- El respaldo requiere la misma versión de PGlite que lo creó, registrada en el archivo. No es un archivo SQL para importar en PostgreSQL nativo.
- El límite de archivo es 256 MB; está pensado para el prototipo local. La comprobación carga el respaldo en memoria y compara todas las tablas.
- No se ejecutan actualizaciones del esquema durante la creación o la comprobación. Al iniciar normalmente la aplicación, se aplican las actualizaciones habituales.
- La creación rechaza una base ocupada o inexistente; no elimina bloqueos ajenos ni crea una base vacía por accidente.
- Todavía no hay programación automática, cifrado ni política de conservación de varias copias. Crear una copia antes de cargas importantes y conservar otra fuera del equipo sigue siendo una tarea del grupo.
