/**
 * SVG Transform Baker using official svgpath library
 * Bakes transform="translate(x, y)" directly into absolute path coordinates:
 * svgpath(d).translate(x, y).abs().round(2)
 * and strips the transform attribute.
 * Retains 1:1 exact VTracer stacked order, does NOT merge compound paths,
 * does NOT perform vertex snapping, and does NOT run custom RDP.
 */
import svgpath from 'svgpath';

export function bakeTransformsWithSvgPath(svgString: string): string {
  if (!svgString || !svgString.includes('<svg')) return svgString;

  let resultSvg = svgString;

  // 1. Ensure geometric precision rendering attribute
  if (!resultSvg.includes('shape-rendering')) {
    resultSvg = resultSvg.replace('<svg ', '<svg shape-rendering="geometricPrecision" ');
  }

  // 2. Process group transforms (<g transform="...">) iteratively
  let prevSvg = '';
  while (resultSvg !== prevSvg && resultSvg.includes('<g') && /<g\b[^>]*\btransform=["'][^"']+["']/i.test(resultSvg)) {
    prevSvg = resultSvg;
    resultSvg = resultSvg.replace(/<g\b([^>]*\btransform=["'][^"']+["'][^>]*)>((?:(?!<g\b)[\s\S])*?)<\/g>/gi, (gTag, gAttrs, gInner) => {
      const gTrMatch = gAttrs.match(/\btransform=["']([^"']+)["']/i);
      if (!gTrMatch) return gTag;
      const gTrStr = gTrMatch[1].trim();
      const gMatch = gTrStr.match(/translate\(\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)(?:[\s,]+([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?))?\s*\)/i);
      const gtx = gMatch ? parseFloat(gMatch[1]) || 0 : 0;
      const gty = gMatch && gMatch[2] ? parseFloat(gMatch[2]) || 0 : 0;

      const bakedInner = gInner.replace(/<path\b([^>]*?)(\/?>|>[\s\S]*?<\/path>)/gi, (pTag: string, pAttrs: string) => {
        const dMatch = pAttrs.match(/\bd=["']([^"']+)["']/i);
        if (!dMatch) return pTag;
        const rawD = dMatch[1];
        const pTrMatch = pAttrs.match(/\btransform=["']([^"']+)["']/i);
        let ptx = 0;
        let pty = 0;
        let isPathTranslate = false;
        if (pTrMatch) {
          const pm = pTrMatch[1].match(/translate\(\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)(?:[\s,]+([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?))?\s*\)/i);
          if (pm) {
            ptx = parseFloat(pm[1]) || 0;
            pty = pm[2] ? parseFloat(pm[2]) || 0 : 0;
            isPathTranslate = true;
          }
        }

        let sp = svgpath(rawD);
        if (gMatch && (!pTrMatch || isPathTranslate)) {
          sp = sp.translate(gtx + ptx, gty + pty);
        } else {
          sp = sp.transform(gTrStr);
          if (pTrMatch) sp = sp.transform(pTrMatch[1].trim());
        }

        const newD = sp.abs().round(2).toString();
        let cleanAttrs = pAttrs.replace(/\btransform=["'][^"']+["']/gi, '').trim();
        cleanAttrs = cleanAttrs.replace(/\bd=["'][^"']+["']/gi, () => `d="${newD}"`);
        cleanAttrs = cleanAttrs.replace(/\/+$/, '').trim();
        return `<path ${cleanAttrs}/>`;
      });

      const cleanGAttrs = gAttrs.replace(/\btransform=["'][^"']+["']/gi, '').trim();
      return cleanGAttrs ? `<g ${cleanGAttrs}>${bakedInner}</g>` : bakedInner;
    });
  }

  // 3. Process individual path transforms and normalize coordinates
  resultSvg = resultSvg.replace(/<path\b([^>]*?)(\/?>|>[\s\S]*?<\/path>)/gi, (fullTag, attrs) => {
    const dMatch = attrs.match(/\bd=["']([^"']+)["']/i);
    if (!dMatch) return fullTag;
    const rawD = dMatch[1].trim();

    let newD = rawD;
    let cleanAttrs = attrs;
    const transformMatch = attrs.match(/\btransform=["']([^"']+)["']/i);
    if (transformMatch) {
      const transformStr = transformMatch[1].trim();
      const trMatch = transformStr.match(/translate\(\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)(?:[\s,]+([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?))?\s*\)/i);
      if (trMatch) {
        const tx = parseFloat(trMatch[1]) || 0;
        const ty = trMatch[2] ? parseFloat(trMatch[2]) || 0 : 0;
        newD = svgpath(rawD).translate(tx, ty).abs().round(2).toString();
      } else {
        newD = svgpath(rawD).transform(transformStr).abs().round(2).toString();
      }
      cleanAttrs = cleanAttrs.replace(/\btransform=["'][^"']+["']/gi, '').trim();
    } else {
      newD = svgpath(rawD).abs().round(2).toString();
    }

    cleanAttrs = cleanAttrs.replace(/\bd=["'][^"']+["']/gi, () => `d="${newD}"`);
    cleanAttrs = cleanAttrs.replace(/\/+$/, '').trim();
    return `<path ${cleanAttrs}/>`;
  });

  return resultSvg;
}
