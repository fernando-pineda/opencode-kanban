/// <reference types="vite/client" />

// Vite worker import syntax: `import Worker from './file?worker'`
declare module '*?worker' {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

// Vite raw asset import syntax: `import url from './file?url'`
declare module '*?url' {
  const url: string;
  export default url;
}
