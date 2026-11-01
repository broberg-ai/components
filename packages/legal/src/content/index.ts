import type { DocumentSource } from "../types.js";
import { TERMS_DA } from "./terms.da.js";
import { PRIVACY_DA } from "./privacy.da.js";
import { TRUST_DA } from "./trust.da.js";
import { DPA_DA } from "./dpa.da.js";
import { SUPPORT_DA } from "./support.da.js";

/** Every authored document. Danish is the master; English follows in F110.4. */
export const SOURCES: DocumentSource[] = [TERMS_DA, PRIVACY_DA, TRUST_DA, DPA_DA, SUPPORT_DA];

