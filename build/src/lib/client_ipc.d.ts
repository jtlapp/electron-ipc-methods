/**
 * Code specific to handling IPC in the renderer process.
 */
import { ApiBinding, PublicProperty } from "./shared_ipc";
import { RestorerFunction } from "./restorer";
declare global {
    interface Window {
        __ipc: {
            invoke: (channel: string, data?: any) => Promise<any>;
            send: (channel: string, data: any) => void;
            on: (channel: string, func: (data: any) => void) => void;
        };
    }
}
/**
 * Returns a window-side binding for a main API of a given class.
 * Main must have previously exposed the API.
 *
 * @param <T> Class to which to bind.
 * @param apiClassName Name of the class being bound. Must be identical to
 *    the name of class T. Provides runtime information that <T> does not.
 * @param restorer Optional function for restoring the classes of returned
 *    values to the classes they had when transmitted by main. Instances of
 *    classes not restored arrive as untyped structures.
 * @returns An API of type T that can be called as if T were local.
 */
export declare function bindMainApi<T>(apiClassName: string, restorer?: RestorerFunction): Promise<ApiBinding<T>>;
/**
 * Type to which a window API of class T conforms, expecting each API
 * to return void. All properties of the method not beginning with an
 * underscore or pound are considered IPC APIs. All properties beginning
 * with an underscore or poundare ignored, allowing an API class to have
 * internal structure on which the APIs rely.
 */
export declare type ElectronWindowApi<T> = {
    [K in keyof T]: K extends PublicProperty<K> ? (...args: any[]) => void : any;
};
/**
 * Exposes a window API to main for possible binding.
 *
 * @param <T> (inferred type, not specified in call)
 * @param windowApi The API to expose to main
 * @param restorer Optional function for restoring the classes of
 *    arguments passed from main. Instances of classes not restored
 *    arrive as untyped structures.
 */
export declare function exposeWindowApi<T>(windowApi: ElectronWindowApi<T>, restorer?: RestorerFunction): void;