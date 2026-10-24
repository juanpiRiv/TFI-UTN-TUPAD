import { app } from "./app.js";
import { env } from "./config/env.js";
import { parseArcaProviderKind } from "./module/arca/provider-factory.js";

// Falla al arrancar, con un mensaje claro, si ARCA_PROVIDER falta o no es válida.
const arcaProvider = parseArcaProviderKind(env.ARCA_PROVIDER);

app.listen(env.PORT, () => {
    console.log(`API listening on port: ${env.PORT}`);
    console.log(`Fiscal provider: ${arcaProvider} (${env.ARCA_MODE})`);
});
