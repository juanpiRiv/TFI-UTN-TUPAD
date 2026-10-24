import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["dotenv/config"],
    // Los tests de integración corren en paralelo contra la misma base: con la carga de ~20 archivos a la
    // vez (y más en un runner de CI), los 5 s por defecto fallaban al azar en los tests de concurrencia.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
