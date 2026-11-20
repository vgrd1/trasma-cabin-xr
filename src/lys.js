// Kabinlyset: 1 = fullt (boarding, servering), lavere = dempet. Ganges inn i fargen på alt inne i
// kabinen (seter, vegger, gulv, folk). Ting som lyser selv (skjermer, nettbrett) påvirkes ikke.
export const KABIN = { value: 1 };

export function dimKabin(m) {
  if (m.userData.kabinDim) return m;
  m.userData.kabinDim = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uKabin = KABIN;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uKabin;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= uKabin;');
  };
  return m;
}
