import type { DocumentSource } from "../types.js";
import { TERMS_DA } from "./terms.da.js";
import { PRIVACY_DA } from "./privacy.da.js";
import { TRUST_DA } from "./trust.da.js";
import { DPA_DA } from "./dpa.da.js";
import { SUPPORT_DA } from "./support.da.js";
import { TERMS_EN } from "./terms.en.js";
import { PRIVACY_EN } from "./privacy.en.js";
import { TRUST_EN } from "./trust.en.js";
import { DPA_EN } from "./dpa.en.js";
import { SUPPORT_EN } from "./support.en.js";

/** Every authored document. Danish is the master and prevails; English (F110.4) mirrors it block for block. */
export const SOURCES: DocumentSource[] = [
  TERMS_DA, PRIVACY_DA, TRUST_DA, DPA_DA, SUPPORT_DA,
  TERMS_EN, PRIVACY_EN, TRUST_EN, DPA_EN, SUPPORT_EN,
];

