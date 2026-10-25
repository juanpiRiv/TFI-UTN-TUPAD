## Qué cambia

<!-- Qué hace este PR y por qué, en pocas líneas. -->

## Cómo probarlo

<!-- Pasos o comandos para verificarlo (`pnpm test`, pantalla a abrir, etc.). Qué no se pudo probar. -->

## Issue

<!-- PR hacia `develop`: `Refs #n` (no cierra el issue; quien mergea lo cierra a mano).
     PR hacia `main`: `Closes #n`. -->
Refs #

## Checklist

- [ ] `pnpm lint`, `pnpm build` y `pnpm test` pasan.
- [ ] Si cambia el esquema: hay migración, `database/schema.sql` regenerado y docs/03 actualizado.
- [ ] Si cambia un endpoint: `docs/08-contrato-api.md` actualizado.
- [ ] No hay secretos, `.env`, certificados ni claves en el diff.
