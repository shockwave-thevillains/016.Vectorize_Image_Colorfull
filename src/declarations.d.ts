declare module 'svgpath' {
  interface SvgPath {
    (path: string): SvgPath;
    new (path: string): SvgPath;
    scale(sx: number, sy?: number): SvgPath;
    translate(x: number, y?: number): SvgPath;
    rotate(angle: number, rx?: number, ry?: number): SvgPath;
    skewX(degrees: number): SvgPath;
    skewY(degrees: number): SvgPath;
    matrix(m: number[]): SvgPath;
    transform(str: string): SvgPath;
    abs(): SvgPath;
    rel(): SvgPath;
    round(precision: number): SvgPath;
    unarc(): SvgPath;
    unshort(): SvgPath;
    toString(): string;
  }
  const svgpath: SvgPath;
  export default svgpath;
}

declare module 'imagetracerjs' {
  const ImageTracer: {
    imagedataToSVG: (imageData: ImageData, options?: any) => string;
    imageToSVG: (url: string, callback: (svgstr: string) => void, options?: any) => void;
    [key: string]: any;
  };
  export default ImageTracer;
}

declare module '@visioncortex/vtracer' {
  export function convertPixels(
    pixels: Uint8Array,
    width: number,
    height: number,
    options?: any
  ): string;
  export function convertBuffer(
    buffer: Uint8Array,
    options?: any
  ): string;
}
