import { colorGLSL } from './transferFunction'
/** Physical scalar is interpolated before optional logarithmic normalization.
 * Opacity is extinction per reference path length (500 km), not alpha per sample.
 * Consequently switching ray step / grid resolution does not change optical thickness.
 */
export const ionosphereVoxelShader = `${colorGLSL()}
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  float value=fsInput.metadata.scalar;
  material.alpha=0.0;
  if(fsInput.metadata.valid<0.999 || value<u_valueMin || value>u_valueMax || (u_logScale>0.5 && value<=0.0)) return;
  float lo=u_valueMin, hi=u_valueMax, v=value;
  if(u_logScale>0.5){ lo=log(lo); hi=log(hi); v=log(v); }
  float t=clamp((v-lo)/max(hi-lo,1.0e-30),0.0,1.0);
  if(t<u_low) return;
  float density=mix(u_lowValueOpacity,1.0,smoothstep(u_low,u_high,t));
  material.diffuse=scientificColor(t,u_palette);
  material.alpha=1.0-exp(-density*u_opacity*fsInput.voxel.travelDistance*u_pathScale/500000.0);
}`
