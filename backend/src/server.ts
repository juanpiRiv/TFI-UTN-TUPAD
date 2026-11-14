import { app } from "./app.js";
import { env } from "./config/env.js";
import { parseArcaProviderKind } from "./module/arca/provider-factory.js";
import { getFiscalProviderFromEnv } from "./module/arca/provider-from-env.js";

// Falla al arrancar, con un mensaje claro, si ARCA_PROVIDER falta o no es válida.
const arcaProvider = parseArcaProviderKind(env.ARCA_PROVIDER);

// Con sdk, falla al arrancar si las credenciales o el modo no son válidos, en vez de al primer facturar.
if (arcaProvider === "sdk") {
    getFiscalProviderFromEnv(env);
}

app.listen(env.PORT, () => {
    console.log(`API listening on port: ${env.PORT}`);
    console.log(`Fiscal provider: ${arcaProvider} (${env.ARCA_MODE})`);
});
