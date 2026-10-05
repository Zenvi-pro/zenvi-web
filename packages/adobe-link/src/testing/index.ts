// Test harness for the host scripts: mocks of the Adobe DOMs, the ES3 realm
// loader, and the ES3 syntax check. Test-only (not exported from the package).
export * from "./realm.js";
export * from "./es3.js";
export * from "./host-script.js";
export * from "./extendscript-mock.js";
export * as ae from "./ae-mock.js";
export { createAeMock, type AeMock, type AeMockOptions } from "./ae-mock.js";
export * as ppro from "./premiere-mock.js";
export { createPremiereMock, type PremiereMock, type PremiereMockOptions } from "./premiere-mock.js";
