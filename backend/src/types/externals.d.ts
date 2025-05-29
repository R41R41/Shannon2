declare module 'node-canvas-webgl/lib/index.js';
declare module 'three';

declare module '@langchain/community/tools/googlesearchapiwrapper' {
    export class GoogleSearchAPIWrapper {
        constructor(apiKey: string);
        invoke(query: string): Promise<string>;
    }
}