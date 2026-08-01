/**
 * The module registry.
 *
 * Thirteen effects, grouped into files by what they are *capable of* rather
 * than by what they look like — `light.ts` and `chroma.ts` and `surface.ts`
 * contain the eleven that can only change a pixel's colour, and `depth.ts`
 * contains the two that can move one. That split is the engine's central safety
 * property made visible at the level of the file tree: eleven of thirteen
 * modules are incapable of distorting typography no matter how they are
 * configured, because they never receive the name they would have to write to.
 *
 * The registry is validated at import time rather than at first render. A
 * displacing module that forgot to gate itself on the protection mask is not a
 * subtle bug to be caught in review — it is a smeared glyph on somebody's cover
 * — so it throws before the application can start.
 */

import { assertMasked, type ShaderModule } from "../compose";
import type { ModuleId } from "../../types";
import {
  BREATH,
  GLOW,
  LIGHT_DRIFT,
  LIGHT_SWEEP,
  SHADOW,
  SPECULAR,
  VIGNETTE_BREATH,
} from "./light";
import { CHROMA_EXPAND, CHROMA_FLOW, TEMP_SHIFT } from "./chroma";
import { GRAIN } from "./surface";
import { DEPTH_BAND, SURFACE } from "./depth";
import { SHEEN } from "./sheen";

export const MODULES: Record<ModuleId, ShaderModule> = {
  SHEEN,
  LIGHT_DRIFT,
  LIGHT_SWEEP,
  BREATH,
  GLOW,
  SHADOW,
  SPECULAR,
  VIGNETTE_BREATH,
  CHROMA_FLOW,
  CHROMA_EXPAND,
  TEMP_SHIFT,
  GRAIN,
  DEPTH_BAND,
  SURFACE,
};

assertMasked(Object.values(MODULES));

/** Resolves a profile's module ids to the modules themselves, in the order given. */
export function modulesFor(ids: readonly ModuleId[]): ShaderModule[] {
  return ids.map((id) => MODULES[id]);
}
