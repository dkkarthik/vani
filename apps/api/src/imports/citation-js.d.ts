declare module "@citation-js/core" {
  export const plugins: { input: { data(input: unknown, type: string): any } };
  export class Cite {
    constructor(input: unknown, options?: { forceType?: string });
    data: any[];
  }
}
declare module "@citation-js/plugin-bibtex";
declare module "@citation-js/plugin-ris";
