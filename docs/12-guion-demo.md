# Guion de la demo

**Requerimiento:** F10-6 (Issue #81: `docs(demo): grabar el video o demo del sistema`)
**Duración estimada:** 6 a 8 minutos
**Recorrido:** ingreso → organización → clientes → categorías → movimientos → factura en borrador → facturar → cobro parcial → dashboard.

## Qué es real y qué es simulado

Decirlo en el video, de entrada. Si no se aclara, parece que se emitió una factura fiscal:

- **Simulado:** la autorización. El backend corre con `ARCA_PROVIDER=simulated`, así que el CAE lo genera un cliente simulado y **no tiene validez fiscal**. La pantalla lo avisa con el texto "Comprobante de prueba, sin validez fiscal".
- **Real:** todo lo demás. Los datos viven en PostgreSQL; las cuentas, clientes, movimientos, cobros y el dashboard son los del sistema; la cotización sugerida sale del BCRA.
- **Pendiente:** la primera autenticación y emisión reales contra homologación de ARCA (issue #138). No se muestra en la demo.

## Antes de grabar

Este guion describe el recorrido sobre el release de `main`.

1. Levantar todo con el script del repositorio (`./scripts/dev.sh`) o, a mano, siguiendo la sección "Cómo levantar el proyecto" del [README](../README.md):
   - PostgreSQL en Docker (puerto 5433).
   - Backend en `http://localhost:3000`, con `ARCA_PROVIDER=simulated` en `backend/.env` (sin esa variable el backend no arranca).
   - Frontend en `http://localhost:5173`, con `VITE_USE_MOCKS=false` para usar el backend real.
2. Cargar los datos de prueba con `pnpm db:seed`. Crea el usuario `demo@monotributo.com` con la contraseña `Password123!`, una organización, un punto de venta, clientes y categorías.
3. Sesión cerrada en el navegador, zoom entre 100 % y 110 %.
4. Probar el recorrido completo una vez antes de grabar. Una factura facturada no se puede deshacer: para repetir la demo hay que volver a crear los datos con el seed.

## Recorrido

### 0:00 a 0:45: presentación
- **Pantalla:** `/login`.
- **Decir:** qué problema resuelve (el monotributista factura en un lado y lleva su plata en otro) y la idea central: facturar, cobrar y mover plata son tres cosas distintas.
- Aclarar que la autorización con ARCA es simulada (ver arriba).

### 0:45 a 1:30: ingreso y organización
- Iniciar sesión con `demo@monotributo.com`.
- Abrir **Organización** (`/organizacion`) y mostrar CUIT, razón social y condición frente al IVA.

### 1:30 a 2:30: clientes y categorías
- **Clientes** (`/clientes`): mostrar el listado, buscar uno y entrar al detalle para ver su historial. Mostrar la baja lógica (un cliente dado de baja no se borra).
- **Categorías** (`/categorias`): mostrar las de ingreso y egreso y crear una nueva.

### 2:30 a 3:45: movimientos
- **Movimientos** (`/movimientos`): registrar un egreso en pesos.
- Registrar un ingreso en dólares y mostrar que el formulario sugiere la cotización del BCRA, que se puede cambiar. Explicar que el tipo de cambio queda guardado en el movimiento.
- Probar los filtros por fecha, tipo y categoría.

### 3:45 a 5:15: factura en borrador y facturar
- **Facturas** (`/facturas`) → **Nueva factura** (`/facturas/nueva`).
- Elegir el cliente "Estudio Contable García & Asoc.", concepto **Servicios** (se proponen el mes de la factura y el vencimiento a 30 días) y un ítem: "Consultoría técnica mensual", cantidad 1, precio 250000. Mostrar el total estimado y aclarar que el backend lo vuelve a calcular.
- **Crear borrador**. En el detalle se ve el estado **Borrador** y que todavía no se puede cobrar.
- **Facturar** y confirmar. Se ve el CAE y el aviso "Comprobante de prueba, sin validez fiscal". Decir que acá, con el proveedor real, se pediría el CAE a ARCA.

### 5:15 a 6:30: cobro parcial
- En la factura autorizada, **Importe a cobrar**: 100000 y **Registrar cobro**. El estado pasa a **Cobrada en parte** y el saldo baja a $ 150.000,00.
- Explicar que cada cobro genera su propio movimiento de ingreso (nunca uno por la factura completa) y que el control de saldo corre dentro de una transacción de base de datos con bloqueo de fila, para que dos cobros simultáneos no superen el total.

### 6:30 a 7:30: dashboard
- **Dashboard** (`/`): Total Facturado, Total Cobrado y "Facturado menos cobrado en el período".
- Diferenciar **Resultado de caja** (plata que entró menos plata que salió) de **Resultado de gestión** (facturado más ingresos manuales menos egresos).
- Mostrar el gráfico por categoría.

### 7:30 a 8:00: cierre
- Resumir lo que funciona y decir qué falta: la prueba real contra homologación de ARCA, el PDF del comprobante, la reconciliación de facturas pendientes y el despliegue público.

## Checklist de grabación

- [ ] Audio claro, sin ruido de fondo.
- [ ] 1080p.
- [ ] Se aclara que la autorización es simulada.
- [ ] No se muestran contraseñas reales, certificados ni claves de ARCA.
- [ ] El recorrido se probó completo antes de grabar.
