// Minimal ambient types for vis-timeline's standalone bundle.
// v8.5.1 declares `types` in package.json but ships no .d.ts, and the
// `./standalone` subpath has no types condition under bundler resolution.
// We only type the surface this app touches.
declare module 'vis-timeline/standalone' {
  export interface TimelineItem {
    id?: string | number;
    group?: string | number;
    content?: string;
    start?: Date | number | string;
    end?: Date | number | string;
    type?: 'box' | 'point' | 'range' | 'background';
    className?: string;
    style?: string;
    title?: string;
    [key: string]: unknown;
  }
  export interface TimelineGroup {
    id: string | number;
    content: string;
    order?: number;
    [key: string]: unknown;
  }
  export interface TimelineOptions {
    [key: string]: unknown;
  }
  export class DataSet<T> {
    constructor(data?: T[]);
    add(data: T | T[]): (string | number)[];
    clear(): (string | number)[];
    get(): T[];
    remove(id: string | number | (string | number)[]): (string | number)[];
  }
  export class DataView<T> {
    constructor(data: DataSet<T>, options?: unknown);
  }
  export class Timeline {
    constructor(
      container: HTMLElement,
      items: unknown,
      groups?: unknown,
      options?: TimelineOptions,
    );
    on(event: string, callback: (properties: any) => void): void;
    off(event: string, callback: (properties: any) => void): void;
    setWindow(start: Date | number | string, end: Date | number | string, options?: unknown): void;
    moveTo(time: Date | number | string, options?: unknown): void;
    fit(options?: unknown): void;
    setOptions(options: TimelineOptions): void;
    redraw(): void;
    destroy(): void;
  }
}

declare module 'vis-timeline/styles/*';
