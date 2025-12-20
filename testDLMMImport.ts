
import * as DLMMNamespace from '@meteora-ag/dlmm';
import DLMMDefault from '@meteora-ag/dlmm';

console.log("--- Debugging DLMM Import ---");

console.log("Namespace keys:", Object.keys(DLMMNamespace));
// @ts-ignore
console.log("Namespace.default:", DLMMNamespace.default);
// @ts-ignore
console.log("Namespace.DLMM:", DLMMNamespace.DLMM);

console.log("Default import:", DLMMDefault);

// @ts-ignore
const DLMM_Final = DLMMDefault?.default || DLMMDefault || DLMMNamespace?.default || DLMMNamespace?.DLMM;

console.log("Resolved DLMM Class:", DLMM_Final);

if (DLMM_Final && typeof DLMM_Final.create === 'function') {
    console.log("✅ DLMM.create is available!");
} else {
    console.log("❌ DLMM.create is MISSING!");
}
