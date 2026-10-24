import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { parseXml, soapBody, asNode, type XmlNode } from "../soap.js";

/**
 * Validador minimo de peticiones contra el XSD embebido en el WSDL oficial:
 * nombres de elementos, orden de la secuencia, obligatorios (minOccurs) y
 * lexico de int/long/double. No es un validador XSD completo.
 */

interface ElementDef {
    name: string;
    type?: string;
    min: number;
    inline?: ComplexDef;
}

interface ComplexDef {
    base?: string;
    elements: ElementDef[];
}

const defParser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "element" || name === "complexType",
});

function toArray<T>(v: T | T[] | undefined): T[] {
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

type Raw = Record<string, any>;

function readComplex(ct: Raw | undefined): ComplexDef {
    if (!ct || typeof ct !== "object") return { elements: [] };
    const ext: Raw | undefined = ct["complexContent"]?.["extension"];
    const seq: Raw | undefined = (ext ?? ct)["sequence"];
    const elements = toArray<Raw>(seq?.["element"]).map(readElement);
    const def: ComplexDef = { elements };
    if (ext?.["@_base"]) def.base = String(ext["@_base"]).replace(/^.*:/, "");
    return def;
}

function readElement(e: Raw): ElementDef {
    const def: ElementDef = { name: String(e["@_name"]), min: e["@_minOccurs"] === undefined ? 1 : Number(e["@_minOccurs"]) };
    if (e["@_type"]) def.type = String(e["@_type"]);
    const inlineCt = toArray<Raw>(e["complexType"])[0];
    if (inlineCt) def.inline = readComplex(inlineCt);
    return def;
}

export class WsdlSchema {
    private readonly types = new Map<string, ComplexDef>();
    private readonly operations = new Map<string, ComplexDef>();

    constructor(wsdlPath: string) {
        const doc = defParser.parse(readFileSync(wsdlPath, "utf8")) as Raw;
        const schema: Raw = doc["definitions"]["types"]["schema"];
        for (const ct of toArray<Raw>(schema["complexType"])) this.types.set(String(ct["@_name"]), readComplex(ct));
        for (const el of toArray<Raw>(schema["element"])) {
            const def = readElement(el);
            this.operations.set(def.name, def.inline ?? { elements: [] });
        }
    }

    hasOperation(name: string): boolean {
        return this.operations.has(name);
    }

    /** Valida el <soap:Body> de una peticion; devuelve la lista de errores (vacia si es valida). */
    validateRequest(xml: string): { operation: string | undefined; errors: string[] } {
        const errors: string[] = [];
        let body: XmlNode | undefined;
        try {
            body = soapBody(parseXml(xml));
        } catch (err) {
            return { operation: undefined, errors: [`XML mal formado: ${String(err)}`] };
        }
        if (!body) return { operation: undefined, errors: ["Falta soap:Body"] };
        const keys = Object.keys(body);
        const operation = keys[0];
        if (keys.length !== 1 || !operation) return { operation, errors: ["El Body debe tener exactamente una operacion"] };
        const def = this.operations.get(operation);
        if (!def) return { operation, errors: [`Operacion desconocida: ${operation}`] };
        this.validateComplex(body[operation], def, operation, errors);
        return { operation, errors };
    }

    private flatten(def: ComplexDef): ElementDef[] {
        const base = def.base ? this.types.get(def.base) : undefined;
        return [...(base ? this.flatten(base) : []), ...def.elements];
    }

    private validateComplex(value: unknown, def: ComplexDef, path: string, errors: string[]): void {
        const node = asNode(value) ?? {};
        if (typeof value === "string" && value !== "") errors.push(`${path}: se esperaba un elemento complejo`);
        const seq = this.flatten(def);
        const names = seq.map((e) => e.name);
        let last = -1;
        for (const key of Object.keys(node)) {
            const idx = names.indexOf(key);
            if (idx < 0) {
                errors.push(`${path}: elemento no declarado <${key}>`);
                continue;
            }
            if (idx < last) errors.push(`${path}: <${key}> fuera de orden`);
            last = Math.max(last, idx);
        }
        for (const el of seq) {
            const child = node[el.name];
            if (child === undefined) {
                if (el.min >= 1) errors.push(`${path}: falta <${el.name}> obligatorio`);
                continue;
            }
            for (const item of toArray(child)) this.validateValue(item, el, `${path}/${el.name}`, errors);
        }
    }

    private validateValue(value: unknown, el: ElementDef, path: string, errors: string[]): void {
        if (el.inline) return this.validateComplex(value, el.inline, path, errors);
        const type = (el.type ?? "").replace(/^.*:/, "");
        const complex = this.types.get(type);
        if (complex) return this.validateComplex(value, complex, path, errors);
        const text = typeof value === "string" ? value : "";
        if ((type === "int" || type === "long") && !/^-?\d+$/.test(text)) errors.push(`${path}: "${text}" no es ${type}`);
        if (type === "double" && !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) errors.push(`${path}: "${text}" no es double`);
    }
}
