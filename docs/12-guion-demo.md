# Guion y Estructura de la Demo en Video

**Requerimiento:** F10-6 (Issue #81: `docs(demo): grabar el video o demo del sistema`)  
**Duración estimada:** 5 a 7 minutos  
**Objetivo:** Demostrar de forma fluida el recorrido funcional completo de la plataforma: **Login → Onboarding / Organización → Clientes → Categorías → Facturación Electrónica (ARCA) → Cobranza / Pagos → Dashboard Financiero**.

---

## 1. Preparación Previa (Antes de Grabar)

1. **Servidores locales activos:**
   - Base de datos PostgreSQL en contenedor Docker (`port 5433`).
   - Backend Express corriendo en `http://localhost:3000`.
   - Frontend Vite corriendo en `http://localhost:5173`.
2. **Navegador limpio:**
   - Ventana en modo incógnito o sesión cerrada para mostrar el login inicial.
   - Zoom al 100% o 110% para legibilidad óptima de tipografías y tablas.
3. **Datos de prueba sugeridos:**
   - **Usuario demo:** `demo@monotributo.com` / `password123!`
   - **Cliente de ejemplo:** Razón Social `Estudio Contable García & Asoc.`, CUIT `30-71234567-8`.
   - **Ítem de factura:** `Consultoría técnica mensual`, Cantidad: `1`, Precio: `$ 250.000,00`.

---

## 2. Minuto a Minuto del Recorrido

### Minuto 0:00 - 0:45 | Introducción y Presentación del Problema
- **Qué se muestra en pantalla:** Pantalla de Inicio de Sesión (`/login`).
- **Qué decir:**
  > "Buenas tardes. En esta demo presentamos nuestra plataforma integral de facturación y gestión financiera para monotributistas, desarrollada para el Trabajo Final Integrador de la Tecnicatura Universitaria en Programación de Sistemas de la UTN.
  > El sistema resuelve el desfasaje cotidiano entre emitir facturas en ARCA y controlar la caja real del negocio, unificando cobranzas, movimientos multimoneda y métricas de gestión en una única aplicación web ágil y segura."

---

### Minuto 0:45 - 1:30 | Autenticación y Onboarding de la Organización
- **Qué se muestra en pantalla:**
  1. Iniciar sesión con el usuario demo (`demo@monotributo.com`).
  2. Navegar a Configuración de la Organización (`/organizacion` o perfil).
- **Qué destacar:**
  - CUIT fiscal y Razón Social del monotributista.
  - Condición frente al IVA (`Monotributo`) y categoría.
  - Moneda base en Pesos Argentinos (`ARS`).
  - Punto de Venta fiscal habilitado para facturación electrónica.

---

### Minuto 1:30 - 2:30 | Gestión de Clientes y Categorías de Caja
- **Qué se muestra en pantalla:**
  1. Ir al módulo de **Clientes** (`/clientes`).
     - Mostrar el listado con CUIT, Razón Social, Condición Tributaria y estado activo.
     - Mostrar que cada cliente cuenta con un historial de comprobantes y movimientos asociados.
  2. Ir al módulo de **Categorías** (`/categorias`).
     - Mostrar las categorías predeterminadas del negocio (ingresos como *Ventas* y *Cobro de facturas*, egresos como *Servicios*, *Alquiler*, *Impuestos*).
     - Mostrar cómo se da de alta una nueva categoría o se realiza una baja lógica sin perder consistencia histórica.

---

### Minuto 2:30 - 4:00 | Facturación Electrónica y Autorización ARCA
- **Qué se muestra en pantalla:**
  1. Ir al módulo de **Facturas** (`/facturas`).
  2. Hacer clic en **"Nueva Factura"**.
  3. Completar el formulario:
     - Tipo de comprobante: `Factura C`.
     - Cliente receptor: Seleccionar un cliente existente (se completan automáticamente CUIT y datos de snapshot).
     - Concepto: `Servicios` (mostrar cómo se habilitan fechas de prestación y vencimiento).
     - Ítem: `Consultoría técnica mensual`, Cantidad: `1`, Precio Unitario: `$ 250.000,00`.
  4. Mostrar que el total ($ 250.000,00) lo calcula de forma estricta el backend con precisión decimal.
  5. Guardar como borrador y hacer clic en **"Autorizar comprobante"**.
  6. **Momento clave:** Mostrar cómo el sistema se comunica con ARCA (WSFEv1), autoriza el comprobante y recibe el **Código de Autorización Electrónico (CAE)** con su fecha de vencimiento fiscal oficial.

---

### Minuto 4:00 - 5:30 | Cobranzas Parciales, Bloqueo Pesimista y Adopción
- **Qué se muestra en pantalla:**
  1. Dentro de la factura autorizada, mostrar su estado comercial inicial: **Pendiente de Cobro** (Saldo: $ 250.000,00).
  2. Hacer clic en **"Registrar Cobro"**:
     - Registrar un pago parcial por `$ 100.000,00`.
     - Mostrar cómo el estado pasa a **Cobrada Parcialmente** y el saldo remanente desciende a `$ 150.000,00`.
  3. Explicar brevemente la arquitectura de concurrencia:
     > "Cada pago se ejecuta dentro de una transacción PostgreSQL con bloqueo pesimista (`FOR UPDATE`). Esto garantiza que dos cobros simultáneos nunca puedan superar el saldo de la factura ni generar inconsistencias."
  4. Explicar el mecanismo de **Adopción de Ingresos Manuales** para evitar el doble conteo entre movimientos de caja y facturación posterior.

---

### Minuto 5:30 - 6:30 | Dashboard Financiero: Caja vs. Gestión
- **Qué se muestra en pantalla:** Ir a la pantalla principal del **Dashboard** (`/`).
- **Qué destacar:**
  1. **Métricas Superiores:**
     - **Total Facturado en el período:** suma de facturas autorizadas por fecha de emisión.
     - **Total Cobrado:** cobranzas reales ingresadas en la ventana de tiempo.
     - **Facturado menos Cobrado:** desfasaje temporal de cobranzas del mes.
  2. **Resultado de Caja vs. Resultado de Gestión:**
     - Explicar la diferencia: la caja mide la liquidez neta (`ingresos - egresos`), mientras que la gestión mide el resultado económico devengado (`facturado + ingresos manuales - egresos`).
  3. **Gráficos de Distribución:**
     - Mostrar los gráficos interactivos de Recharts por categoría de gasto e ingreso.

---

### Minuto 6:30 - 7:00 | Cierre y Conclusiones
- **Qué decir:**
  > "Como pudimos observar, la plataforma cumple al 100% con los requerimientos del régimen de Monotributo, garantizando integridad fiscal con ARCA, robustez transaccional en base de datos y una experiencia de usuario clara y ágil.
  > Muchas gracias por su tiempo."

---

## 3. Checklist de Grabación

- [ ] Audio claro y sin ruido ambiente.
- [ ] Resolución de video recomendada: 1080p (1920x1080).
- [ ] No mostrar contraseñas reales ni certificados productivos de ARCA.
- [ ] Verificar que todos los movimientos y facturas cargados en la demo figuren en estado coherente.
